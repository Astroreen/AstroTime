// Where items go on the calendar's views (docs/plans/foundation.md#D14–D16,
// D42): which belong to the all-day strip, where timed ones sit in a day's
// time grid, and how overlaps share the width. Pure geometry in minutes and
// fractions of a column; the UI turns it into pixels.
import type { Occurrence } from "./occurrences.ts";
import { wallClockOf, type ItemTime } from "./time.ts";

const DAY_MINUTES = 24 * 60;

export interface LayoutOptions {
  /** The IANA zone the calendar is shown in. */
  readonly timeZone: string;
  /** How tall a task with only a due time is drawn (D16). */
  readonly chipMinutes?: number;
  /** The shortest a block is drawn, so a 5-minute event can still be hit. */
  readonly minBlockMinutes?: number;
  /** How far each cascaded item is shifted right, as a fraction of the column (D15). */
  readonly cascadeStep?: number;
  /** Past this many items at once, a cluster switches to equal columns (D15). */
  readonly maxCascade?: number;
}

/** A timed item placed in one day's column. */
export interface Placed {
  readonly occurrence: Occurrence;
  /** `chip`: a task with only a due time; `block`: anything with a length. */
  readonly shape: "block" | "chip";
  /** Minutes from the day's midnight; clipped to the day. */
  readonly top: number;
  readonly bottom: number;
  /** Whether the item goes on before or after this day. */
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
  /** Left edge and width as fractions of the column. */
  readonly left: number;
  readonly width: number;
  /** Paint order: higher is drawn on top. */
  readonly layer: number;
}

export interface DayLayout {
  readonly allDay: readonly Occurrence[];
  readonly timed: readonly Placed[];
}

function minutesOf(local: string): number {
  return (
    Number(local.slice(11, 13)) * 60 +
    Number(local.slice(14, 16)) +
    Number(local.slice(17, 19)) / 60
  );
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Calendar days from `a` to `b` (both `YYYY-MM-DD`). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Where a task's chip sits, or `null` when the task is not a chip (D16,
 * D42): a timed due with no timed start to span from, or a timed start
 * with no due at all.
 */
function chipTime(occurrence: Occurrence): ItemTime | null {
  const { item } = occurrence;
  if (item.kind !== "task") return null;
  const { start, due } = item;
  if (due && due.type !== "date" && (start === null || start.type === "date")) return due;
  if (!due && start && start.type !== "date") return start;
  return null;
}

/**
 * Whether an occurrence belongs to the all-day strip: an all-day item (a
 * date, a task due on a date) or a timed one lasting a whole day or more,
 * as Google shows a 3-day conference (D42).
 */
export function isAllDay(occurrence: Occurrence, timeZone: string): boolean {
  const { item, start, end } = occurrence;
  // One rule for tasks first, so a date start with a timed due is a chip, not a bar.
  if (chipTime(occurrence)) return false;
  if (start.type === "date") return true;
  if (item.kind === "task" && item.due?.type === "date") return true;
  // A day or more of time, or a whole day of the user's wall clock (midnight
  // to midnight is a day even when DST makes it 23 hours).
  if (minutesBetween(start, end, timeZone) >= DAY_MINUTES) return true;
  const s = wallClockOf(start, timeZone);
  const e = wallClockOf(end, timeZone);
  const firstMidnight = s.endsWith("T00:00:00") ? s.slice(0, 10) : nextDay(s.slice(0, 10));
  return e >= `${nextDay(firstMidnight)}T00:00:00`;
}

/** The first and last day an all-day item covers in the user's zone (its exclusive end at midnight belongs to the day before). */
function daysOf(occurrence: Occurrence, timeZone: string): { first: string; last: string } {
  const first = wallClockOf(occurrence.start, timeZone).slice(0, 10);
  const end = wallClockOf(occurrence.end, timeZone);
  const last =
    end.endsWith("T00:00:00") && end.slice(0, 10) > first
      ? new Date(Date.parse(`${end.slice(0, 10)}T00:00:00Z`) - 86_400_000)
          .toISOString()
          .slice(0, 10)
      : end.slice(0, 10);
  return { first, last };
}

