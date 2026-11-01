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

/** Which of its month's weekdays like it a day (`YYYY-MM-DD`) is: 1–4, or −1 for one in the last week. */
export function nthWeekdayOf(day: string): number {
  const date = Number(day.slice(8, 10));
  const length = new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0),
  ).getUTCDate();
  return date + 7 > length ? -1 : Math.ceil(date / 7);
}

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
const unique = <T>(values: readonly T[]) => [...new Set(values)];

/**
 * A rule moved with its series' start, from `from` to `to` on the series'
 * wall clock (docs/plans/foundation.md#D105), so the new start is one of its
 * occurrences and the others move with it. Weekdays shift by as many days
 * (Monday and Wednesday a day later are Tuesday and Thursday); the start's
 * nth weekday of its month becomes the new start's, as the repeat picker
 * names it (2TU moved to the third Wednesday is 3WE); the start's day of the
 * month and its month become the new start's; hours and minutes shift as the
 * start's did. Every other part stays as written.
 */
export function movedRule(rule: ICAL.Recur, from: ItemTime, to: ItemTime): ICAL.Recur {
  const moved = rule.clone();
  const parts = moved.parts as Record<string, (string | number)[] | undefined>;
  const fromDay = localOf(from).slice(0, 10);
  const toDay = localOf(to).slice(0, 10);
  const days = daysBetween(fromDay, toDay);
  const inMonth = rule.freq === "MONTHLY" || (rule.freq === "YEARLY" && parts["BYMONTH"]);
  if (days !== 0) {
    const shift = (weekday: Weekday) =>
      WEEKDAYS[(((WEEKDAYS.indexOf(weekday) + days) % 7) + 7) % 7]!;
    // The start's own nth weekday: the 4th in the month's last week is also its last.
    const own = new Set([
      `${nthWeekdayOf(fromDay)}${weekdayOf(from)}`,
      `${Math.ceil(Number(fromDay.slice(8)) / 7)}${weekdayOf(from)}`,
    ]);
    const byDay = parts["BYDAY"]?.map((value) => {
      const match = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/.exec(String(value));
      if (!match) return value;
      const weekday = match[2] as Weekday;
      if (!match[1]) return shift(weekday);
      const ordinal = Number(match[1]);
      if (inMonth && own.has(`${ordinal}${weekday}`))
        return `${nthWeekdayOf(toDay)}${weekdayOf(to)}`;
      return `${ordinal}${shift(weekday)}`;
    });
    if (byDay) parts["BYDAY"] = unique(byDay);
    // Every other week (or more) on several days: the days shifted into
    // different weeks than each other would fall in weeks the rule skips,
    // unless the week starts as many days later too (RFC 5545 WKST).
    if (rule.freq === "WEEKLY" && rule.interval > 1 && parts["BYDAY"]) {
      // ical.js numbers the weekdays from Sunday, 1 to 7.
      const start = rule.wkst || ICAL.Time.MONDAY;
      const weeks = new Set(
        (rule.parts["BYDAY"] ?? []).map((value) => {
          const weekday = /(MO|TU|WE|TH|FR|SA|SU)$/.exec(String(value))?.[1] as Weekday;
          const sunday = (WEEKDAYS.indexOf(weekday) + 1) % 7;
          return Math.floor((((sunday - (start - 1) + 7) % 7) + days) / 7);
        }),
      );
      if (weeks.size > 1) moved.wkst = ((((start - 1 + days) % 7) + 7) % 7) + 1;
    }
    if (parts["BYMONTHDAY"] && (rule.freq === "MONTHLY" || rule.freq === "YEARLY")) {
      const date = Number(fromDay.slice(8));
      parts["BYMONTHDAY"] = unique(
        parts["BYMONTHDAY"].map((value) =>
          Number(value) === date ? Number(toDay.slice(8)) : value,
        ),
      );
    }
    if (parts["BYMONTH"] && rule.freq === "YEARLY") {
      const months = Number(toDay.slice(5, 7)) - Number(fromDay.slice(5, 7));
      parts["BYMONTH"] = unique(
        parts["BYMONTH"].map((value) => ((((Number(value) - 1 + months) % 12) + 12) % 12) + 1),
      );
    }
  }
  if (from.type !== "date" && to.type !== "date") {
    const shifted = (name: string, by: number, modulo: number) => {
      const values = parts[name];
      if (values && by !== 0) {
        parts[name] = unique(values.map((v) => (((Number(v) + by) % modulo) + modulo) % modulo));
      }
    };
    const part = (time: string, at: number) => Number(time.slice(at, at + 2));
    shifted("BYHOUR", part(to.local, 11) - part(from.local, 11), 24);
    shifted("BYMINUTE", part(to.local, 14) - part(from.local, 14), 60);
  }
  // UNTIL is of DTSTART's type (RFC 5545 §3.3.10): made all-day or timed, or
  // in another zone, the series ends on the same day, written in the new type.
  if (rule.until && !sameKind(from, to)) {
    const zone = from.type === "zoned" ? from.timeZone : "UTC";
    moved.until = untilOf(wallClockOf(fromIcalTime(rule.until), zone).slice(0, 10), to);
  }
  return moved;
}

/** Whether two times are of one type, and of one zone when zoned. */
function sameKind(a: ItemTime, b: ItemTime): boolean {
  if (a.type === "zoned" && b.type === "zoned") return a.timeZone === b.timeZone;
  return a.type === b.type;
}

/**
 * A `Repeat` moved with its series' start from day `from` to day `to`, as
 * `movedRule` moves its RRULE: what the edit dialog shows once the start's
 * date changed.
 */
export function movedRepeat(repeat: Repeat, from: string, to: string): Repeat {
  if (from === to) return repeat;
  const start: ItemTime = { type: "date", date: from };
  const end: ItemTime = { type: "date", date: to };
  const moved = readRule(movedRule(ruleOf(repeat, start), start, end), end, true).repeat;
  // No weekdays is the start's own, wherever it goes.
  const weekdays = repeat.weekdays.length === 0 ? [] : moved.weekdays;
  return { ...repeat, weekdays, monthlyWeekday: moved.monthlyWeekday };
}
