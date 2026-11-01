import {
  boundsOf,
  CalendarObject,
  CalendarObjectError,
  ExpansionLimitError,
  isDone,
  latestUndoneBefore,
  type Occurrence,
  type Range,
  type Reminder,
  remindersOf,
  wallClockOf,
} from "@astrotime/core";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";

import { transaction, type SqlDriver } from "./driver.ts";
import { migrate } from "./migrations.ts";
import * as schema from "./schema.ts";
import { containsPattern, foldForSearch, titlesOf } from "./search.ts";

export type Account = typeof schema.accounts.$inferSelect;
export type Calendar = Omit<typeof schema.calendars.$inferSelect, "components"> & {
  readonly components: readonly Component[];
};
export type StoredObject = typeof schema.objects.$inferSelect;
export type Conflict = typeof schema.conflicts.$inferSelect;
export type Component = "VEVENT" | "VTODO";
export type Pending = StoredObject["pending"];

/** A task that rolls over to today, with the occurrence it counts by (design D51). */
export interface UndoneTask {
  readonly object: StoredObject;
  readonly occurrence: Occurrence;
}

/** The most a zone is from UTC; a range of days is widened by it to find candidates. */
const ZONE_SLACK_MS = 14 * 3_600_000;

/**
 * How long after an event ends its alarms are still looked for: an event's
 * alarm fires before it or while it runs, and RFC 5545 allows one after,
 * which no client we know writes (docs/plans/foundation.md#D100).
 */
