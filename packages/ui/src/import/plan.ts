// Where an import's sources go and how they are written
// (docs/plans/import.md#D269–#D271): per source its events to one calendar
// and its tasks to one list, an existing one or a new one on this device;
// the UIDs already there found first; then the writes through the store, as
// changes made here (D5), a batch a transaction, the page given back
// between batches, stopped between them when asked.
import { ALL_RIGHTS, sameObjects } from "@astrotime/core";
import { overlay, withUid } from "@astrotime/core/split";
import {
  LOCAL_SERVER,
  type Calendar,
  type Component,
  type Store,
  type StoredObject,
} from "@astrotime/storage";

import { calendarsFor, firstCalendarFor } from "../calendar/editing.ts";
import type { ImportItem, Source } from "./read.ts";

/** An existing calendar's id, or `NEW`: a new calendar on this device named after the source. */
type Target = string;
export const NEW = "new";

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
    if (target === NEW) continue;
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
  /** The calendars made on this device, by source. */
  readonly made: ReadonlyMap<string, Calendar>;
}

export interface Run {
  readonly store: Store;
  readonly sources: readonly Source[];
  readonly destinations: ReadonlyMap<string, Destination>;
  readonly duplicates: Duplicates;
  readonly choice: Choice;
  /** The account a new calendar on this device goes on, if none is there, is named so. */
  readonly accountName: string;
  readonly newUid: () => string;
  readonly onProgress: (done: number, total: number) => void;
  readonly stopped: () => boolean;
  readonly pause?: () => Promise<void>;
}

/**
 * A new calendar on this device (D269): on the account of provider `local`,
 * made (named `names.account`) when there is none, under an address of its
 * own, so it keeps its name and never steps aside as the first one does
 * (`Store.removeLocalCalendarIfUnused`, foundation D122). Here, with the
 * import, not in the store, which loads with the app.
 */
async function addDeviceCalendar(
  store: Store,
  names: {
    readonly account: string;
    readonly calendar: string;
    readonly color: string | null;
    readonly components: readonly Component[];
  },
): Promise<Calendar> {
  const local =
    (await store.accounts()).find((account) => account.provider === "local") ??
    (await store.addAccount({
      provider: "local",
      name: names.account,
      serverUrl: LOCAL_SERVER,
      username: null,
    }));
  return store.saveCalendar({
    accountId: local.id,
    url: `${LOCAL_SERVER}${crypto.randomUUID()}/`,
    name: names.calendar,
    color: names.color,
    components: names.components,
    rights: ALL_RIGHTS,
  });
}

export const BATCH = 200;
const yieldToPage = () => new Promise<void>((resolve) => setTimeout(resolve));

export async function runImport(run: Run): Promise<Imported> {
  const { store, duplicates, choice } = run;
  const pause = run.pause ?? yieldToPage;
  // A new calendar on this device per source that asks for one, taking what goes to it.
  const made = new Map<string, Calendar>();
  try {
    for (const source of run.sources) {
      const to = run.destinations.get(source.id);
      const components: Component[] = [];
      if (to?.events === NEW) components.push("VEVENT");
      if (to?.tasks === NEW) components.push("VTODO");
      if (components.length === 0) continue;
      made.set(
        source.id,
        await addDeviceCalendar(store, {
          account: run.accountName,
          calendar: source.name,
          color: source.color,
          components,
        }),
      );
    }
  } catch (error) {
    // One that could not be made: the ones made before it go again, empty.
    for (const calendar of made.values()) await store.removeCalendar(calendar.id);
    throw error;
  }

  const writes: {
    calendarId: string;
    ics: string;
    kind: "event" | "task";
    as: "new" | "update" | "copy";
  }[] = [];
  let skipped = 0;
  let again = 0;
  const all = placed(run.sources, run.destinations).map(({ item, source, target }) => ({
    item,
    calendarId: target === NEW ? made.get(source.id)!.id : target,
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
              ics: withUid(item.ics, uids!.get(item.uid)!, uids),
              kind: item.kind,
              as: "copy",
            }
          : // The file's changes over what is stored: what only it has stays (D7).
            { calendarId, ics: overlay(there.ics, item.ics), kind: item.kind, as: "update" },
      );
      continue;
    }
    // A new item whose parent is copied in this run names the copy.
    const uids = copied.get(calendarId);
    const ics =
      uids && /^RELATED-TO/m.test(item.ics) ? withUid(item.ics, item.uid, uids) : item.ics;
    writes.push({ calendarId, ics, kind: item.kind, as: "new" });
  }

  let done = 0;
  let stopped = false;
  let error: string | null = null;
  run.onProgress(0, writes.length);
  for (let i = 0; i < writes.length; i += BATCH) {
    if (run.stopped()) {
      stopped = true;
      break;
    }
    const batch = writes.slice(i, i + BATCH);
    try {
      // The store finds an object of the same UID itself, and updates it
      // (D270); a batch is one transaction, so a failed one wrote nothing.
      await store.changeLocal(async (local) => {
        for (const write of batch) await local.save(write.calendarId, write.ics);
      });
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      break;
    }
    done += batch.length;
    run.onProgress(done, writes.length);
    await pause();
  }
  const written = writes.slice(0, done);
  // A calendar made for the import that got nothing (stopped, or failed, first) goes again.
  for (const [id, calendar] of made) {
    if (!written.some((write) => write.calendarId === calendar.id)) {
      await store.removeCalendar(calendar.id);
      made.delete(id);
    }
  }
  const count = (kind: "event" | "task") => written.filter((write) => write.kind === kind).length;
  return {
    events: count("event"),
    tasks: count("task"),
    updated: written.filter((write) => write.as === "update").length,
    copies: written.filter((write) => write.as === "copy").length,
    identical: duplicates.identical,
    skipped,
    again,
    stopped,
    error,
    made,
  };
}
