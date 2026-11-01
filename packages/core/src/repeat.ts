// A series' repeat rule in the shapes AstroTime shows and edits (D9): every
// day, week (on some weekdays), month (on its day, or on its nth weekday) or
// year, every n of them, forever, n times or until a day. Another client's
// rule beyond these is read as close as it goes and marked inexact; it is
// written back untouched unless the user picks another (AGENTS.md rule 2).
import ICAL from "ical.js";

import type { CalendarObject } from "./calendar-object.ts";
import { fromIcalTime, wallClockOf, zonedToEpoch, type ItemTime } from "./time.ts";

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";
export const WEEKDAYS: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export type RepeatEnd =
  | { readonly type: "never" }
  | { readonly type: "count"; readonly count: number }
  /** The last day an occurrence may start on, in the series' own zone. */
  | { readonly type: "until"; readonly until: string };

export interface Repeat {
  readonly frequency: Frequency;
  /** Every `interval` days, weeks, months or years; at least 1. */
  readonly interval: number;
  /** A weekly rule's days; empty for the start's own weekday. */
  readonly weekdays: readonly Weekday[];
  /** A monthly rule on the nth weekday (1–5, or −1 for the last); `null`: on the start's day of the month. */
  readonly monthlyWeekday: { readonly nth: number; readonly weekday: Weekday } | null;
  readonly end: RepeatEnd;
}

/** A series' rule as a `Repeat`; `exact` is false when the RRULE says more than one can hold. */
export interface RepeatRule {
  readonly repeat: Repeat;
  readonly exact: boolean;
}

/** RRULE parts a `Repeat` holds; any other makes the rule inexact. */
const KNOWN = new Set([
  "freq",
  "interval",
  "count",
  "until",
  "byday",
  "bymonthday",
  "bymonth",
  "wkst",
]);

