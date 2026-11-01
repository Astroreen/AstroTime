// Calendar days as the user sees them, `YYYY-MM-DD` strings like the core's
// ranges (docs/plans/foundation.md#D33): no Date objects in local time, so a
// day never shifts with the device's zone.
import { wallClockIn } from "@astrotime/core";

const DAY_MS = 86_400_000;

const msOf = (day: string) => Date.parse(`${day}T00:00:00Z`);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  return dayOf(msOf(day) + days * DAY_MS);
}

/** Calendar days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((msOf(b) - msOf(a)) / DAY_MS);
}

/** `count` days from `first`. */
export function daysFrom(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(first, i));
}

/** The ISO weekday: 1 is Monday, 7 is Sunday (as `Intl.Locale`'s week info counts). */
export function weekdayOf(day: string): number {
  return new Date(msOf(day)).getUTCDay() || 7;
}

/** The first day of the week holding `day`, for a week starting on `weekStart` (1–7). */
export function startOfWeek(day: string, weekStart: number): string {
  return addDays(day, -((weekdayOf(day) - weekStart + 7) % 7));
}

/** The first day of the month holding `day`. */
export function firstOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** The first day of the month `months` after (or before) the one holding `day`. */
export function addMonths(day: string, months: number): string {
  const index = Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1 + months;
  const year = String(Math.floor(index / 12)).padStart(4, "0");
  return `${year}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

/**
 * The six weeks a month is shown in, from the week holding its first day,
 * as the reference's month view and the month picker show them (design D86).
 */
export function monthDays(day: string, weekStart: number): string[] {
  return daysFrom(startOfWeek(firstOfMonth(day), weekStart), 42);
}

/** The ISO 8601 week number (weeks start on Monday; week 1 holds January 4). */
export function isoWeek(day: string): number {
  const thursday = addDays(day, 4 - weekdayOf(day));
  const january1 = `${thursday.slice(0, 4)}-01-01`;
  return Math.floor((msOf(thursday) - msOf(january1)) / DAY_MS / 7) + 1;
}

/** The day `epochMs` falls on in `timeZone`, and its minutes past midnight. */
export function nowIn(epochMs: number, timeZone: string): { today: string; minutes: number } {
  const local = wallClockIn(epochMs, timeZone);
  return {
    today: local.slice(0, 10),
    minutes: Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)),
  };
}

/** A `Date` at the day's UTC midnight, for `Intl` formatting with `timeZone: "UTC"`. */
export function utcDate(day: string, minutes = 0): Date {
  return new Date(msOf(day) + minutes * 60_000);
}
