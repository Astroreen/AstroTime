// What a reminder's notification says, in the user's language
// (docs/plans/foundation.md#D102): the item's title, and when it is as seen
// at the moment it fires: "11:15 – 11:45 · in 15 minutes", "Tomorrow, all
// day", "Due today". Dates and the relative time come from `Intl`.
import {
  wallClockIn,
  wallClockOf,
  zonedToEpoch,
  type ItemTime,
  type Reminder,
} from "@astrotime/core";
import type { TFunction } from "i18next";

import { daysBetween } from "../calendar/dates.ts";
import type { Formats } from "../calendar/format.ts";

export interface ReminderWords {
  readonly t: TFunction;
  readonly formats: Formats;
  readonly locale: string;
  readonly timeZone: string;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function capitalize(text: string, locale: string): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/** The notification of a reminder: its title and body. */
export function reminderNotification(
  reminder: Reminder,
  words: ReminderWords,
): { title: string; body: string } {
  const { t } = words;
  return { title: reminder.title ?? t("item.untitled"), body: bodyOf(reminder, words) };
}

function bodyOf(reminder: Reminder, words: ReminderWords): string {
  const { t, formats, locale, timeZone } = words;
  const fireDay = wallClockIn(reminder.fireAt, timeZone).slice(0, 10);
  const dayOf = (time: ItemTime) => wallClockOf(time, timeZone).slice(0, 10);
  // "today", "tomorrow", "yesterday", else "Fri, Nov 6".
  const dayWord = (day: string) => {
    const offset = daysBetween(fireDay, day);
    return Math.abs(offset) <= 1
      ? new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(offset, "day")
      : formats.shortDate(day);
  };
  // A time on the day it fires, or with its day.
  const at = (time: string, day: string) =>
    day === fireDay ? time : t("reminder.onDay", { day: dayWord(day), time });
  // How long until the time, while it is ahead by less than a day (a day
  // or more is said by its day).
  const withRelative = (when: string, time: ItemTime) => {
    const ahead = instantOf(time, timeZone) - reminder.fireAt;
    if (ahead < 0 || ahead >= DAY_MS) return when;
    return t("reminder.body", { when, relative: relative(ahead, locale) });
  };

  if (reminder.kind === "event") {
    const { start, end } = reminder;
    if (!start) return "";
    if (start.type === "date") {
      return capitalize(t("reminder.allDay", { day: dayWord(start.date) }), locale);
    }
    const time = end ? formats.timeRange(start, end, timeZone) : formats.time(start, timeZone);
    return capitalize(withRelative(at(time, dayOf(start)), start), locale);
  }

  // A task says its due, or its start when it has none.
  const time = reminder.due ?? reminder.start;
  if (!time) return t("reminder.task");
  const key = reminder.due ? "reminder.due" : "reminder.starts";
  if (time.type === "date") return t(key, { when: dayWord(time.date) });
  const when = t(key, { when: at(formats.time(time, timeZone), dayOf(time)) });
  return withRelative(when, time);
}

/** "now", "in 15 minutes", "in 90 minutes", "in 2 hours"; past 3 hours, in whole hours. */
function relative(ms: number, locale: string): string {
  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes === 0) {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "second");
  }
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (minutes < 60 || (minutes < 180 && minutes % 60 !== 0))
    return format.format(minutes, "minute");
  return format.format(Math.round(minutes / 60), "hour");
}

/** A time's instant as the user sees it: a date at the start of its day, a floating time in the zone. */
function instantOf(time: ItemTime, timeZone: string): number {
  if (time.type === "zoned") return time.epochMs;
  return zonedToEpoch(time.type === "date" ? `${time.date}T00:00:00` : time.local, timeZone);
}
