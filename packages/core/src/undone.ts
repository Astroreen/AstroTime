// Which tasks are done, and which undone ones roll over to today
// (docs/plans/foundation.md#D16, design D51): an undone task whose due is
// before the start of today leaves its own day for one "N undone tasks"
// chip on today.
import type { CalendarObject } from "./calendar-object.ts";
import type { Item } from "./item.ts";
import { firstDay, occurrencesBetween, shiftDate, type Occurrence } from "./occurrences.ts";
import { wallClockOf } from "./time.ts";

/**
 * Whether an item is a task that needs nothing more: completed (`STATUS`
 * or a `COMPLETED` time) or cancelled. An event is never done.
 */
export function isDone(item: Item): boolean {
  if (item.kind !== "task") return false;
  const status = item.status?.toUpperCase();
  return status === "COMPLETED" || status === "CANCELLED" || item.completed !== null;
}

/**
 * Whether one occurrence of a task is undone with its due before `day`
 * starts in `timeZone` (D51). Its due is a due date or time, the end of a
 * start–due block, or the start of a task with a start and no due. An
 * occurrence is done when its own item is, or the series it belongs to.
 */
export function isUndoneBefore(
  object: CalendarObject,
  occurrence: Occurrence,
  day: string,
  timeZone: string,
): boolean {
  if (occurrence.item.kind !== "task" || isDone(occurrence.item)) return false;
  if (object.master && isDone(object.master)) return false;
  // `end` is the due, exclusive for a date: a task due yesterday ends today.
  const { end } = occurrence;
  return end.type === "date" ? end.date <= day : wallClockOf(end, timeZone) < `${day}T00:00:00`;
}

/**
 * The occurrence by which a task counts in today's "N undone tasks": its
 * latest undone one due before `day`, or `null`. A recurring task counts
 * once (D51).
 *
 * A series is read back from `day` a window at a time, each eight times as
 * wide as the last, instead of from its first occurrence (D118): an
 * occurrence outside a window ends by the window's start, so one in it due
 * after that start is the latest. The last window reaches three days before
 * the first occurrence (`firstDay`; no zone shows one earlier), so it holds
 * them all: five windows reach back 359 years, and a series is
 * walked whole at most once, as it was before D118.
 */
export function latestUndoneBefore(
  object: CalendarObject,
  day: string,
  timeZone: string,
): Occurrence | null {
  if (object.kind !== "task" || (object.master && isDone(object.master))) return null;
  const dueOf = (occurrence: Occurrence) => wallClockOf(occurrence.end, timeZone);
  const first = firstDay(object);
  // A task that does not recur has one occurrence, and one with no date none.
  // Three days early, never before year 1: an ISO string there is "0000-" or
  // "-00001-", which does not compare as a date.
  const all = first === null || first < "0001-01-04" ? "0001-01-01" : shiftDate(first, -3);
  for (let days = 32; ; days *= 8) {
    const window = object.master?.recurring ? shiftDate(day, -days) : all;
    const from = window > all ? window : all;
    const latest = occurrencesBetween(object, { from, to: day, timeZone })
      .filter((occurrence) => isUndoneBefore(object, occurrence, day, timeZone))
      .reduce<Occurrence | null>(
        (found, occurrence) => (!found || dueOf(occurrence) > dueOf(found) ? occurrence : found),
        null,
      );
    if (from === all || (latest && dueOf(latest) > `${from}T00:00:00`)) return latest;
  }
}
