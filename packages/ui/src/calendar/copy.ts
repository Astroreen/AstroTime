// A copy of an item opened (design D164): "Make a copy" saved at once, and
// "Copy to…"'s form and new item. Loaded with the details' menu, not with the
// app (docs/plans/foundation.md#D145).
import { CalendarObject, type ItemChanges } from "@astrotime/core";
import { copyItem, createFromCopy } from "@astrotime/core/copy";
import type { Calendar, Store } from "@astrotime/storage";

import {
  calendarsFor,
  changeLocal,
  current,
  firstCalendarFor,
  formOf,
  RefusedError,
  type Form,
  type Target,
  type Writes,
} from "./editing.ts";

/**
 * The item opened as a copy of its own (design D164), not yet saved: the
 * occurrence with a new UID (`copyItem`), and the target it stands for, in
 * the item's calendar ("Copy to" opens it in the edit dialog).
 */
export function copyOf(target: Target, writes: Writes): { ics: string; target: Target } {
  const ics = copyItem(target.object, target.recurrenceId, { now: writes.now, uid: writes.uid() });
  const object = CalendarObject.parse(ics);
  const item = object.master!;
  return {
    ics,
    target: { objectId: "", calendarId: target.calendarId, object, recurrenceId: null, item },
  };
}

/**
 * "Copy to…" (design D164): the copy's iCalendar and the edit dialog's form
 * of it, in the item's calendar while it takes new items, else in the first
 * that does (`firstCalendarFor`, visible before hidden).
 */
export function copyToForm(
  target: Target,
  calendars: readonly Calendar[],
  hidden: ReadonlySet<string>,
  options: { readonly timeZone: string; readonly today: string; readonly writes: Writes },
): { ics: string; form: Form } {
  const copy = copyOf(target, options.writes);
  const form = formOf(copy.target, options.timeZone, options.today);
  const kind = copy.target.item.kind;
  const own = calendarsFor(calendars, kind).some((c) => c.id === copy.target.calendarId);
  const first = firstCalendarFor(calendars, kind, hidden)?.id;
  return { ics: copy.ics, form: own || !first ? form : { ...form, calendarId: first } };
}

/**
 * "Make a copy" (design D164): the copy saved at once, in the item's own
 * calendar, as the store holds the item now; the copy's target, to open it.
 * An item gone meanwhile is a `GoneError`, a calendar that no longer takes
 * new items a `RefusedError`.
 */
export async function saveCopy(store: Store, target: Target, writes: Writes): Promise<Target> {
  const saved: { target?: Target } = {};
  await changeLocal(store, async (local) => {
    const { object } = await current(local, target);
    const calendar = (await local.calendars()).find((c) => c.id === target.calendarId);
    if (!calendar || calendarsFor([calendar], target.item.kind).length === 0) {
      throw new RefusedError("The calendar no longer takes new items.");
    }
    const copy = copyOf({ ...target, object }, writes);
    const row = await local.save(target.calendarId, copy.ics);
    saved.target = { ...copy.target, objectId: row.id };
  });
  return saved.target!;
}

/** "Copy to…"'s new item: the copy with what the user changed, its first revision. */
export function createFrom(base: string, changes: ItemChanges, now: number): string {
  return createFromCopy(base, changes, { now });
}
