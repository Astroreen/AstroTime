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
  /** How tall a task is drawn at its time (D16, design D159). */
  readonly chipMinutes?: number;
  /** The shortest a block is drawn, so a 5-minute event can still be hit. */
  readonly minBlockMinutes?: number;
  /** How far an item drawn over others is shifted in per item under it, as a fraction of its column (D15, design D153). */
  readonly cascadeStep?: number;
  /** How many items may be stacked over one another at once; one more takes a column of its own (design D153). */
  readonly maxCascade?: number;
  /**
   * The minutes at an item's top its title needs (two lines): an item drawn
   * over another starts at least this late after it, or takes a column
   * beside it (D15, design D153).
   */
  readonly titleMinutes?: number;
}

/** A timed item placed in one day's column. */
export interface Placed {
  readonly occurrence: Occurrence;
  /** `chip`: a task at its time; `block`: anything with a length. */
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
  /**
   * Minutes from its top that no item drawn over it covers: its whole
   * length, or at least `titleMinutes` where another starts over it. Its
   * text keeps to them (design D153).
   */
  readonly room: number;
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
 * Where a task shows (D16, D42, design D159): at its start, or at its due
 * when it has no start, whatever its due; `null` for an event. The
 * occurrence's own time, not the item's: a series' occurrences share the
 * master's item. A task with neither has no occurrence.
 */
function taskAt(occurrence: Occurrence): ItemTime | null {
  return occurrence.item.kind === "task" ? occurrence.start : null;
}

/**
 * Whether an occurrence belongs to the all-day strip: an all-day item (a
 * date, a task on a day) or a timed event lasting a whole day or more, as
 * Google shows a 3-day conference (D42). A task with a time is a chip at
 * that time, however far its due.
 */
export function isAllDay(occurrence: Occurrence, timeZone: string): boolean {
  const { start, end } = occurrence;
  const at = taskAt(occurrence);
  if (at) return at.type === "date";
  if (start.type === "date") return true;
  // A day or more of time, or a whole day of the user's wall clock (midnight
  // to midnight is a day even when DST makes it 23 hours).
  if (minutesBetween(start, end, timeZone) >= DAY_MINUTES) return true;
  const s = wallClockOf(start, timeZone);
  const e = wallClockOf(end, timeZone);
  const firstMidnight = s.endsWith("T00:00:00") ? s.slice(0, 10) : nextDay(s.slice(0, 10));
  return e >= `${nextDay(firstMidnight)}T00:00:00`;
}

/**
 * The first and last day an occurrence shows on in the user's zone: a task
 * on the day of its start (its due without one) only, anything else from
 * the day it starts to the day it ends (an end at midnight belongs to the
 * day before).
 */
export function dayRange(
  occurrence: Occurrence,
  timeZone: string,
): { first: string; last: string } {
  const at = taskAt(occurrence);
  if (at) {
    const day = at.type === "date" ? at.date : wallClockOf(at, timeZone).slice(0, 10);
    return { first: day, last: day };
  }
  return daysOf(occurrence, timeZone);
}

/** The first and last day an item covers in the user's zone (its exclusive end at midnight belongs to the day before). */
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

/** How long an occurrence is drawn: a task as a chip (design D159), anything else its length. */
function shownMinutes(occurrence: Occurrence, timeZone: string): number {
  if (occurrence.item.kind === "task") return occurrence.start.type === "date" ? DAY_MINUTES : 30;
  return minutesBetween(occurrence.start, occurrence.end, timeZone);
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
 * show on `day` (a task that starts another day, an item outside it) is left out.
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
    titleMinutes = 45,
  } = options;
  const allDay: Occurrence[] = [];
  const items: Item[] = [];

