// Where an import's sources go and how they are written
// (docs/plans/import.md#D269–#D271): per source its events to one calendar
// and its tasks to one list, an existing one or a new one on this device;
// the UIDs already there found first; then the writes through the store, as
// changes made here (D5), a batch a transaction, the page given back
// between batches, stopped between them when asked.
import { sameObjects, type NewCalendar } from "@astrotime/core";
import { overlay, withUid } from "@astrotime/core/split";
import type { Calendar, Component, Store, StoredObject } from "@astrotime/storage";

import { addDeviceCalendar } from "../calendar/device-calendar.ts";
import { calendarsFor, firstCalendarFor } from "../calendar/editing.ts";
import type { ImportItem, Source } from "./read.ts";

/**
 * An existing calendar's id; `NEW`, a new calendar on this device named
 * after the source; or `newOn(account)`, a new one on that account's
 * server (D277).
 */
type Target = string;
export const NEW = "new";
const ON = "new:";
export const newOn = (accountId: string) => `${ON}${accountId}`;
/** The account a target makes its new calendar on; `null` for any other. */
const accountOfNew = (target: Target) => (target.startsWith(ON) ? target.slice(ON.length) : null);
const isNew = (target: Target) => target === NEW || target.startsWith(ON);

/** Per source, where its events and its tasks go; none for a kind it has not. */
export interface Destination {
  readonly events: Target | null;
  readonly tasks: Target | null;
}

const kindsOf = (source: Source) => ({
  events: source.items.some((item) => item.kind === "event"),
  tasks: source.items.some((item) => item.kind === "task"),
});

/** The calendars an import may write a kind into: those that take new items of it (D37). */
export const targetsFor = calendarsFor;

/**
 * Where a source goes first (D269): a calendar of the same name that takes
 * the kind, else the one new items go to, else a new one on this device.
 */
export function destinationOf(
  source: Source,
  calendars: readonly Calendar[],
  hidden: ReadonlySet<string>,
): Destination {
  const kinds = kindsOf(source);
  const pick = (kind: "event" | "task") => {
    const named = calendarsFor(calendars, kind).find(
      (calendar) => calendar.name.toLocaleLowerCase() === source.name.toLocaleLowerCase(),
    );
    return (named ?? firstCalendarFor(calendars, kind, hidden))?.id ?? NEW;
  };
  return { events: kinds.events ? pick("event") : null, tasks: kinds.tasks ? pick("task") : null };
}

/** An item's place: the source it is from and where it goes. */
interface Placed {
  readonly item: ImportItem;
  readonly source: Source;
  readonly target: Target;
}

function placed(
  sources: readonly Source[],
  destinations: ReadonlyMap<string, Destination>,
): Placed[] {
  return sources.flatMap((source) => {
    const to = destinations.get(source.id);
    return source.items.flatMap((item) => {
      const target = item.kind === "event" ? to?.events : to?.tasks;
      return target ? [{ item, source, target }] : [];
    });
  });
}

/** The items whose UID is already in the calendar they go to: the same item, or another (D270). */
export interface Duplicates {
  readonly identical: number;
  readonly changed: number;
  /** By target and UID, the object there. */
  readonly existing: ReadonlyMap<string, StoredObject>;
  /** The keys of those that are the same item. */
  readonly same: ReadonlySet<string>;
}

const keyOf = (target: string, uid: string) => `${target}\n${uid}`;

/** Every day a stored object can start on. */
const EVER = { from: "0001-01-01", to: "9999-12-31", timeZone: "UTC" };

