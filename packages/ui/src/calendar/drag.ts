// Dragging and resizing on the views (docs/plans/foundation.md#D14, D16,
// D113, design D111, D112): what a drop or a key writes, worked out on the user's
// wall clock as the time grid draws it (design D59), and the geometry under
// the pointer. Pure: the components hand it points and rectangles, and the
// write goes through the edit dialog's save (`saveChanges`, foundation D103).
import {
  wallClockIn,
  wallClockOf,
  zonedTime,
  zonedToEpoch,
  type Item,
  type ItemTime,
  type ItemTimes,
  type Occurrence,
} from "@astrotime/core";

import { addDays, daysBetween } from "./dates.ts";

/** Minutes a drag moves and resizes in, as Google's grid snaps (design D111). */
const SNAP = 15;
/** How long a finger holds still before it drags, as Google's Android app waits. */
export const LONG_PRESS = 500;
/** Pixels a mouse moves before a press is a drag; a finger that moves this far first scrolls. */
const SLOP = { mouse: 4, touch: 8 } as const;
/** How near the time grid's top or bottom a drag scrolls it, and how fast at most (pixels a frame). */
const EDGE = 48;
const EDGE_SPEED = 16;
/** The length an all-day item takes when dropped on the time grid. */
const DROPPED_LENGTH = 60;
const DAY = 1440;

/**
 * Where the pointer is: a day, and on the time grid the slot it is over in
 * minutes past midnight (a multiple of `SNAP`); `null` over the all-day
 * strip or a Month tile.
 */
export interface Spot {
  readonly day: string;
  readonly minutes: number | null;
}

/** What is held: the whole item, or one end of a block. */
export type Grip = "move" | "start" | "end";

/** Where an item is dragged: the time grid, the all-day strip above it, or a Month tile. */
export type Area = "grid" | "strip" | "month";

/** What a press has become: still waiting, a drag, or (a finger that moved first) a scroll. */
export type PressPhase = "wait" | "drag" | "scroll";

/**
 * A mouse or a pen drags once it moves a few pixels, so a click still opens
 * the item; a finger drags after a long press, and one that moves before
 * that scrolls the view instead (Google's Android app).
 */
export function pressPhase(pointer: string, distance: number, held: number): PressPhase {
  if (pointer !== "touch") return distance >= SLOP.mouse ? "drag" : "wait";
  if (distance >= SLOP.touch) return "scroll";
  return held >= LONG_PRESS ? "drag" : "wait";
}

/** The slot a point `y` pixels below a column's midnight is in; the day's first or last beyond it. */
export function slotAt(y: number, hour: number): number {
  const minutes = Math.floor(((y / hour) * 60) / SNAP) * SNAP;
  return Math.min(Math.max(minutes, 0), DAY - SNAP);
}

/** The column under `x`, by the columns' edges; the first or last beside them. */
export function columnAt(
  x: number,
  columns: readonly { readonly left: number; readonly right: number }[],
): number {
  const index = columns.findIndex((column) => x < column.right);
  return index < 0 ? columns.length - 1 : index;
}

/**
 * How far the time grid scrolls in a frame while a drag at `y` is near its
 * top (negative) or bottom edge, faster nearer the edge, fastest below it:
 * only once the drag has moved that way from `startY`, so an item picked up
 * near an edge does not run off at once. 0 elsewhere, and above the top,
 * over the all-day strip, where it drops instead.
 */
export function edgeScroll(y: number, startY: number, top: number, bottom: number): number {
  const speed = (depth: number) => Math.ceil(Math.min(depth / EDGE, 1) * EDGE_SPEED);
  if (y < top) return 0;
  if (y < top + EDGE && y < startY) return -speed(top + EDGE - y);
  if (y > bottom - EDGE && y > startY) return speed(y - (bottom - EDGE));
  return 0;
}

/** What a drag holds: the item's kind and its occurrence's times as the item writes them (`timesOf`). */
export interface Held {
  readonly kind: "event" | "task";
  /** An event's start and exclusive end; a task's start and due. */
  readonly times: ItemTimes;
}

/**
 * The time a task's chip shows on the time grid (foundation D16, D42): its
 * due, when timed and the task has no timed start, or its start when timed
 * and the task has no due; `null` for anything else.
 */
function chipOf(held: Held): "start" | "end" | null {
  if (held.kind !== "task") return null;
  const { start, end: due } = held.times;
  if (due && due.type !== "date" && (start === null || start.type === "date")) return "end";
  if (!due && start && start.type !== "date") return "start";
  return null;
}

/** Whether an item is all day: its first time is a date (an all-day event, a task due on a day). */
function dated({ times }: Held): boolean {
  return (times.start ?? times.end)?.type === "date";
}

const plus = (local: string, minutes: number) =>
  new Date(Date.parse(`${local}Z`) + minutes * 60_000).toISOString().slice(0, 19);