  for (const occurrence of occurrences) {
    if (isAllDay(occurrence, timeZone)) {
      const { first, last } = dayRange(occurrence, timeZone);
      if (first <= day && day <= last) allDay.push(occurrence);
      continue;
    }
    const at = taskAt(occurrence);
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
    timed: placeOverlaps(items, { step: cascadeStep, maxCascade, title: titleMinutes }),
  };
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Sorts by a key worked out once per occurrence, not on every comparison:
 * a zoned time's wall clock asks `Intl`, which a month of items would ask
 * tens of thousands of times.
 */
function sortByKey<K>(
  occurrences: readonly Occurrence[],
  keyOf: (occurrence: Occurrence) => K,
  order: (a: K, b: K) => number,
): Occurrence[] {
  return occurrences
    .map((occurrence) => ({ occurrence, key: keyOf(occurrence) }))
    .toSorted((a, b) => order(a.key, b.key))
    .map(({ occurrence }) => occurrence);
}

/** Longer spans first, then events before tasks, then by title (Google's order). */
function sortAllDay(occurrences: Occurrence[], timeZone: string): Occurrence[] {
  return sortByKey(
    occurrences,
    (o) => ({
      length: shownMinutes(o, timeZone),
      event: o.item.kind === "event",
      title: o.item.summary ?? "",
    }),
    (a, b) =>
      b.length - a.length ||
      (a.event === b.event ? 0 : a.event ? -1 : 1) ||
      // Code-unit order, the same on every platform (localeCompare is not).
      compare(a.title, b.title),
  );
}

/** A timed item before its place across the column. */
type Item = Omit<Placed, "left" | "width" | "layer" | "room">;

interface Rules {
  readonly step: number;
  readonly maxCascade: number;
  readonly title: number;
}

/**
 * D15 as design D153 has it: items that overlap, directly or through
 * others, form a cluster, laid out so no item's title is covered.
 */
function placeOverlaps(items: Item[], rules: Rules): Placed[] {
  const sorted = items.toSorted((a, b) => a.top - b.top || b.bottom - b.top - (a.bottom - a.top));
  const placed: Placed[] = [];
  let cluster: typeof sorted = [];
  let clusterEnd = -1;
  const flush = () => {
    if (cluster.length > 0) placed.push(...placeCluster(cluster, rules));
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

/** Rounded so a cascade of 0.15 steps reads 0.45, not 0.44999… */
const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/**
 * One cluster, in time order (the longer first when they start together),
 * each item on top of those before it. An item takes, in this order:
 * 1. the first column where nothing overlaps it;
 * 2. else the first column where it starts at least `title` minutes after
 *    every item it overlaps there, and fewer than `maxCascade` are stacked:
 *    it is drawn over them, one `step` of the column further in per item
 *    under it, so their titles show above it;
 * 3. else a column of its own, beside the others.
 * The columns share the width; an item then widens over the columns to its
 * right while nothing in them overlaps it.
 */
function placeCluster(cluster: Item[], { step, maxCascade, title }: Rules): Placed[] {
  const columns: { item: Item; depth: number }[][] = [];
  const at = cluster.map((item) => {
    const free = columns.findIndex((column) => column.every((p) => !overlap(p.item, item)));
    if (free >= 0) {
      columns[free]!.push({ item, depth: 0 });
      return { column: free, depth: 0 };
    }
    for (const [index, column] of columns.entries()) {
      const under = column.filter((p) => overlap(p.item, item));
      const depth = Math.max(...under.map((p) => p.depth)) + 1;
      if (depth < maxCascade && under.every((p) => item.top >= p.item.top + title)) {
        column.push({ item, depth });
        return { column: index, depth };
      }
    }
    columns.push([{ item, depth: 0 }]);
    return { column: columns.length - 1, depth: 0 };
  });
  const count = columns.length;
  const boxes = cluster.map((item, i) => {
    const { column, depth } = at[i]!;
    let span = 1;
    while (column + span < count && columns[column + span]!.every((p) => !overlap(p.item, item))) {
      span++;
    }
    return {
      left: round4((column + depth * step) / count),
      right: round4((column + span) / count),
    };
  });
  return cluster.map((item, i) => {
    const box = boxes[i]!;
    // Its top until the first item drawn over it.
    let room = item.bottom - item.top;
    for (let j = i + 1; j < cluster.length; j++) {
      const other = boxes[j]!;
      if (overlap(cluster[j]!, item) && other.left < box.right && box.left < other.right) {
        room = Math.min(room, cluster[j]!.top - item.top);
      }
    }
    return { ...item, left: box.left, width: round4(box.right - box.left), layer: i, room };
  });
}

/** Timed items in time order, the longer first when they start together, then by title. */
function sortTimed(occurrences: Occurrence[], timeZone: string): Occurrence[] {
  return sortByKey(
    occurrences,
    (o) => ({
      start: wallClockOf(o.start, timeZone),
      length: shownMinutes(o, timeZone),
      title: o.item.summary ?? "",
    }),
    (a, b) => compare(a.start, b.start) || b.length - a.length || compare(a.title, b.title),
  );
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
 * a three-day conference reads as one bar (D14, D42). With `timed`, as a
 * month's week has no time grid, timed items join after the all-day ones in
 * time order, each over the days it shows on (design D86). Those in `first`
 * (the item being made, design D187) take their rows before any other, so
 * no fold hides them.
 */
export function layoutSpans(
  occurrences: readonly Occurrence[],
  days: readonly string[],
  timeZone: string,
  options: { readonly timed?: boolean; readonly first?: ReadonlySet<Occurrence> } = {},
): Span[] {
  const first = days[0];
  const last = days.at(-1);
  if (!first || !last) return [];
  const rows: boolean[][] = [];
  const spans: Span[] = [];
  const strip: Occurrence[] = [];
  const timed: Occurrence[] = [];
  for (const occurrence of occurrences) {
    if (isAllDay(occurrence, timeZone)) strip.push(occurrence);
    else if (options.timed) timed.push(occurrence);
  }
  const sorted = [...sortAllDay(strip, timeZone), ...sortTimed(timed, timeZone)];
  const leading = options.first;
  const ordered = leading?.size
    ? [...sorted.filter((o) => leading.has(o)), ...sorted.filter((o) => !leading.has(o))]
    : sorted;
  for (const occurrence of ordered) {
    const { first: startDay, last: endDay } = dayRange(occurrence, timeZone);
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
