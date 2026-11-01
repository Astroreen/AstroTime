// A VTIMEZONE for an IANA zone, made from what `Intl` knows of it, for a time
// AstroTime writes in a zone the object does not define yet (RFC 5545 §3.6.5:
// every TZID needs its VTIMEZONE). ical.js ships no zone data, and the
// platform's is the one the views already place items by (D32, D33).
import ICAL from "ical.js";

import { wallClockIn } from "./time.ts";

const DAY_MS = 86_400_000;
const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

interface Transition {
  /** The instant the offset changes. */
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/** The zone's offset from UTC at an instant, in milliseconds. */
function offsetAt(epochMs: number, timeZone: string): number {
  return Date.parse(`${wallClockIn(epochMs, timeZone)}Z`) - epochMs;
}

/** Every change of offset in a year, found day by day and then to the second. */
function transitions(timeZone: string, year: number): Transition[] {
  const result: Transition[] = [];
  const end = Date.UTC(year + 1, 0, 1);
  let before = Date.UTC(year, 0, 1);
  let offset = offsetAt(before, timeZone);
  while (before < end) {
    const after = Math.min(before + DAY_MS, end);
    const next = offsetAt(after, timeZone);
    if (next !== offset) {
      let low = before;
      let high = after;
      while (high - low > 1000) {
        const middle = low + Math.floor((high - low) / 2000) * 1000;
        if (offsetAt(middle, timeZone) === offset) low = middle;
        else high = middle;
      }
      result.push({ at: high, from: offset, to: next });
      offset = next;
    }
    before = after;
  }
  return result;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** `+02:00`, `-03:30`, as jCal writes an offset (whole minutes: every zone's since 1972). */
function utcOffset(ms: number): string {
  const sign = ms < 0 ? "-" : "+";
  const minutes = Math.round(Math.abs(ms) / 60_000);
  return `${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The wall clock a transition starts at, before it (RFC 5545 §3.6.5: in the old offset). */
function onset(transition: Transition): Date {
  return new Date(transition.at + transition.from);
}

/** "The last Sunday of March", as BYDAY: `-1SU`; else the nth: `2SU`. */
function ruleOf(date: Date): { month: number; byDay: string } {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const length = new Date(Date.UTC(date.getUTCFullYear(), month, 0)).getUTCDate();
  const nth = day + 7 > length ? -1 : Math.ceil(day / 7);
  return { month, byDay: `${nth}${WEEKDAYS[date.getUTCDay()]}` };
}

/** The day `ruleOf` names in another year. */
function dayOfRule(year: number, month: number, byDay: string): number {
  const nth = Number(byDay.slice(0, -2));
  const weekday = WEEKDAYS.indexOf(byDay.slice(-2) as (typeof WEEKDAYS)[number]);
  if (nth > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return 1 + ((weekday - first + 7) % 7) + (nth - 1) * 7;
  }
  const lastDate = new Date(Date.UTC(year, month, 0));
  return lastDate.getUTCDate() - ((lastDate.getUTCDay() - weekday + 7) % 7);
}

/** How many years after the first a yearly rule is checked for, and the onsets listed for a zone without one. */
const YEARS = 20;

/**
 * A VTIMEZONE for `timeZone`, its observances starting the year before
 * `year`. A zone whose changes follow "the nth (or last) weekday of a month"
 * gets a yearly RRULE per observance, checked against `Intl` for the years
 * after; any other gets an observance per change in those years. A zone
 * with no change has one STANDARD observance.
 */
export function vtimezone(timeZone: string, year: number): ICAL.Component {
  const first = year - 1;
  const component = new ICAL.Component("vtimezone");
  component.addPropertyWithValue("tzid", timeZone);
  const found = transitions(timeZone, first);
  if (found.length === 0) {
    const offset = utcOffset(offsetAt(Date.UTC(year, 0, 1), timeZone));
    component.addSubcomponent(observance("standard", "1970-01-01T00:00:00", offset, offset));
    return component;
  }
  const later = Array.from({ length: YEARS }, (_, i) => first + 1 + i).map(
    (y) => [y, transitions(timeZone, y)] as const,
  );
  const regular = found.every((transition, index) => {
    const date = onset(transition);
    const { month, byDay } = ruleOf(date);
    return later.every(([y, list]) => {
      const other = list[index];
      if (!other || list.length !== found.length || other.to !== transition.to) return false;
      const otherDate = onset(other);
      return (
        otherDate.getUTCMonth() + 1 === month &&
        otherDate.getUTCDate() === dayOfRule(y, month, byDay) &&
        iso(otherDate).slice(10) === iso(date).slice(10)
      );
    });
  });
  const all = regular ? found : [...found, ...later.flatMap(([, list]) => list)];
  for (const transition of all) {
    const date = onset(transition);
    const sub = observance(
      transition.to > transition.from ? "daylight" : "standard",
      iso(date),
      utcOffset(transition.from),
      utcOffset(transition.to),
    );
    if (regular) {
      const { month, byDay } = ruleOf(date);
      sub.addProperty(
        new ICAL.Property(["rrule", {}, "recur", { freq: "YEARLY", bymonth: month, byday: byDay }]),
      );
    }
    component.addSubcomponent(sub);
  }
  return component;
}

/** A wall clock held in a `Date`'s UTC fields, as jCal writes it: `2026-03-29T03:00:00`. */
const iso = (date: Date) => date.toISOString().slice(0, 19);

function observance(
  kind: "standard" | "daylight",
  start: string,
  from: string,
  to: string,
): ICAL.Component {
  const sub = new ICAL.Component(kind);
  sub.addProperty(new ICAL.Property(["tzoffsetfrom", {}, "utc-offset", from]));
  sub.addProperty(new ICAL.Property(["tzoffsetto", {}, "utc-offset", to]));
  sub.addProperty(new ICAL.Property(["dtstart", {}, "date-time", start]));
  return sub;
}