const minutesFrom = (from: string, to: string) =>
  Math.round((Date.parse(`${to}Z`) - Date.parse(`${from}Z`)) / 60_000);

/** A zoned time at an instant, in its own zone with its own TZID (foundation D104). */
function at(epochMs: number, timeZone: string): ItemTime {
  return { type: "zoned", local: wallClockIn(epochMs, timeZone), timeZone, epochMs };
}

/**
 * A time put at the wall clock `wall` the user sees in `timeZone`, kept of
 * its kind: a floating time shows its own wall clock everywhere, a zoned
 * one keeps its zone (a wall clock a DST gap skips moves forward, as RFC
 * 5545 reads it), a date takes the day.
 */
function placed(time: ItemTime, wall: string, timeZone: string): ItemTime {
  switch (time.type) {
    case "date":
      return { type: "date", date: wall.slice(0, 10) };
    case "floating":
      return { type: "floating", local: wall };
    case "zoned":
      return at(zonedToEpoch(wall, timeZone), time.timeZone);
  }
}

/** A time moved by `minutes` of the user's wall clock (a date by the days that makes). */
function shifted(time: ItemTime, minutes: number, timeZone: string): ItemTime {
  if (minutes === 0) return time;
  if (time.type === "date")
    return { type: "date", date: addDays(time.date, Math.floor(minutes / DAY)) };
  return placed(time, plus(wallClockOf(time, timeZone), minutes), timeZone);
}

/** The day a time shows on, as the time grid draws its end: an end at midnight belongs to the day before. */
function endDay(wall: string): string {
  return wall.endsWith("T00:00:00") ? addDays(wall.slice(0, 10), -1) : wall.slice(0, 10);
}

/**
 * The item moved by `minutes` of the wall clock (foundation D113): both ends
 * of a block, so it keeps the length the grid draws, even onto a day the
 * clocks change; a chip's time, and a task's start on a date with it by the
 * days the chip moved. With `grip` an end, that end only, kept at least
 * `SNAP` from the other and within its own day, as the grid draws it.
 * Returns `null` when nothing changes.
 */
export function moved(held: Held, grip: Grip, minutes: number, timeZone: string): ItemTimes | null {
  const { start, end } = held.times;
  let next: ItemTimes;
  const chip = chipOf(held);
  if (grip !== "move") {
    if (chip || !start || !end || start.type === "date" || end.type === "date") return null;
    const s = wallClockOf(start, timeZone);
    const e = wallClockOf(end, timeZone);
    if (grip === "end") {
      const latest = `${addDays(endDay(e), 1)}T00:00:00`;
      const wall = clampWall(plus(e, minutes), plus(s, SNAP), latest);
      next = { start, end: placed(end, wall, timeZone) };
    } else {
      const earliest = `${s.slice(0, 10)}T00:00:00`;
      const wall = clampWall(plus(s, minutes), earliest, plus(e, -SNAP));
      next = { start: placed(start, wall, timeZone), end };
    }
  } else if (chip === "end") {
    const due = shifted(end!, minutes, timeZone);
    const days = daysBetween(
      wallClockOf(end!, timeZone).slice(0, 10),
      wallClockOf(due, timeZone).slice(0, 10),
    );
    next = { start: start && shifted(start, days * DAY, timeZone), end: due };
  } else if (chip === "start") {
    next = { start: shifted(start!, minutes, timeZone), end };
  } else {
    const s = start && shifted(start, minutes, timeZone);
    let e = end && shifted(end, minutes, timeZone);
    // A start moved into a DST gap goes forward: the end keeps its length past it.
    if (
      s?.type === "zoned" &&
      e?.type === "zoned" &&
      start?.type === "zoned" &&
      end?.type === "zoned" &&
      end.epochMs > start.epochMs &&
      e.epochMs <= s.epochMs
    ) {
      e = at(s.epochMs + end.epochMs - start.epochMs, e.timeZone);
    }
    next = { start: s, end: e };
  }
  return sameTimes(next, held.times) ? null : next;
}

function clampWall(wall: string, earliest: string, latest: string): string {
  return wall < earliest ? earliest : wall > latest ? latest : wall;
}

/** Whether two items' times are the same, written the same way. */
function sameTimes(a: ItemTimes, b: ItemTimes): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The times an item takes when dropped on `to`, picked up on `from`
 * (foundation D113), or `null` when nothing changes, so nothing is written:
 * - on the time grid, moved by the slots and days between them, or an
 *   end resized by the slots;
 * - in the all-day strip or the Month, moved by the days, keeping its time;
 * - from the grid into the strip, all day on that day (a task due that day);
 * - from the strip onto the grid, at that slot, an hour long (a task with
 *   only a due, due there); an item longer than a day keeps its length.
 */