export async function duplicatesOf(
  store: Store,
  sources: readonly Source[],
  destinations: ReadonlyMap<string, Destination>,
): Promise<Duplicates> {
  const byTarget = new Map<string, ImportItem[]>();
  for (const { item, target } of placed(sources, destinations)) {
    if (isNew(target)) continue;
    byTarget.set(target, [...(byTarget.get(target) ?? []), item]);
  }
  const existing = new Map<string, StoredObject>();
  const same = new Set<string>();
  let changed = 0;
  for (const [target, items] of byTarget) {
    // Every object of the calendar, dated or not, by the store's own reads:
    // no query of its own on the first load for an import (foundation D145).
    const stored = [
      ...(await store.objectsBetween([target], EVER)),
      ...(await store.undated([target])),
    ];
    const found = new Map(stored.map((object) => [object.uid, object]));
    for (const item of items) {
      const there = found.get(item.uid);
      if (!there) continue;
      const key = keyOf(target, item.uid);
      existing.set(key, there);
      if (sameObjects(there.ics, item.ics)) same.add(key);
      else changed++;
    }
  }
  return { identical: same.size, changed, existing, same };
}

/** What to do with an item that differs from the one already there (D270). */
export type Choice = "update" | "copy" | "skip";

export interface Imported {
  readonly events: number;
  readonly tasks: number;
  readonly updated: number;
  readonly copies: number;
  /** The same item already there. */
  readonly identical: number;
  /** Differing, and skipped as asked. */
  readonly skipped: number;
  /** Given again in the file under a UID this run already wrote to the same calendar. */
  readonly again: number;
  /** Stopped before the end: what came before stays. */
  readonly stopped: boolean;
  /** Why it ended before the end, if a write failed: what came before stays. */
  readonly error: string | null;
  /** Why a calendar made for it and left empty could not be removed again. */
  readonly cleanup: string | null;
  /** The calendars made on this device, by source. */
  readonly made: ReadonlyMap<string, Calendar>;
  /** The calendars made on an account's server (D277): they stay there, as made. */
  readonly onServer: readonly Calendar[];
}

export interface Run {
  readonly store: Store;
  readonly sources: readonly Source[];
  readonly destinations: ReadonlyMap<string, Destination>;
  readonly duplicates: Duplicates;
  readonly choice: Choice;
  /** The account a new calendar on this device goes on, if none is there, is named so. */
  readonly accountName: string;
  /** Makes a calendar on an account's server now (`makeCalendar`, providers D275), for `newOn`. */
  readonly make?: (accountId: string, calendar: NewCalendar) => Promise<Calendar>;
  readonly newUid: () => string;
  readonly onProgress: (done: number, total: number) => void;
  readonly stopped: () => boolean;
  readonly pause?: () => Promise<void>;
}

/**
 * A calendar the import made on this device, removed again: with the
 * account it is on when the import made that account too and it has no
 * calendar left; an account the user had stays, as the user had it.
 */
async function unmake(
  store: Store,
  calendar: Calendar,
  ownAccounts: ReadonlySet<string>,
): Promise<void> {
  await store.removeCalendar(calendar.id);
  if (
    ownAccounts.has(calendar.accountId) &&
    (await store.calendars(calendar.accountId)).length === 0
  )
    await store.removeAccount(calendar.accountId);
}

export const BATCH = 200;
const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve));