const EVENT_ALARM_LAG_MS = 7 * 86_400_000;

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
      async (statement, params, method) => {
        const rows = await driver.query(statement, params);
        // Drizzle reads `get` as one row, and no row as `undefined`.
        return { rows: method === "get" ? (rows[0] as unknown[]) : rows };
      },
      { schema },
    );
    const store = new Store(db, driver);
    // Writes from elsewhere (another tab, on the web) are heard as this store's own.
    store.unsubscribe = driver.subscribe?.(() => store.notify());
    return store;
  }

  private unsubscribe: (() => void) | undefined;

  close(): Promise<void> {
    this.unsubscribe?.();
    return this.driver.close();
  }

  /**
   * Calls `listener` after every write, before the write's promise resolves,
   * so a view reads the store again (a sync writes while the app is open),
   * and after another tab's (docs/plans/foundation.md#D98). Returns the
   * function that stops it.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private readonly listeners = new Set<() => void>();

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        // A listener's failure is reported, but never fails the write.
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  // Accounts

  addAccount(
    input: Omit<Account, "id" | "createdAt" | "homeUrl"> & { homeUrl?: string | null },
  ): Promise<Account> {
    return this.exclusive(async () => {
      const account = { homeUrl: null, ...input, id: crypto.randomUUID(), createdAt: Date.now() };
      await this.db.insert(schema.accounts).values(account);
      return account;
    });
  }

  accounts(): Promise<Account[]> {
    return this.db.select().from(schema.accounts).orderBy(schema.accounts.createdAt);
  }

  /** Changes what an account says of itself (signing in again finds its home anew). */
  updateAccount(
    id: string,
    changes: Partial<Pick<Account, "name" | "username" | "homeUrl">>,
  ): Promise<void> {
    return this.exclusive(async () => {
      await this.db.update(schema.accounts).set(changes).where(eq(schema.accounts.id, id));
    });
  }

  /** Removes the account with its calendars, objects and conflicts. */
  removeAccount(id: string): Promise<void> {
    return this.exclusive(async () => {
      await this.db.delete(schema.accounts).where(eq(schema.accounts.id, id));
      // Its calendars' undone tasks are no longer asked about by anyone.
      this.undoneCache.clear();
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
      for (const [objectId, entry] of this.undoneCache) {
        if (entry.calendarId === id) this.undoneCache.delete(objectId);
      }
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
      const [row] = await this.db
        .update(schema.objects)
        .set({ ...merged, ...indexOf(object), updatedAt: Date.now() })
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

  /**
   * The undone tasks whose due is before `day` starts in `timeZone`, each
   * with the occurrence it counts by, oldest due first: the "N undone tasks"
   * chip on today (design D51). A series too dense to expand is left out.
   */
  async undoneTasksBefore(
    calendarIds: readonly string[],
    day: string,
    timeZone: string,
  ): Promise<UndoneTask[]> {
    const candidates = await this.db
      .select()
      .from(schema.objects)
      .where(
        and(
          inArray(schema.objects.calendarId, [...calendarIds]),
          eq(schema.objects.kind, "task"),
          ne(schema.objects.pending, "delete"),
          or(isNull(schema.objects.done), eq(schema.objects.done, false)),
          lt(schema.objects.startMs, Date.parse(`${day}T00:00:00Z`) + ZONE_SLACK_MS),
        ),
      );
    const undone: (UndoneTask & { key: string })[] = [];
    const seen = new Set<string>();
    for (const object of candidates) {
      seen.add(object.id);
      const occurrence = this.undoneOccurrence(object, day, timeZone);
      if (occurrence) {
        // Ties by title, in code-unit order, the same on every platform.
        const key = `${wallClockOf(occurrence.end, timeZone)} ${occurrence.item.summary ?? ""}`;
        undone.push({ object, occurrence, key });
      }
    }
    // Objects of these calendars no longer candidates (done, deleted) leave
    // the cache; a calendar not asked about (hidden for now) keeps its own.
    const asked = new Set(calendarIds);
    for (const [id, entry] of this.undoneCache) {
      if (asked.has(entry.calendarId) && !seen.has(id)) this.undoneCache.delete(id);
    }
    return undone
      .toSorted((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(({ object, occurrence }) => ({ object, occurrence }));
  }

  /**
   * The occurrence an undone task counts by, remembered per object until its
   * iCalendar, the day or the zone changes: the chip is asked again on every
   * change to the store, and a series is expanded from its first occurrence.
   * A series too dense to expand counts as none (foundation's Deferred
   * "Expanding long series from the middle").
   */
  private undoneOccurrence(object: StoredObject, day: string, timeZone: string): Occurrence | null {
    const known = this.undoneCache.get(object.id);
    if (known && known.ics === object.ics && known.day === day && known.timeZone === timeZone) {
      return known.occurrence;
    }
    let occurrence: Occurrence | null;
    try {
      occurrence = latestUndoneBefore(CalendarObject.parse(object.ics), day, timeZone);
    } catch (error) {
      if (!(error instanceof ExpansionLimitError)) throw error;
      occurrence = null;
    }
    this.undoneCache.set(object.id, {
      calendarId: object.calendarId,
      ics: object.ics,
      day,
      timeZone,
      occurrence,
    });
    return occurrence;
  }

  private readonly undoneCache = new Map<
    string,
    {
      calendarId: string;
      ics: string;
      day: string;
      timeZone: string;
      occurrence: Occurrence | null;
    }
  >();

  /** Every task of the calendars, dated or not: the lists of the tasks screen (design D52). */
  tasks(calendarIds: readonly string[]): Promise<StoredObject[]> {
    return this.db
      .select()
      .from(schema.objects)
      .where(
        and(
          inArray(schema.objects.calendarId, [...calendarIds]),
          eq(schema.objects.kind, "task"),
          ne(schema.objects.pending, "delete"),
        ),
      );
  }

  /**
   * The objects of the calendars with a title that holds `text`, ignoring
   * case and diacritics (design D53): at most `limit`, the latest start
   * first, undated ones last. Objects deleted on this device are left out.
   */
  async search(calendarIds: readonly string[], text: string, limit = 50): Promise<StoredObject[]> {
    const folded = foldForSearch(text.trim());
    if (folded === "") return [];
    const where = (titles: SQL) =>
      and(
        inArray(schema.objects.calendarId, [...calendarIds]),
        ne(schema.objects.pending, "delete"),
        titles,
      );
    const found = await this.db
      .select()
      .from(schema.objects)
      .where(where(sql`${schema.objects.titles} LIKE ${containsPattern(folded)} ESCAPE '\\'`))
      .orderBy(desc(schema.objects.startMs))
      .limit(limit);
    // Rows written before migration 6 have no titles yet: read from their
    // iCalendar once, and kept, so the next search finds them by the column.
    const older = await this.db
      .select()
      .from(schema.objects)
      .where(where(sql`${schema.objects.titles} IS NULL`));
    const matching: StoredObject[] = [];
    for (const row of older) {
      const titles = titlesOf(CalendarObject.parse(row.ics));
      // Only if the row is unchanged since it was read; not a change readers need to hear of.
      await this.db
        .update(schema.objects)
        .set({ titles })
        .where(and(eq(schema.objects.id, row.id), eq(schema.objects.ics, row.ics)));
      if (titles.includes(folded)) matching.push({ ...row, titles });
    }
    if (matching.length === 0) return found;
    return [...found, ...matching]
      .toSorted((a, b) => (b.startMs ?? -Infinity) - (a.startMs ?? -Infinity))
      .slice(0, limit);
  }

  /**
   * The reminders of every calendar, hidden ones too, that fire within the
   * range's days in its zone, soonest first (docs/plans/foundation.md#D100).
   * Candidates are the objects with a `VALARM` that are not deleted here nor
   * done tasks: every task, wherever its dates are (an alarm at a time of its
   * own can remind of an overdue or undated one), and the events that end
   * after the range starts, less `EVENT_ALARM_LAG_MS`. Each is computed
   * once while its iCalendar, the range and the zone stay; a series too
   * dense to expand reminds of nothing (foundation's Deferred "Expanding long
   * series from the middle").
   */
  async reminders(range: Range): Promise<Reminder[]> {
    const fromMs = Date.parse(`${range.from}T00:00:00Z`) - ZONE_SLACK_MS;
    const candidates = await this.db
      .select({ id: schema.objects.id, ics: schema.objects.ics })
      .from(schema.objects)
      .where(
        and(
          ne(schema.objects.pending, "delete"),
          or(isNull(schema.objects.done), eq(schema.objects.done, false)),
          // LIKE ignores ASCII case, as iCalendar's names do.
          like(schema.objects.ics, "%BEGIN:VALARM%"),
          or(
            eq(schema.objects.kind, "task"),
            isNull(schema.objects.endMs),
            gte(schema.objects.endMs, fromMs - EVENT_ALARM_LAG_MS),
          ),
        ),
      );
    const seen = new Set<string>();
    const reminders: Reminder[] = [];
    for (const object of candidates) {
      seen.add(object.id);
      const known = this.reminderCache.get(object.id);
      if (
        known &&
        known.ics === object.ics &&
        known.from === range.from &&
        known.to === range.to &&
        known.timeZone === range.timeZone
      ) {
        reminders.push(...known.reminders);
        continue;
      }
      let found: Reminder[];
      try {
        found = remindersOf(CalendarObject.parse(object.ics), object.id, range);
      } catch (error) {
        // A series too dense to expand reminds of nothing, as the views leave
        // it out; and one odd object never costs every other its reminders.
        if (!(error instanceof ExpansionLimitError || error instanceof CalendarObjectError)) {
          throw error;
        }
        found = [];
      }
      this.reminderCache.set(object.id, { ...range, ics: object.ics, reminders: found });
      reminders.push(...found);
    }
    for (const id of this.reminderCache.keys()) if (!seen.has(id)) this.reminderCache.delete(id);
    return reminders.toSorted(
      (a, b) => a.fireAt - b.fireAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  }

  private readonly reminderCache = new Map<
    string,
    { ics: string; from: string; to: string; timeZone: string; reminders: Reminder[] }
  >();

  /** The objects with no date at all: the tasks screen's undated tasks (docs/plans/foundation.md#D16). */
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
    return (
      this.db
        .select()
        .from(schema.objects)
        .where(and(eq(schema.objects.calendarId, calendarId), ne(schema.objects.pending, "none")))
        // Changes made in the same millisecond keep the order their rows were made in.
        .orderBy(schema.objects.updatedAt, sql`rowid`)
    );
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
   * Runs read-then-write operations one at a time, each in a transaction
   * (docs/plans/foundation.md#D99), so two of them never interleave (a second
   * `saveLocal` of a new object must see the first one's row), not even from
   * two tabs on one database, and a failed one leaves nothing of itself.
   */
  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      try {
        return await transaction(this.driver, operation);
      } finally {
        this.notify();
      }
    });
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
    const values = {
      etag,
      ...indexOf(CalendarObject.parse(ics)),
      ics,
      pending,
      baseIcs,
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

/** The columns an object is found by, read from its iCalendar. */
function indexOf(object: CalendarObject) {
  return {
    uid: object.uid,
    kind: object.kind,
    ...boundsOf(object),
    done: object.master !== null && isDone(object.master),
    titles: titlesOf(object),
  };
}

function toCalendar(row: typeof schema.calendars.$inferSelect): Calendar {
  return { ...row, components: row.components.split(",").filter(Boolean) as Component[] };
}
