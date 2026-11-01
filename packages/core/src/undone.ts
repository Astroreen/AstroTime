// Which tasks are done, and which undone ones roll over to today
// (docs/plans/foundation.md#D16, design D51): an undone task whose due is
// before the start of today leaves its own day for one "N undone tasks"
// chip on today.
import type { CalendarObject } from "./calendar-object.ts";
import type { Item } from "./item.ts";
import { occurrencesBetween, type Occurrence } from "./occurrences.ts";
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
 */
export function latestUndoneBefore(
  object: CalendarObject,
  day: string,
  timeZone: string,
): Occurrence | null {
  if (object.kind !== "task" || (object.master && isDone(object.master))) return null;
  const undone = occurrencesBetween(object, { from: "0001-01-01", to: day, timeZone }).filter(
    (occurrence) => isUndoneBefore(object, occurrence, day, timeZone),
  );
  const dueOf = (occurrence: Occurrence) => wallClockOf(occurrence.end, timeZone);
  return undone.reduce<Occurrence | null>(
    (latest, occurrence) => (!latest || dueOf(occurrence) > dueOf(latest) ? occurrence : latest),
    null,
  );
}
