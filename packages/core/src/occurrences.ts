import ICAL from "ical.js";

import type { CalendarObject } from "./calendar-object.ts";
import { plus, readItem, type Item } from "./item.ts";
import { fromIcalTime, keepTzid, wallClockOf, type ItemTime } from "./time.ts";

/** One occurrence of an item on the calendar (GLOSSARY.md: Occurrence). */
export interface Occurrence {
  /** The item that shows: the master, or the exception that replaced this occurrence. */
  readonly item: Item;
  /** The occurrence's identity within its series; `null` for an item that does not recur. */
  readonly recurrenceId: ItemTime | null;
  readonly start: ItemTime;
  /** Exclusive. Equal to `start` for an item with no length. */
  readonly end: ItemTime;
}

/** Days as the user sees them: `from` inclusive, `to` exclusive, in `timeZone`. */
export interface Range {
  readonly from: string;
  readonly to: string;
  /** The IANA zone the user's calendar is shown in. */
  readonly timeZone: string;
}

/**
 * How many occurrences a series may be walked through before the range.
 * Expansion starts at the series' first occurrence (docs/plans/foundation.md#deferred),
 * so a minutely or hourly series from years ago would take seconds (a daily
 * one may reach back to 1890). Such a series is refused instead of being cut
 * short in silence.
 */
const MAX_STEPS = 50_000;

/** A series too dense to expand up to the range (`MAX_STEPS`). */
export class ExpansionLimitError extends Error {
  override name = "ExpansionLimitError";
}

/**
 * Where an item sits in time. An event spans `DTSTART`–end; a task spans
 * `DTSTART`–`DUE`, or sits at whichever of the two it has
 * (docs/plans/foundation.md#D16). An item with neither has no place.
 */
function anchors(component: ICAL.Component): { start: ICAL.Time; end: ICAL.Time } | null {
  const value = (name: string) => {
    const v = component.getFirstPropertyValue(name);
    return v instanceof ICAL.Time ? v : null;
  };
  const start = value("dtstart");
  if (component.name === "vevent") {
    if (!start) return null;
    const end = value("dtend");
    if (end) return { start, end };
    const duration = component.getFirstPropertyValue("duration");
    if (duration instanceof ICAL.Duration) return { start, end: plus(start, duration) };
    return { start, end: start.isDate ? plus(start, ICAL.Duration.fromData({ days: 1 })) : start };
  }
  let due = value("due");
  const duration = component.getFirstPropertyValue("duration");
  if (!due && start && duration instanceof ICAL.Duration) due = plus(start, duration);
  if (start && due) return { start, end: due };
  const only = start ?? due;
  return only ? { start: only, end: only } : null;
}

/** The length from `start` to `end`, on the wall clock when both share a zone (so a 1-hour meeting stays 1 hour across DST). */
function lengthOf({ start, end }: { start: ICAL.Time; end: ICAL.Time }): ICAL.Duration {
  return start.zone === end.zone ? end.subtractDate(start) : end.subtractDateTz(start);
}

function bounds(range: Range) {
  return { from: `${range.from}T00:00:00`, to: `${range.to}T00:00:00` };
}

function overlaps(start: ItemTime, end: ItemTime, range: Range): boolean {
  const { from, to } = bounds(range);
  const s = wallClockOf(start, range.timeZone);
  const e = wallClockOf(end, range.timeZone);
  if (s >= to) return false;
  return e === s ? s >= from : e > from;
}

/**
 * The occurrences of a calendar object that touch the range, in start order.
 * Expands `RRULE`, `RDATE` and `EXDATE`, and puts each exception
 * (`RECURRENCE-ID`) in place of the occurrence it replaces, wherever it moved.
 */
