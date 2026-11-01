// The Conflicts list (docs/plans/foundation.md#D6): each change of ours the
// server refused, beside what the calendar holds now (the server's version,
// or ours merged onto it), the fields they differ in, and the two ways out:
// keep the server's (ours is dropped) or apply ours again (a new pending
// change over the server's version, which the next sync uploads).
import { CalendarObject, differences } from "@astrotime/core";
import type { Calendar, Conflict, Store, StoredObject } from "@astrotime/storage";

export interface ConflictView {
  readonly conflict: Conflict;
  readonly stored: StoredObject;
  readonly calendar: Calendar | undefined;
  /** Our refused version. */
  readonly ours: CalendarObject;
  /** What this device holds now: the server's version, or ours merged onto it. */
  readonly theirs: CalendarObject;
  /** The fields they differ in (`differences`). */
  readonly fields: readonly string[];
}

/** The conflicts with what they need to be shown; one whose object cannot be read is left out. */
export async function conflictViews(store: Store): Promise<ConflictView[]> {
  const calendars = new Map((await store.calendars()).map((c) => [c.id, c]));
  const views: ConflictView[] = [];
  for (const conflict of await store.conflicts()) {
    const stored = await store.object(conflict.objectId);
    if (!stored) continue;
    try {
      views.push({
        conflict,
        stored,
        calendar: calendars.get(stored.calendarId),
        ours: CalendarObject.parse(conflict.localIcs),
        theirs: CalendarObject.parse(stored.ics),
        fields: differences(stored.ics, conflict.localIcs),
      });
    } catch {
      // The store holds only valid objects (D36); one that is not is not listed.
    }
  }
  return views;
}

/** Keeps the server's version: ours is dropped. */
export function keepServer(store: Store, view: ConflictView): Promise<void> {
  return store.removeConflict(view.conflict.id);
}

/**
 * Applies ours again: saved over what the calendar holds, as a pending
 * change against the server's version, then out of the list. A creation
 * whose place the server gave another item goes to a place of its own.
 */
export async function applyMine(
  store: Store,
  view: ConflictView,
  random: () => string = () => crypto.randomUUID().slice(0, 8),
): Promise<void> {
  const { stored, ours, conflict } = view;
  const href =
    stored.uid === ours.uid ? stored.href : `${encodeURIComponent(ours.uid)}-${random()}.ics`;
  await store.saveLocal(stored.calendarId, conflict.localIcs, href);
  await store.removeConflict(conflict.id);
}