export async function runImport(run: Run): Promise<Imported> {
  const { store, duplicates, choice } = run;
  const pause = run.pause ?? yieldToPage;
  // A new calendar on this device per source that asks for one, taking what goes to it.
  const made = new Map<string, Calendar>();
  /** The device accounts this run made, which alone it may take back. */
  const ownAccounts = new Set<string>();
  // On a server, one calendar per kind (a CalDAV calendar holds one
  // component, providers D275), made first: one that cannot be made stops
  // the import before anything is written. One made stays on its server,
  // as made there, even if the import then stops.
  const onServer = new Map<string, Calendar>();
  for (const source of run.sources) {
    const to = run.destinations.get(source.id);
    for (const [kind, component] of [
      ["events", "VEVENT"],
      ["tasks", "VTODO"],
    ] as const) {
      const account = to?.[kind] ? accountOfNew(to[kind]) : null;
      if (account === null) continue;
      if (!run.make) throw new Error("No calendar can be made on a server here.");
      onServer.set(
        `${source.id}\n${kind}`,
        await run.make(account, { name: source.name, color: source.color, component }),
      );
    }
  }
  try {
    for (const source of run.sources) {
      const to = run.destinations.get(source.id);
      const components: Component[] = [];
      if (to?.events === NEW) components.push("VEVENT");
      if (to?.tasks === NEW) components.push("VTODO");
      if (components.length === 0) continue;
      made.set(
        source.id,
        await addDeviceCalendar(
          store,
          {
            account: run.accountName,
            calendar: source.name,
            color: source.color,
            components,
          },
          (id) => ownAccounts.add(id),
        ),
      );
    }
  } catch (error) {
    // One that could not be made: the ones made before it go again, empty;
    // one of those that cannot go does not hide why the import stopped.
    for (const calendar of made.values())
      await unmake(store, calendar, ownAccounts).catch(() => {});
    // An account made just before its calendar could not be: it goes too.
    for (const id of ownAccounts) {
      const left = await store.calendars(id).catch(() => [null]);
      if (left.length === 0) await store.removeAccount(id).catch(() => {});
    }
    throw error;
  }

  const writes: {
    calendarId: string;
    /** The UID the file gave it. */
    uid: string;
    ics: string;
    kind: "event" | "task";
    as: "new" | "update" | "copy";
  }[] = [];
  let skipped = 0;
  let again = 0;
  const all = placed(run.sources, run.destinations).map(({ item, source, target }) => ({
    item,
    calendarId:
      target === NEW
        ? made.get(source.id)!.id
        : accountOfNew(target) !== null
          ? onServer.get(`${source.id}\n${item.kind === "event" ? "events" : "tasks"}`)!.id
          : target,
    key: keyOf(target, item.uid),
  }));
  // The copies' new UIDs, made first, so a copied subtask names its copied
  // parent (`RELATED-TO`), not the original, by calendar.
  const copied = new Map<string, Map<string, string>>();
  if (choice === "copy") {
    for (const { item, calendarId, key } of all) {
      if (!duplicates.existing.has(key) || duplicates.same.has(key)) continue;
      const uids = copied.get(calendarId) ?? new Map<string, string>();
      if (!uids.has(item.uid)) uids.set(item.uid, run.newUid());
      copied.set(calendarId, uids);
    }
  }
  /** What this run writes, by calendar and UID: one UID a calendar, once (two sources, two files of a ZIP). */
  const writing = new Set<string>();
  for (const { item, calendarId, key } of all) {
    if (writing.has(keyOf(calendarId, item.uid))) {
      again++;
      continue;
    }
    writing.add(keyOf(calendarId, item.uid));
    if (duplicates.same.has(key)) continue;
    const there = duplicates.existing.get(key);
    if (there) {
      if (choice === "skip") {
        skipped++;
        continue;
      }
      const uids = copied.get(calendarId);
      writes.push(
        choice === "copy"
          ? {
              calendarId,
              uid: item.uid,
              ics: withUid(item.ics, uids!.get(item.uid)!, uids),
              kind: item.kind,
              as: "copy",
            }
          : // The file's changes over what is stored: what only it has stays (D7).
            {
              calendarId,
              uid: item.uid,
              ics: overlay(there.ics, item.ics),
              kind: item.kind,
              as: "update",
            },
      );
      continue;
    }
    // A new item whose parent is copied in this run names the copy.
    const uids = copied.get(calendarId);
    const ics =
      uids && /^RELATED-TO/m.test(item.ics) ? withUid(item.ics, item.uid, uids) : item.ics;
    writes.push({ calendarId, uid: item.uid, ics, kind: item.kind, as: "new" });
  }

  let done = 0;
  let stopped = false;
  let error: string | null = null;
  let identical = duplicates.identical;
  const written: typeof writes = [];
  run.onProgress(0, writes.length);
  for (let i = 0; i < writes.length; i += BATCH) {
    if (run.stopped()) {
      stopped = true;
      break;
    }
    let batch: typeof writes = [];
    /** The copies late UIDs asked for in this batch, by calendar: their new UIDs. */
    let late = new Map<string, Map<string, string>>();
    // Counted once the batch is written: a batch that fails wrote nothing.
    let same = 0;
    let left = 0;
    try {
      // In the batch's own transaction (D99): a UID a sync brought into the
      // calendar since the check is already there, as the check would have
      // found it (D270), so the answer given (or "skip", where none was
      // asked) decides, and an update overlays; no sync writes in between.
      const fresh = writes.slice(i, i + BATCH);
      await store.changeLocal(async (local) => {
        batch = [];
        same = 0;
        left = 0;
        const there = new Map<string, StoredObject>();
        for (const calendarId of new Set(
          fresh.filter((w) => w.as === "new").map((w) => w.calendarId),
        )) {
          const uids = fresh
            .filter((w) => w.as === "new" && w.calendarId === calendarId)
            .map((w) => w.uid);
          for (const object of await local.withUids(calendarId, uids))
            there.set(keyOf(calendarId, object.uid), object);
        }
        // The copies a late UID asks for get their UIDs first, so the
        // items of this batch that name one (a subtask's RELATED-TO) name
        // the copy, as the planned copies do.
        late = new Map();
        const fates = fresh.map((write) => {
          const found =
            write.as === "new" ? there.get(keyOf(write.calendarId, write.uid)) : undefined;
          if (!found) return { write, as: write.as };
          if (sameObjects(found.ics, write.ics)) return { write, as: "same" as const };
          if (choice === "skip") return { write, as: "left" as const };
          if (choice === "copy") {
            const uids = late.get(write.calendarId) ?? new Map<string, string>();
            uids.set(write.uid, run.newUid());
            late.set(write.calendarId, uids);
            return { write, as: "copy" as const };
          }
          return { write, as: "update" as const, ics: overlay(found.ics, write.ics) };
        });
        for (const fate of fates) {
          const { write } = fate;
          if (fate.as === "same") same++;
          else if (fate.as === "left") left++;
          else {
            const names = new Map([
              ...(copied.get(write.calendarId) ?? []),
              ...(late.get(write.calendarId) ?? []),
            ]);
            // Its own UID now: a copy's new one, else the file's.
            const own = names.get(write.uid) ?? write.uid;
            const ics = "ics" in fate ? fate.ics! : write.ics;
            const renamed =
              late.has(write.calendarId) && (fate.as === "copy" || /^RELATED-TO/m.test(ics))
                ? withUid(ics, fate.as === "copy" ? own : write.uid, names)
                : ics;
            batch.push({ ...write, ics: renamed, as: fate.as });
          }
        }
        // The store finds an object of the same UID itself, and updates it
        // (D270); a batch is one transaction, so a failed one wrote nothing.
        for (const write of batch) await local.save(write.calendarId, write.ics);
      });
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      break;
    }
    written.push(...batch);
    // A later batch's subtask names a copy made here too.
    for (const [calendarId, uids] of late)
      copied.set(calendarId, new Map([...(copied.get(calendarId) ?? []), ...uids]));
    identical += same;
    skipped += left;
    done += Math.min(BATCH, writes.length - i);
    run.onProgress(done, writes.length);
    await pause();
  }
  // A calendar made for the import that got nothing (stopped, or failed, first)
  // goes again; if it cannot, that is said beside what was imported, not instead.
  let cleanup: string | null = null;
  for (const [id, calendar] of made) {
    if (written.some((write) => write.calendarId === calendar.id)) continue;
    try {
      await unmake(store, calendar, ownAccounts);
      made.delete(id);
    } catch (failure) {
      cleanup = failure instanceof Error ? failure.message : String(failure);
    }
  }
  const count = (kind: "event" | "task") => written.filter((write) => write.kind === kind).length;
  return {
    events: count("event"),
    tasks: count("task"),
    updated: written.filter((write) => write.as === "update").length,
    copies: written.filter((write) => write.as === "copy").length,
    identical,
    skipped,
    again,
    stopped,
    error,
    cleanup,
    made,
    onServer: [...onServer.values()],
  };
}
