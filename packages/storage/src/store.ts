import { boundsOf, CalendarObject, type Range } from "@astrotime/core";
import { and, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from "drizzle-orm";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import type { SqlDriver } from "./driver.ts";
import { migrate } from "./migrations.ts";
import * as schema from "./schema.ts";

export type Account = typeof schema.accounts.$inferSelect;
export type Calendar = Omit<typeof schema.calendars.$inferSelect, "components"> & {
  readonly components: readonly Component[];
};
export type StoredObject = typeof schema.objects.$inferSelect;
export type Conflict = typeof schema.conflicts.$inferSelect;
export type Component = "VEVENT" | "VTODO";
export type Pending = StoredObject["pending"];

/** The most a zone is from UTC; a range of days is widened by it to find candidates. */
const ZONE_SLACK_MS = 14 * 3_600_000;

/**
 * The local store, the UI's source of truth (docs/plans/foundation.md#D5).
 * Every write of an object parses it with `@astrotime/core` first, so the
 * store holds only valid calendar objects, indexed by `boundsOf`.
 */
export class Store {
  private readonly db: SqliteRemoteDatabase<typeof schema>;
  private readonly driver: SqlDriver;

  private constructor(db: SqliteRemoteDatabase<typeof schema>, driver: SqlDriver) {
    this.db = db;
    this.driver = driver;
  }

  /** Opens the store on a driver, migrating the schema to this build's version. */
  static async open(driver: SqlDriver): Promise<Store> {
    await migrate(driver);
    const db = drizzle(
      async (sql, params, method) => {
        const rows = await driver.query(sql, params);
        // Drizzle reads `get` as one row, and no row as `undefined`.
        return { rows: method === "get" ? (rows[0] as unknown[]) : rows };
      },
      { schema },
    );
    return new Store(db, driver);
  }

  close(): Promise<void> {
    return this.driver.close();
  }

  // Accounts

  addAccount(input: Omit<Account, "id" | "createdAt">): Promise<Account> {
    return this.exclusive(async () => {
      const account = { ...input, id: crypto.randomUUID(), createdAt: Date.now() };
      await this.db.insert(schema.accounts).values(account);
      return account;
    });
  }

  accounts(): Promise<Account[]> {
    return this.db.select().from(schema.accounts).orderBy(schema.accounts.createdAt);
  }

  /** Removes the account with its calendars, objects and conflicts. */
  removeAccount(id: string): Promise<void> {
    return this.exclusive(async () => {
      await this.db.delete(schema.accounts).where(eq(schema.accounts.id, id));
    });
  }

  // Calendars

  /** Adds a calendar, or updates the one with the same account and URL. Sync state is kept. */
  saveCalendar(
    input: Pick<Calendar, "accountId" | "url" | "name" | "color" | "components" | "readOnly">,
  ): Promise<Calendar> {
    return this.exclusive(async () => {
      const values = { ...input, components: input.components.join(",") };
      const [row] = await this.db
        .insert(schema.calendars)
        .values({ ...values, id: crypto.randomUUID() })
        .onConflictDoUpdate({
          target: [schema.calendars.accountId, schema.calendars.url],
          set: {
            name: values.name,
            color: values.color,
            components: values.components,
            readOnly: values.readOnly,
          },
        })
        .returning();
      return toCalendar(row!);
    });
  }

  async calendars(accountId?: string): Promise<Calendar[]> {
    const rows = await this.db
      .select()
      .from(schema.calendars)
      .where(accountId === undefined ? undefined : eq(schema.calendars.accountId, accountId))
      .orderBy(schema.calendars.name);
    return rows.map(toCalendar);
  }

  setSyncState(
    calendarId: string,
    state: { syncToken: string | null; ctag: string | null },
  ): Promise<void> {
    return this.exclusive(async () => {
      await this.db.update(schema.calendars).set(state).where(eq(schema.calendars.id, calendarId));
    });
  }

  removeCalendar(id: string): Promise<void> {
    return this.exclusive(async () => {
      await this.db.delete(schema.calendars).where(eq(schema.calendars.id, id));
    });
  }

  // Objects

  /**
   * Stores the server's version of a resource under its href. A local change
   * still pending there is never overwritten (AGENTS.md rule 2): the stored
   * row comes back unchanged, unless `replacePending` says the sync engine
   * decided the server's version wins (docs/plans/foundation.md#D38).
   */
  saveFromServer(
    calendarId: string,
    resource: { href: string; etag: string | null; ics: string },
    options: { replacePending?: Pick<StoredObject, "ics" | "pending"> } = {},
  ): Promise<StoredObject> {
    return this.exclusive(async () => {
      const current = await this.objectAt(calendarId, resource.href);
      if (current && current.pending !== "none") {
        // Replaced only as the sync engine saw it: an edit made since stays.
        const seen = options.replacePending;
        if (!seen || seen.ics !== current.ics || seen.pending !== current.pending) return current;
      }
      return this.upsert(
        calendarId,
        resource.href,
        resource.etag,
        resource.ics,
        "none",
        resource.ics,
      );
    });
  }

  /**
   * Stores a change made on this device, for the sync engine to upload. A new
   * object gets the href the sync engine will create it under.
   */
  saveLocal(calendarId: string, ics: string, href?: string): Promise<StoredObject> {
    return this.exclusive(() => this.saveLocalNow(calendarId, ics, href));
  }

  private async saveLocalNow(
    calendarId: string,
    ics: string,
    href?: string,
  ): Promise<StoredObject> {
    const object = CalendarObject.parse(ics);
    if (href === undefined) {
      const existing = await this.db
        .select()
        .from(schema.objects)
        .where(and(eq(schema.objects.calendarId, calendarId), eq(schema.objects.uid, object.uid)))
        .get();
      href = existing?.href ?? `${encodeURIComponent(object.uid)}.ics`;
    }
    const current = await this.objectAt(calendarId, href);
    if (current && current.uid !== object.uid) {
      throw new Error(`${href} holds ${current.uid}; a change to ${object.uid} cannot replace it.`);
    }
    // An edit of an object deleted here but not yet uploaded revives it (D38).
    const pending: Pending = !current || current.pending === "create" ? "create" : "update";
    return this.upsert(
      calendarId,
      href,
      current?.etag ?? null,
      ics,
      pending,
      current?.baseIcs ?? null,
    );
  }

  /** Deletes an object on this device: at once if it never reached the server, else after the upload. */
  deleteLocal(id: string): Promise<void> {
    return this.exclusive(() => this.deleteLocalNow(id));
  }

  private async deleteLocalNow(id: string): Promise<void> {
    const object = await this.object(id);
    if (!object) return;
    if (object.pending === "create") await this.removeObjectNow(id);
    else
      await this.db
        .update(schema.objects)
        .set({ pending: "delete", updatedAt: Date.now() })
        .where(eq(schema.objects.id, id));
  }

  /**
   * Records that the server accepted an upload of `uploaded.ics`. A change
   * made on this device while the upload was on its way stays pending: an
   * edit as an update of what the server now has, a deletion as a deletion.
   */
  markSynced(
    id: string,
    uploaded: { href: string; etag: string | null; ics: string },
  ): Promise<void> {
    return this.exclusive(async () => {
      const current = await this.object(id);
      if (!current) return;
      const pending: Pending =
        current.pending === "delete" ? "delete" : current.ics === uploaded.ics ? "none" : "update";
      // What the server accepted is the base of the next local change.
      await this.db
        .update(schema.objects)
        .set({ href: uploaded.href, etag: uploaded.etag, pending, baseIcs: uploaded.ics })
        .where(eq(schema.objects.id, id));
    });
  }

  /**
   * Replaces a pending change with its merge onto the server's newer version
   * (docs/plans/foundation.md#D6); it stays pending, now against `etag`.
   * Only if the change is still `from`: an edit made meanwhile is never
   * overwritten (`null` then, and the next sync merges again).
   */
  rebase(
    id: string,
    from: string,
    merged: { ics: string; etag: string | null; baseIcs: string },
  ): Promise<StoredObject | null> {
    return this.exclusive(async () => {
      const current = await this.object(id);
      if (!current || current.ics !== from || current.pending === "delete") return null;
      const object = CalendarObject.parse(merged.ics);
      const { startMs, endMs } = boundsOf(object);
      const [row] = await this.db
        .update(schema.objects)
        .set({
          ...merged,
          uid: object.uid,
          kind: object.kind,
          startMs,
          endMs,
          updatedAt: Date.now(),
        })
        .where(eq(schema.objects.id, id))
        .returning();
      return row ?? null;
    });
  }

  removeObject(id: string): Promise<void> {
    return this.exclusive(() => this.removeObjectNow(id));
  }

  // The `…Now` methods run inside `exclusive`; they never call an exclusive method.
  private async removeObjectNow(id: string): Promise<void> {
    await this.db.delete(schema.objects).where(eq(schema.objects.id, id));
  }

  object(id: string): Promise<StoredObject | undefined> {
    return this.db.select().from(schema.objects).where(eq(schema.objects.id, id)).get();
  }

  objectAt(calendarId: string, href: string): Promise<StoredObject | undefined> {
    return this.db
      .select()
      .from(schema.objects)
      .where(and(eq(schema.objects.calendarId, calendarId), eq(schema.objects.href, href)))
      .get();
  }

  /**
   * The objects that may have an occurrence in the range, for
   * `occurrencesBetween` to place exactly. Objects deleted on this device are
   * left out.
   */
  objectsBetween(calendarIds: readonly string[], range: Range): Promise<StoredObject[]> {
    const fromMs = Date.parse(`${range.from}T00:00:00Z`) - ZONE_SLACK_MS;
    const toMs = Date.parse(`${range.to}T00:00:00Z`) + ZONE_SLACK_MS;
    return this.db
      .select()
      .from(schema.objects)
      .where(
        and(
          inArray(schema.objects.calendarId, [...calendarIds]),
          ne(schema.objects.pending, "delete"),
          isNotNull(schema.objects.startMs),
          lte(schema.objects.startMs, toMs),
          or(isNull(schema.objects.endMs), gte(schema.objects.endMs, fromMs)),
        ),
      );
  }

  /** The objects with no date at all: the task panel's tasks (docs/plans/foundation.md#D16). */
  undated(calendarIds: readonly string[]): Promise<StoredObject[]> {
    return this.db
      .select()
      .from(schema.objects)
      .where(
        and(
          inArray(schema.objects.calendarId, [...calendarIds]),
          ne(schema.objects.pending, "delete"),
          isNull(schema.objects.startMs),
        ),
      );
  }

  /** The local changes of a calendar the sync engine has to upload. */
  pending(calendarId: string): Promise<StoredObject[]> {
    return this.db
      .select()
      .from(schema.objects)
      .where(and(eq(schema.objects.calendarId, calendarId), ne(schema.objects.pending, "none")))
      .orderBy(schema.objects.updatedAt, schema.objects.id);
  }

  /** Every href of a calendar with its ETag, for a sync without sync tokens. */
  hrefs(
    calendarId: string,
  ): Promise<{ id: string; href: string; etag: string | null; pending: Pending }[]> {
    return this.db
      .select({
        id: schema.objects.id,
        href: schema.objects.href,
        etag: schema.objects.etag,
        pending: schema.objects.pending,
      })
      .from(schema.objects)
      .where(eq(schema.objects.calendarId, calendarId));
  }

  // Conflicts

  /** Keeps our refused version of an object (docs/plans/foundation.md#D6). */
  addConflict(objectId: string, localIcs: string): Promise<Conflict> {
    return this.exclusive(() => this.addConflictNow(objectId, localIcs));
  }

  private async addConflictNow(objectId: string, localIcs: string): Promise<Conflict> {
    CalendarObject.parse(localIcs);
    const conflict = { id: crypto.randomUUID(), objectId, localIcs, createdAt: Date.now() };
    await this.db.insert(schema.conflicts).values(conflict);
    return conflict;
  }

  conflicts(): Promise<Conflict[]> {
    return this.db.select().from(schema.conflicts).orderBy(schema.conflicts.createdAt);
  }

  removeConflict(id: string): Promise<void> {
    return this.exclusive(async () => {
      await this.db.delete(schema.conflicts).where(eq(schema.conflicts.id, id));
    });
  }

  /**
   * Runs read-then-write operations one at a time, so two of them never
   * interleave on the one connection (a second `saveLocal` of a new object
   * must see the first one's row).
   */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private queue: Promise<void> = Promise.resolve();

  private async upsert(
    calendarId: string,
    href: string,
    etag: string | null,
    ics: string,
    pending: Pending,
    baseIcs: string | null,
  ): Promise<StoredObject> {
    const object = CalendarObject.parse(ics);
    const { startMs, endMs } = boundsOf(object);
    const values = {
      etag,
      uid: object.uid,
      kind: object.kind,
      ics,
      pending,
      baseIcs,
      startMs,
      endMs,
      updatedAt: Date.now(),
    };
    const [row] = await this.db
      .insert(schema.objects)
      .values({ ...values, id: crypto.randomUUID(), calendarId, href })
      .onConflictDoUpdate({ target: [schema.objects.calendarId, schema.objects.href], set: values })
      .returning();
    return row!;
  }
}

function toCalendar(row: typeof schema.calendars.$inferSelect): Calendar {
  return { ...row, components: row.components.split(",").filter(Boolean) as Component[] };
}