const list = (value: unknown): unknown[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

/** The master's repeat rule, or `null` for an item that does not repeat by an RRULE. */
export function repeatOf(object: CalendarObject): RepeatRule | null {
  const master = object.components.master;
  if (!master) return null;
  const rules = master.getAllProperties("rrule");
  const first = rules[0]?.getFirstValue();
  if (!(first instanceof ICAL.Recur)) return null;
  const start = master.getFirstPropertyValue("dtstart") ?? master.getFirstPropertyValue("due");
  const anchor = start instanceof ICAL.Time ? fromIcalTime(start) : null;
  return readRule(first, anchor, rules.length === 1 && !master.hasProperty("rdate"));
}

function readRule(rule: ICAL.Recur, anchor: ItemTime | null, single: boolean): RepeatRule {
  const frequency = (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const).find(
    (f) => f === rule.freq,
  );
  const data = rule.toJSON() as Record<string, unknown>;
  let exact = single && frequency !== undefined;
  for (const key of Object.keys(data)) if (!KNOWN.has(key)) exact = false;
  const byDay = list(rule.parts["BYDAY"]).map(String);
  const byMonthDay = list(rule.parts["BYMONTHDAY"]).map(Number);
  const byMonth = list(rule.parts["BYMONTH"]).map(Number);
  const startDay = anchor ? localOf(anchor).slice(0, 10) : null;
  const startDate = startDay ? new Date(`${startDay}T00:00:00Z`) : null;

  let weekdays: Weekday[] = [];
  let monthlyWeekday: Repeat["monthlyWeekday"] = null;
  if (frequency === "WEEKLY") {
    weekdays = byDay.filter((day): day is Weekday => WEEKDAYS.includes(day as Weekday));
    if (weekdays.length !== byDay.length || byMonthDay.length > 0 || byMonth.length > 0)
      exact = false;
  } else if (frequency === "MONTHLY") {
    const match = byDay.length === 1 ? /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(byDay[0]!) : null;
    if (match?.[1]) monthlyWeekday = { nth: Number(match[1]), weekday: match[2] as Weekday };
    const onItsDay =
      byDay.length === 0 &&
      (byMonthDay.length === 0 ||
        (byMonthDay.length === 1 && startDate?.getUTCDate() === byMonthDay[0]));
    if (!(monthlyWeekday || onItsDay) || byMonth.length > 0) exact = false;
  } else if (frequency === "YEARLY") {
    const onItsDay =
      byDay.length === 0 &&
      (byMonthDay.length === 0 || startDate?.getUTCDate() === byMonthDay[0]) &&
      byMonthDay.length <= 1 &&
      (byMonth.length === 0 ||
        (byMonth.length === 1 && startDate?.getUTCMonth() === byMonth[0]! - 1));
    if (!onItsDay) exact = false;
  } else if (byDay.length > 0 || byMonthDay.length > 0 || byMonth.length > 0) exact = false;

  let end: RepeatEnd = { type: "never" };
  if (rule.count) end = { type: "count", count: rule.count };
  else if (rule.until) {
    const until = fromIcalTime(rule.until);
    // A UTC end names the series' last moment: its day is the one in the series' zone.
    const zone = anchor?.type === "zoned" ? anchor.timeZone : "UTC";
    end = { type: "until", until: wallClockOf(until, zone).slice(0, 10) };
  }
  return {
    repeat: {
      frequency: frequency ?? "DAILY",
      interval: Math.max(1, rule.interval || 1),
      weekdays,
      monthlyWeekday,
      end,
    },
    exact,
  };
}

function localOf(time: ItemTime): string {
  return time.type === "date" ? `${time.date}T00:00:00` : time.local;
}

/**
 * The RRULE of a `Repeat` for a series starting at `start`: `FREQ` first,
 * then `INTERVAL` when it is not 1, the days, and the end. An end day is
 * written in the type RFC 5545 §3.3.10 asks of `UNTIL`: a date for a series
 * of dates, the end of that day in UTC for a zoned series, a wall clock for
 * a floating one.
 */
export function ruleOf(repeat: Repeat, start: ItemTime): ICAL.Recur {
  const data: Record<string, unknown> = { freq: repeat.frequency };
  if (repeat.interval > 1) data["interval"] = repeat.interval;
  if (repeat.frequency === "WEEKLY") {
    const days = repeat.weekdays.length > 0 ? repeat.weekdays : [weekdayOf(start)];
    data["byday"] = WEEKDAYS.filter((day) => days.includes(day));
  }
  if (repeat.frequency === "MONTHLY" && repeat.monthlyWeekday) {
    data["byday"] = [`${repeat.monthlyWeekday.nth}${repeat.monthlyWeekday.weekday}`];
  }
  const rule = ICAL.Recur.fromData(data);
  if (repeat.end.type === "count") rule.count = Math.max(1, repeat.end.count);
  if (repeat.end.type === "until") rule.until = untilOf(repeat.end.until, start);
  return rule;
}

/** The last moment of `day` as an RRULE's `UNTIL` for a series starting at `start`. */
function untilOf(day: string, start: ItemTime): ICAL.Time {
  const [year, month, date] = day.split("-").map(Number);
  if (start.type === "date") return ICAL.Time.fromData({ year, month, day: date, isDate: true });
  const last = ICAL.Time.fromData({ year, month, day: date, hour: 23, minute: 59, second: 59 });
  if (start.type === "floating") return last;
  return ICAL.Time.fromJSDate(new Date(zonedLast(day, start.timeZone)), true);
}

/** The instant 23:59:59 on `day` names in `timeZone`. */
function zonedLast(day: string, timeZone: string): number {
  // The next day's midnight there, less a second: right across a DST change too.
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return zonedToEpoch(`${next}T00:00:00`, timeZone) - 1000;
}

/** The ISO weekday of a time's own day. */
export function weekdayOf(time: ItemTime): Weekday {
  const day = new Date(`${localOf(time).slice(0, 10)}T00:00:00Z`).getUTCDay();
  return WEEKDAYS[(day + 6) % 7]!;
}
