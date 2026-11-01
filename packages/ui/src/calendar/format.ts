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
  readonly #shortDateYear: Intl.DateTimeFormat;
  readonly #weekdayLong: Intl.DateTimeFormat;
  readonly #relativeDay: Intl.RelativeTimeFormat;
  readonly #month: Intl.DateTimeFormat;
  readonly #monthYear: Intl.DateTimeFormat;
  readonly #hour: Intl.DateTimeFormat;
  readonly #time: Intl.DateTimeFormat;
  readonly #dateTime: Intl.DateTimeFormat;
  readonly #monthDay: Intl.DateTimeFormat;
  readonly #date: Intl.DateTimeFormat;
  readonly #dayDate: Intl.DateTimeFormat;

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
    this.#shortDateYear = at({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
    this.#weekdayLong = at({ weekday: "long" });
    this.#relativeDay = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    this.#month = at({ month: "long" });
    this.#monthYear = at({ month: "long", year: "numeric" });
    // 24 hours: "09:00", as the reference; 12 hours: "9 AM".
    this.#hour = at(
      hour12 ? { hour: "numeric", ...clock } : { hour: "2-digit", minute: "2-digit", ...clock },
    );
    this.#time = at({ hour: "numeric", minute: "2-digit", ...clock });
    this.#monthDay = at({ month: "long", day: "numeric" });
    this.#date = at({ day: "numeric", month: "short", year: "numeric" });
    this.#dayDate = at({ weekday: "long", day: "numeric", month: "long", year: "numeric" });
    this.#dateTime = at({
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...clock,
    });
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

  /** "Today", "Tomorrow", "Yesterday"; else "Thu, Nov 5", with the year when it is not `today`'s. */
  day(day: string, today: string): string {
    const offset = Math.round((utcDate(day).getTime() - utcDate(today).getTime()) / 86_400_000);
    if (Math.abs(offset) <= 1) {
      return capitalize(this.#relativeDay.format(offset, "day"), this.#locale);
    }
    const format = day.slice(0, 4) === today.slice(0, 4) ? this.#shortDate : this.#shortDateYear;
    return format.format(utcDate(day));
  }

  /** "Monday", "Понедельник": a weekday by its ISO number (1 is Monday). */
  weekdayName(weekday: number): string {
    // 2024-01-01 was a Monday.
    return capitalize(this.#weekdayLong.format(utcDate(`2024-01-0${weekday}`)), this.#locale);
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

  /** "9:30 – 10:30"; across days with the dates, "Nov 8, 10:00 PM – Nov 9, 1:00 AM". */
  timeRange(start: ItemTime, end: ItemTime, timeZone: string): string {
    const s = wallClockOf(start, timeZone);
    const e = wallClockOf(end, timeZone);
    const format = s.slice(0, 10) === e.slice(0, 10) ? this.#time : this.#dateTime;
    return format.formatRange(new Date(`${s}Z`), new Date(`${e}Z`));
  }

  /** "November 4", "4 ноября": a yearly rule's day. */
  monthDay(day: string): string {
    return this.#monthDay.format(utcDate(day));
  }

  /** "Dec 31, 2026": a rule's last day, a reminder's date. */
  date(day: string): string {
    return this.#date.format(utcDate(day));
  }

  /**
   * "Wednesday, November 4", with the year when it is not `currentYear`;
   * capitalized to start a line, as it is in the middle of one ("среда").
   */
  longDate(day: string, currentYear: string, start = true): string {
    const format = day.slice(0, 4) === currentYear ? this.#fullDate : this.#dayDate;
    const text = format.format(utcDate(day));
    return start ? capitalize(text, this.#locale) : text;
  }

  /** "November 4 – 6", "4–6 ноября": the days of an item over several. */
  dateRange(first: string, last: string): string {
    return capitalize(this.#monthDay.formatRange(utcDate(first), utcDate(last)), this.#locale);
  }

  /** "9:30", "09:30", "9:30 AM": a wall clock `HH:MM` in the user's clock. */
  clock(time: string): string {
    return this.#time.format(new Date(`2024-01-01T${time}:00Z`));
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