/**
 * How long an item lasts: elapsed time when both ends are instants (so a
 * day across a DST change is 23 or 25 hours), wall-clock time otherwise.
 */
function minutesBetween(start: ItemTime, end: ItemTime, timeZone: string): number {
  if (start.type === "zoned" && end.type === "zoned") return (end.epochMs - start.epochMs) / 60_000;
  const s = wallClockOf(start, timeZone);
  const e = wallClockOf(end, timeZone);
  return daysBetween(s.slice(0, 10), e.slice(0, 10)) * DAY_MINUTES + minutesOf(e) - minutesOf(s);
}

/**
 * One day's layout. `occurrences` are usually the day's, as
 * `occurrencesBetween` returns them for this one day; anything that does not
 * show on `day` (a chip due another day, an item outside it) is left out.
 */
export function layoutDay(
  occurrences: readonly Occurrence[],
  day: string,
  options: LayoutOptions,
): DayLayout {
  const {
    timeZone,
    chipMinutes = 30,
    minBlockMinutes = 15,
    cascadeStep = 0.15,
    maxCascade = 3,
  } = options;
  const allDay: Occurrence[] = [];
  const items: Omit<Placed, "left" | "width" | "layer">[] = [];

  for (const occurrence of occurrences) {
    if (isAllDay(occurrence, timeZone)) {
      const { first, last } = daysOf(occurrence, timeZone);
      if (first <= day && day <= last) allDay.push(occurrence);
      continue;
    }
    const at = chipTime(occurrence);
    const chip = at !== null;
    const s = wallClockOf(at ?? occurrence.start, timeZone);
    const e = wallClockOf(at ?? occurrence.end, timeZone);
    // Not on this day (a chip shows on its own day only): left out.
    const starts = s.slice(0, 10);
    const endsBeforeDay = chip
      ? starts < day
      : e < `${day}T00:00:00` || (e === `${day}T00:00:00` && e !== s);
    if (starts > day || endsBeforeDay) continue;
    const startsBefore = s.slice(0, 10) < day;
    const endsAfter =
      e.slice(0, 10) > day && !(e.slice(0, 10) === nextDay(day) && minutesOf(e) === 0);
    let top = startsBefore ? 0 : minutesOf(s);
    // Ending on a later day (or exactly at the next midnight), it runs to the end of this one.
    let bottom = e.slice(0, 10) > day ? DAY_MINUTES : minutesOf(e);
    if (chip) bottom = top + chipMinutes;
    bottom = Math.max(bottom, top + (chip ? chipMinutes : minBlockMinutes));
    // A chip or a short block at the end of the day is lifted to fit.
    if (bottom > DAY_MINUTES) {
      top = Math.max(0, top - (bottom - DAY_MINUTES));
      bottom = DAY_MINUTES;
    }
    items.push({
      occurrence,
      shape: chip ? "chip" : "block",
      top,
      bottom,
      continuesBefore: startsBefore,
      continuesAfter: endsAfter,
    });
  }

  return {
    allDay: sortAllDay(allDay, timeZone),
    timed: placeOverlaps(items, cascadeStep, maxCascade),
  };
}

/** Longer spans first, then events before tasks, then by title (Google's order). */
function sortAllDay(occurrences: Occurrence[], timeZone: string): Occurrence[] {
  return occurrences.toSorted(
    (a, b) =>
      minutesBetween(b.start, b.end, timeZone) - minutesBetween(a.start, a.end, timeZone) ||
      (a.item.kind === b.item.kind ? 0 : a.item.kind === "event" ? -1 : 1) ||
      (a.item.summary ?? "").localeCompare(b.item.summary ?? ""),
  );
}

/**
 * D15: items that overlap, directly or through others, form a cluster. In a
 * cluster an item that starts later (or, starting together, is shorter) is
 * drawn on top, shifted right by one step per item under it that it
 * overlaps. When more than `maxCascade` items overlap at one moment the
 * cascade would hide too much, and the cluster switches to equal columns.
 */
