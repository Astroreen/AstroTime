// Dates and times in the user's locale, through `Intl` (docs/plans/foundation.md#D17):
// weekday and month names come from the platform, not the catalogs.
import type { ItemTime } from "@astrotime/core";
import { wallClockOf } from "@astrotime/core";

import { addDays, isoWeek, utcDate, weekdayOf } from "./dates.ts";
import type { LocaleSettings } from "./locale.ts";

const UTC = "UTC";

function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

export class Formats {
  readonly #locale: string;
  readonly #weekStart: number;
  readonly #weekday: Intl.DateTimeFormat;
  readonly #weekdayNarrow: Intl.DateTimeFormat;
  readonly #fullDate: Intl.DateTimeFormat;
  readonly #shortDate: Intl.DateTimeFormat;
  readonly #month: Intl.DateTimeFormat;
  readonly #monthYear: Intl.DateTimeFormat;
  readonly #hour: Intl.DateTimeFormat;
  readonly #time: Intl.DateTimeFormat;

  constructor({ locale, hour12, weekStart }: LocaleSettings) {
    const at = (options: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(locale, { timeZone: UTC, ...options });
    const clock: Intl.DateTimeFormatOptions = { hourCycle: hour12 ? "h12" : "h23" };
    this.#locale = locale;
    this.#weekStart = weekStart;
    this.#weekday = at({ weekday: "short" });
    this.#weekdayNarrow = at({ weekday: "narrow" });
    this.#fullDate = at({ weekday: "long", day: "numeric", month: "long" });
    this.#shortDate = at({ weekday: "short", day: "numeric", month: "short" });
    this.#month = at({ month: "long" });
    this.#monthYear = at({ month: "long", year: "numeric" });
    // 24 hours: "09:00", as the reference; 12 hours: "9 AM".
    this.#hour = at(
      hour12 ? { hour: "numeric", ...clock } : { hour: "2-digit", minute: "2-digit", ...clock },
    );
    this.#time = at({ hour: "numeric", minute: "2-digit", ...clock });
  }

  /** "Mon", "пн". */
  weekday(day: string): string {
    return this.#weekday.format(utcDate(day));
  }

  /** "M", "П": the month picker's column heads, in the locale's week order. */
  weekdayInitials(): string[] {
    // 2024-01-01 was a Monday.
    return Array.from({ length: 7 }, (_, i) =>
      this.#weekdayNarrow.format(utcDate(`2024-01-0${((this.#weekStart - 1 + i) % 7) + 1}`)),
    );
  }

  dayNumber(day: string): string {
    return String(Number(day.slice(8, 10)));
  }

  /** "Sunday, November 1", for accessible names. */
  fullDate(day: string): string {
    return this.#fullDate.format(utcDate(day));
  }

  /** "Tue, Nov 3". */
  shortDate(day: string): string {
    return this.#shortDate.format(utcDate(day));
  }

  /** "November", "October – November", "December 2026 – January 2027": the year only when it is not `currentYear`. */
  period(first: string, last: string, currentYear: string): string {
    const withYear = first.slice(0, 4) !== currentYear || last.slice(0, 4) !== currentYear;
    const format = withYear ? this.#monthYear : this.#month;
    const text =
      first.slice(0, 7) === last.slice(0, 7)
        ? format.format(utcDate(first))
        : format.formatRange(utcDate(first), utcDate(last));
    return capitalize(text, this.#locale);
  }

  /** "November 2026", the month picker's title. */
  monthYear(day: string): string {
    return capitalize(this.#monthYear.format(utcDate(day)), this.#locale);
  }

  /** The label on the line above the hour. */
  hour(hour: number): string {
    return this.#hour.format(utcDate("2024-01-01", hour * 60));
  }

  /** "9:30", "09:30", "9:30 AM": a time the user sees in `timeZone`. */
  time(time: ItemTime, timeZone: string): string {
    const local = wallClockOf(time, timeZone);
    return this.#time.format(new Date(`${local}Z`));
  }

  /** "9:30 – 10:30"; across days `Intl` adds the dates. */
  timeRange(start: ItemTime, end: ItemTime, timeZone: string): string {
    const s = new Date(`${wallClockOf(start, timeZone)}Z`);
    const e = new Date(`${wallClockOf(end, timeZone)}Z`);
    return this.#time.formatRange(s, e);
  }

  /**
   * The ISO number of the week the first day belongs to. Where weeks start
   * on Sunday, a Sunday belongs to the week of the Monday after it.
   */
  weekNumber(days: readonly string[]): number {
    const first = days[0]!;
    return isoWeek(this.#weekStart === 7 && weekdayOf(first) === 7 ? addDays(first, 1) : first);
  }
}
