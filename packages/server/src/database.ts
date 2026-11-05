// The server's database (docs/plans/server.md#D280): users, their calendars,
// the objects in them byte for byte, and per calendar a change log whose
// number is the calendar's sync token. Its own schema, not the client
// store's, on any `SqlDriver` (the image's is `@astrotime/storage/node`).
import { createHash } from "node:crypto";

import type { SqlDriver } from "@astrotime/storage";

import { hashPassword } from "./passwords.ts";

/** Each migration takes the database from its index to the next version (`PRAGMA user_version`). */
const MIGRATIONS = [
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     name TEXT NOT NULL UNIQUE,
     password TEXT NOT NULL
   );
   -- AUTOINCREMENT: a calendar's id is in its sync tokens, so a new
   -- calendar never takes a removed one's id and its tokens.
   CREATE TABLE calendars (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     slug TEXT NOT NULL,
     name TEXT NOT NULL,
     color TEXT,
     components TEXT NOT NULL,
     sync INTEGER NOT NULL DEFAULT 0,
     UNIQUE (user_id, slug)
   );
   CREATE TABLE objects (
     calendar_id INTEGER NOT NULL REFERENCES calendars (id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     uid TEXT NOT NULL,
     component TEXT NOT NULL,
     data BLOB NOT NULL,
     etag TEXT NOT NULL,
     PRIMARY KEY (calendar_id, name),
     UNIQUE (calendar_id, uid)
   );
   -- Each object's last change only: a sync token n is answered with every
   -- name changed after n, there or gone.
   CREATE TABLE changes (
     calendar_id INTEGER NOT NULL REFERENCES calendars (id) ON DELETE CASCADE,
     name TEXT NOT NULL,
     number INTEGER NOT NULL,
     PRIMARY KEY (calendar_id, name)
   );
   CREATE INDEX changes_by_number ON changes (calendar_id, number);`,
];

export type Component = "VEVENT" | "VTODO";

export interface User {
  readonly id: number;
  readonly name: string;
  /** The scrypt hash (`passwords.ts`). */
  readonly password: string;
}

export interface Calendar {
  readonly id: number;
  readonly userId: number;
  /** Its path segment in the user's calendar home. */
  readonly slug: string;
  readonly name: string;
  readonly color: string | null;
  readonly components: readonly Component[];
  /** The number of its last change: its sync token and ctag. */
  readonly sync: number;
}

export interface StoredObject {
  /** Its path segment in its calendar, as the client named it. */
  readonly name: string;
  readonly uid: string;
  readonly component: Component;
  readonly etag: string;
  readonly size: number;
}

/** A user's first calendar and task list (D282). */
const FIRST_CALENDARS = [
  { slug: "personal", name: "Personal", components: ["VEVENT"] },
  { slug: "tasks", name: "Tasks", components: ["VTODO"] },
] as const;

/** A strong ETag of an object's bytes, which the server never changes (D280). */
function etagOf(data: Uint8Array): string {
  return `"${createHash("sha256").update(data).digest("base64url")}"`;
}

const calendarOf = (row: unknown[]): Calendar => ({
  id: Number(row[0]),
  userId: Number(row[1]),
  slug: String(row[2]),
  name: String(row[3]),
  color: row[4] === null ? null : String(row[4]),
  components: String(row[5]).split(",") as Component[],
  sync: Number(row[6]),
});
const CALENDAR_COLUMNS = "id, user_id, slug, name, color, components, sync";

const objectOf = (row: unknown[]): StoredObject => ({
  name: String(row[0]),
  uid: String(row[1]),
  component: String(row[2]) as Component,
  etag: String(row[3]),
  size: Number(row[4]),
});
const OBJECT_COLUMNS = "name, uid, component, etag, length(data)";

export class ServerDatabase {
  private readonly driver: SqlDriver;
  /** The operation running now: one at a time, so transactions never meet on the connection. */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(driver: SqlDriver) {
    this.driver = driver;
  }

  static async open(driver: SqlDriver): Promise<ServerDatabase> {
    await driver.script("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const [[version]] = (await driver.query("PRAGMA user_version", [])) as [[number]];
    for (let at = version; at < MIGRATIONS.length; at++) {
      await driver.script(`BEGIN; ${MIGRATIONS[at]} PRAGMA user_version = ${at + 1}; COMMIT;`);
    }
    return new ServerDatabase(driver);
  }

  /** Runs `operation` once every operation before it is done. */
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.catch(() => {});
    return run;
  }

  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    await this.driver.script("BEGIN IMMEDIATE;");
    try {
      const result = await operation();
      await this.driver.script("COMMIT;");
      return result;
    } catch (error) {
      await this.driver.script("ROLLBACK;").catch(() => {});
      throw error;
    }
  }

  private query(sql: string, params: readonly unknown[] = []) {
    return this.driver.query(sql, params);
  }

  // Users (D282).

  async user(name: string): Promise<User | null> {
    const [row] = await this.query("SELECT id, name, password FROM users WHERE name = ?", [name]);
    return row ? { id: Number(row[0]), name: String(row[1]), password: String(row[2]) } : null;
  }

  async userNames(): Promise<string[]> {
    return (await this.query("SELECT name FROM users ORDER BY name")).map((row) => String(row[0]));
  }

  /** A new user with their first calendar and task list. */
  async addUser(name: string, password: string): Promise<User> {
    if (!name || name !== name.trim() || /[/:]/.test(name) || name.length > 100)
      throw new Error(`"${name}" is no user name: no slash, colon or spaces around it.`);
    const hash = await hashPassword(password);
    return this.exclusive(() =>
      this.transaction(async () => {
        if (await this.user(name)) throw new Error(`The user ${name} exists already.`);
        await this.query("INSERT INTO users (name, password) VALUES (?, ?)", [name, hash]);
        const user = (await this.user(name))!;
        for (const calendar of FIRST_CALENDARS) await this.addCalendar(user.id, calendar);
        return user;
      }),
    );
  }

  async setPassword(name: string, password: string): Promise<void> {
    const hash = await hashPassword(password);
    await this.exclusive(async () => {
      if (!(await this.user(name))) throw new Error(`There is no user ${name}.`);
      await this.query("UPDATE users SET password = ? WHERE name = ?", [hash, name]);
    });
  }

  /** Removes a user with every calendar and object of theirs. */
  async removeUser(name: string): Promise<void> {
    await this.exclusive(async () => {
      if (!(await this.user(name))) throw new Error(`There is no user ${name}.`);
      await this.query("DELETE FROM users WHERE name = ?", [name]);
    });
  }

  // Calendars. Everything below runs inside `exclusive`, which the handler holds.

  async calendars(userId: number): Promise<Calendar[]> {
    const rows = await this.query(
      `SELECT ${CALENDAR_COLUMNS} FROM calendars WHERE user_id = ? ORDER BY id`,
      [userId],
    );
    return rows.map(calendarOf);
  }

  async calendar(userId: number, slug: string): Promise<Calendar | null> {
    const [row] = await this.query(
      `SELECT ${CALENDAR_COLUMNS} FROM calendars WHERE user_id = ? AND slug = ?`,
      [userId, slug],
    );
    return row ? calendarOf(row) : null;
  }

  async addCalendar(
    userId: number,
    calendar: {
      readonly slug: string;
      readonly name: string;
      readonly color?: string | null;
      readonly components: readonly Component[];
    },
  ): Promise<void> {
    await this.query(
      "INSERT INTO calendars (user_id, slug, name, color, components) VALUES (?, ?, ?, ?, ?)",
      [userId, calendar.slug, calendar.name, calendar.color ?? null, calendar.components.join(",")],
    );
  }

  async renameCalendar(id: number, change: { name?: string; color?: string | null }) {
    if (change.name !== undefined)
      await this.query("UPDATE calendars SET name = ? WHERE id = ?", [change.name, id]);
    if (change.color !== undefined)
      await this.query("UPDATE calendars SET color = ? WHERE id = ?", [change.color, id]);
  }

  async removeCalendar(id: number): Promise<void> {
    await this.query("DELETE FROM calendars WHERE id = ?", [id]);
  }

  // Objects and their changes.

  async objects(calendarId: number): Promise<StoredObject[]> {
    const rows = await this.query(
      `SELECT ${OBJECT_COLUMNS} FROM objects WHERE calendar_id = ? ORDER BY name`,
      [calendarId],
    );
    return rows.map(objectOf);
  }

  async object(calendarId: number, name: string): Promise<StoredObject | null> {
    const [row] = await this.query(
      `SELECT ${OBJECT_COLUMNS} FROM objects WHERE calendar_id = ? AND name = ?`,
      [calendarId, name],
    );
    return row ? objectOf(row) : null;
  }

  async objectWithUid(calendarId: number, uid: string): Promise<StoredObject | null> {
    const [row] = await this.query(
      `SELECT ${OBJECT_COLUMNS} FROM objects WHERE calendar_id = ? AND uid = ?`,
      [calendarId, uid],
    );
    return row ? objectOf(row) : null;
  }

  /** An object's bytes as the client wrote them. */
  async data(calendarId: number, name: string): Promise<Uint8Array | null> {
    const [row] = await this.query("SELECT data FROM objects WHERE calendar_id = ? AND name = ?", [
      calendarId,
      name,
    ]);
    return row ? (row[0] as Uint8Array) : null;
  }

  /** Writes an object and logs the change; returns its ETag. */
  async putObject(
    calendarId: number,
    object: { name: string; uid: string; component: Component; data: Uint8Array },
  ): Promise<string> {
    const etag = etagOf(object.data);
    await this.transaction(async () => {
      await this.query(
        `INSERT INTO objects (calendar_id, name, uid, component, data, etag) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (calendar_id, name) DO UPDATE SET uid = excluded.uid,
           component = excluded.component, data = excluded.data, etag = excluded.etag`,
        [calendarId, object.name, object.uid, object.component, object.data, etag],
      );
      await this.logChange(calendarId, object.name);
    });
    return etag;
  }

  async removeObject(calendarId: number, name: string): Promise<void> {
    await this.transaction(async () => {
      await this.query("DELETE FROM objects WHERE calendar_id = ? AND name = ?", [
        calendarId,
        name,
      ]);
      await this.logChange(calendarId, name);
    });
  }

  private async logChange(calendarId: number, name: string): Promise<void> {
    const [[number]] = (await this.query(
      "UPDATE calendars SET sync = sync + 1 WHERE id = ? RETURNING sync",
      [calendarId],
    )) as [[number]];
    await this.query(
      `INSERT INTO changes (calendar_id, name, number) VALUES (?, ?, ?)
       ON CONFLICT (calendar_id, name) DO UPDATE SET number = excluded.number`,
      [calendarId, name, number],
    );
  }

  /** The names changed after change `number`: still there, or removed. */
  async changedSince(calendarId: number, number: number): Promise<string[]> {
    const rows = await this.query(
      "SELECT name FROM changes WHERE calendar_id = ? AND number > ? ORDER BY number",
      [calendarId, number],
    );
    return rows.map((row) => String(row[0]));
  }
}