function placeOverlaps(
  items: Omit<Placed, "left" | "width" | "layer">[],
  step: number,
  maxCascade: number,
): Placed[] {
  const sorted = items.toSorted((a, b) => a.top - b.top || b.bottom - b.top - (a.bottom - a.top));
  const placed: Placed[] = [];
  let cluster: typeof sorted = [];
  let clusterEnd = -1;
  const flush = () => {
    if (cluster.length > 0) placed.push(...placeCluster(cluster, step, maxCascade));
    cluster = [];
  };
  for (const item of sorted) {
    if (item.top >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.bottom);
  }
  flush();
  return placed;
}

function overlap(a: { top: number; bottom: number }, b: { top: number; bottom: number }): boolean {
  return a.top < b.bottom && b.top < a.bottom;
}

function placeCluster(
  cluster: Omit<Placed, "left" | "width" | "layer">[],
  step: number,
  maxCascade: number,
): Placed[] {
  // The most items at one moment: checked at every start.
  const peak = Math.max(
    ...cluster.map((a) => cluster.filter((b) => b.top <= a.top && a.top < b.bottom).length),
  );
  if (peak > maxCascade) {
    // Equal columns: each item takes the first column free at its start.
    const columns: number[] = [];
    const column = cluster.map((item) => {
      let index = columns.findIndex((bottom) => bottom <= item.top);
      if (index < 0) index = columns.push(0) - 1;
      columns[index] = item.bottom;
      return index;
    });
    const width = 1 / columns.length;
    return cluster.map((item, i) => ({ ...item, left: column[i]! * width, width, layer: i }));
  }
  const depth: number[] = [];
  return cluster.map((item, i) => {
    let d = 0;
    for (let j = 0; j < i; j++) if (overlap(cluster[j]!, item)) d = Math.max(d, depth[j]! + 1);
    depth.push(d);
    // Rounded so a cascade of 0.15 steps reads 0.45, not 0.44999…
    const left = Math.round(Math.min(d * step, 1 - step) * 1e4) / 1e4;
    return { ...item, left, width: 1 - left, layer: i };
  });
}

/** An all-day span placed in a row of the week's (or a month week's) strip. */
export interface Span {
  readonly occurrence: Occurrence;
  /** The first and last day it covers, as indexes into `days`. */
  readonly firstDay: number;
  readonly lastDay: number;
  readonly row: number;
  readonly continuesBefore: boolean;
  readonly continuesAfter: boolean;
}

/**
 * The all-day strip across several days (a week, or one week of a month):
 * each span gets the first row free on all its days, longest spans first, so
 * a three-day conference reads as one bar (D14, D42).
 */
export function layoutSpans(
  occurrences: readonly Occurrence[],
  days: readonly string[],
  timeZone: string,
): Span[] {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return [];
  const rows: boolean[][] = [];
  const spans: Span[] = [];
  const strip = occurrences.filter((occurrence) => isAllDay(occurrence, timeZone));
  for (const occurrence of sortAllDay(strip, timeZone)) {
    const { first: startDay, last: endDay } = daysOf(occurrence, timeZone);
    const firstDay = Math.max(0, daysBetween(first, startDay));
    const lastDay = Math.min(days.length - 1, daysBetween(first, endDay));
    if (lastDay < 0 || firstDay > days.length - 1 || lastDay < firstDay) continue;
    let row = rows.findIndex((taken) => taken.slice(firstDay, lastDay + 1).every((t) => !t));
    if (row < 0) row = rows.push(Array.from({ length: days.length }, () => false)) - 1;
    for (let d = firstDay; d <= lastDay; d++) rows[row]![d] = true;
    spans.push({
      occurrence,
      firstDay,
      lastDay,
      row,
      continuesBefore: startDay < first,
      continuesAfter: endDay > last,
    });
  }
  return spans;
}