export function dropped(
  held: Held,
  grip: Grip,
  from: Spot,
  to: Spot,
  timeZone: string,
): ItemTimes | null {
  if (grip !== "move") {
    if (from.minutes === null || to.minutes === null) return null;
    return moved(held, grip, to.minutes - from.minutes, timeZone);
  }
  const days = daysBetween(from.day, to.day) * DAY;
  if (from.minutes !== null && to.minutes !== null) {
    return moved(held, grip, days + to.minutes - from.minutes, timeZone);
  }
  if (from.minutes === null && to.minutes === null) return moved(held, grip, days, timeZone);
  if (to.minutes === null) return allDayOn(held, to.day, timeZone);
  return timedAt(held, `${to.day}T00:00:00`, to.minutes, timeZone);
}

/** An item made all day on `day` (foundation D105: made all-day, its times move by whole days). */
function allDayOn(held: Held, day: string, timeZone: string): ItemTimes | null {
  const date = (d: string): ItemTime => ({ type: "date", date: d });
  const { start, end } = held.times;
  const next =
    held.kind === "event"
      ? { start: date(day), end: date(addDays(day, daysCovered(start, end, timeZone))) }
      : { start: start && date(day), end: end && date(day) };
  return sameTimes(next, held.times) ? null : next;
}

/**
 * The days of the user's wall clock a timed event covers, at least one: an
 * event over several days stays as long when it is made all day.
 */
function daysCovered(start: ItemTime | null, end: ItemTime | null, timeZone: string): number {
  if (!start || !end || start.type === "date" || end.type === "date") return 1;
  const first = wallClockOf(start, timeZone).slice(0, 10);
  const until = wallClockOf(end, timeZone);
  // An end at midnight closes the day before it.
  const last = until.endsWith("T00:00:00") ? addDays(until.slice(0, 10), -1) : until.slice(0, 10);
  return Math.max(1, daysBetween(first, last) + 1);
}

/** An item from the strip put on the time grid at `minutes` past `midnight` of the user's day. */
function timedAt(
  held: Held,
  midnight: string,
  minutes: number,
  timeZone: string,
): ItemTimes | null {
  const wall = plus(midnight, minutes);
  const { start, end } = held.times;
  if (!dated(held)) {
    // A timed item over a day or more: its start goes to the slot, its length stays.
    const first = start ?? end!;
    return moved(held, "move", minutesFrom(wallClockOf(first, timeZone), wall), timeZone);
  }
  // A date made a time takes the user's zone (foundation D104).
  const time = (w: string) => zonedTime(w, timeZone);
  const later = plus(wall, DROPPED_LENGTH);
  if (held.kind === "event") return { start: time(wall), end: time(later) };
  return start && end
    ? { start: time(wall), end: time(later) }
    : { start: start && time(wall), end: end && time(wall) };
}

/**
 * A key's move of a focused item (design D112): Alt with an arrow moves it
 * by `SNAP` minutes up or down on the time grid, by a day left or right, by
 * a week up or down in the Month; with Shift too, up and down move a
 * block's end. `null` for any other key.
 */
export function keyMove(
  area: Area,
  key: string,
  shift: boolean,
): { readonly grip: Grip; readonly minutes: number } | null {
  const sideways = { ArrowLeft: -DAY, ArrowRight: DAY }[key];
  const upright = { ArrowUp: -1, ArrowDown: 1 }[key];
  if (shift) return area === "grid" && upright ? { grip: "end", minutes: upright * SNAP } : null;
  if (sideways) return { grip: "move", minutes: sideways };
  if (!upright) return null;
  if (area === "grid") return { grip: "move", minutes: upright * SNAP };
  return area === "month" ? { grip: "move", minutes: upright * 7 * DAY } : null;
}

/**
 * The occurrence as it shows with new times: the ghost a drag draws, which
 * the layout engine places as it will place the item once saved. A task's
 * span is its start to its due (the day after a due date), as
 * `occurrencesBetween` reads it.
 */
export function ghostOf(occurrence: Occurrence, times: ItemTimes): Occurrence {
  const { item } = occurrence;
  const { start, end } = times;
  if (item.kind === "event") {
    const shown: Item = { ...item, start, end };
    return { ...occurrence, item: shown, start: start!, end: end ?? start! };
  }
  const shown: Item = { ...item, start, due: end };
  const after = (time: ItemTime): ItemTime =>
    time.type === "date" ? { type: "date", date: addDays(time.date, 1) } : time;
  if (end) return { ...occurrence, item: shown, start: start ?? end, end: after(end) };
  return { ...occurrence, item: shown, start: start!, end: after(start!) };
}

/** The slots a press and a drag on an empty column span, as a new event's start and length. */
export function sized(from: number, to: number): { readonly at: number; readonly length: number } {
  const first = Math.min(from, to);
  return { at: first, length: Math.max(from, to) + SNAP - first };
}