export function occurrencesBetween(object: CalendarObject, range: Range): Occurrence[] {
  const { master, exceptions } = object.components;
  const result: Occurrence[] = [];

  // A RECURRENCE-ID names the occurrence it replaces by its instant. Some
  // clients write it as another kind of time than the series' start (a date
  // for a zoned series, a floating time for a zoned one); those match on the
  // wall clock, or on the day when one side is a date.
  const masterType = master ? anchors(master)?.start : undefined;
  const masterKind = masterType ? fromIcalTime(masterType).type : undefined;
  const replaced = new Set<string>();
  for (const component of exceptions) {
    const value = component.getFirstPropertyValue("recurrence-id");
    if (!(value instanceof ICAL.Time)) continue;
    const recurrenceId = fromIcalTime(value);
    replaced.add(key(recurrenceId));
    if (masterKind && recurrenceId.type !== masterKind)
      replaced.add(looseKey(recurrenceId, masterKind));
    // A cancelled exception removes its occurrence (docs/plans/foundation.md#D35).
    if (component.getFirstPropertyValue("status") === "CANCELLED") continue;
    const span = anchors(component);
    if (!span) continue;
    const occurrence = {
      item: readItem(component),
      recurrenceId,
      start: fromIcalTime(span.start),
      end: fromIcalTime(span.end),
    };
    if (overlaps(occurrence.start, occurrence.end, range)) result.push(occurrence);
  }

  const span = master ? anchors(master) : null;
  if (master && span) {
    const item = readItem(master);
    const length = lengthOf(span);
    if (!item.recurring) {
      const start = fromIcalTime(span.start);
      const end = fromIcalTime(span.end);
      if (overlaps(start, end, range)) result.push({ item, recurrenceId: null, start, end });
    } else {
      // Zones are up to 26 hours apart (UTC−12 to UTC+14), so a start can show
      // more than a day away from its own wall clock.
      const stop = `${shiftDate(range.to, 2)}T00:00:00`;
      const expansion = new ICAL.RecurExpansion({ component: master, dtstart: span.start });
      for (let step = 0; ; step++) {
        const next = expansion.next();
        if (!next) break;
        if (step >= MAX_STEPS) {
          throw new ExpansionLimitError(
            `The series ${object.uid} needs more than ${MAX_STEPS} steps to reach the range.`,
          );
        }
        keepTzid(span.start, next);
        const recurrenceId = fromIcalTime(next);
        if (localOf(recurrenceId) >= stop) break;
        if (isReplaced(replaced, recurrenceId)) continue;
        const start = recurrenceId;
        const end = fromIcalTime(plus(next, length));
        if (overlaps(start, end, range)) result.push({ item, recurrenceId, start, end });
      }
    }
  }

  return result.toSorted(
    (a, b) =>
      wallClockOf(a.start, range.timeZone).localeCompare(wallClockOf(b.start, range.timeZone)) ||
      (a.start.type === "date" ? -1 : 0) - (b.start.type === "date" ? -1 : 0),
  );
}

/** How a recurrence id is matched: the instant for zoned times, the wall clock otherwise. */
function key(time: ItemTime): string {
  switch (time.type) {
    case "date":
      return time.date;
    case "floating":
      return time.local;
    case "zoned":
      return String(time.epochMs);
  }
}

/**
 * How a RECURRENCE-ID of another kind than the series is matched: by day
 * when either side is a date, else by wall clock.
 */
function looseKey(recurrenceId: ItemTime, seriesKind: ItemTime["type"]): string {
  const local = localOf(recurrenceId);
  const byDay = recurrenceId.type === "date" || seriesKind === "date";
  return byDay ? `day:${local.slice(0, 10)}` : `wall:${local}`;
}

function isReplaced(replaced: ReadonlySet<string>, occurrence: ItemTime): boolean {
  const local = localOf(occurrence);
  return (
    replaced.has(key(occurrence)) ||
    replaced.has(`wall:${local}`) ||
    replaced.has(`day:${local.slice(0, 10)}`)
  );
}

function localOf(time: ItemTime): string {
  return time.type === "date" ? `${time.date}T00:00:00` : time.local;
}

function shiftDate(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
