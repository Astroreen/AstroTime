// A series' rule and an item's reminders in words, in the user's language
// (docs/plans/foundation.md#D17): "Every 2 weeks on Monday, Wednesday",
// "Каждые 2 недели в понедельник, среду", "15 minutes before".
import { WEEKDAYS, type Alarm, type ItemTime, type Repeat, type Weekday } from "@astrotime/core";
import type { TFunction } from "i18next";

import type { Formats } from "./format.ts";

const dayOf = (time: ItemTime) => (time.type === "date" ? time.date : time.local.slice(0, 10));

/** The weekday a day falls on. */
function weekdayOfDay(day: string): Weekday {
  return WEEKDAYS[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7]!;
}

/** "on Monday, Wednesday", "в понедельник, среду": the first with its preposition. */
function onDays(days: readonly Weekday[], t: TFunction): string {
  const ordered = WEEKDAYS.filter((day) => days.includes(day));
  return ordered
    .map((day, index) => t(index === 0 ? `weekday.onFirst.${day}` : `weekday.on.${day}`))
    .join(", ");
}

/** A rule without its end: "Every 2 weeks on Monday". */
function ruleWords(repeat: Repeat, start: ItemTime | null, t: TFunction, formats: Formats): string {
  const count = repeat.interval;
  const day = start ? dayOf(start) : null;
  const many = count > 1;
  switch (repeat.frequency) {
    case "DAILY":
      return many ? t("repeat.dailyN", { count }) : t("repeat.daily");
    case "WEEKLY": {
      const weekdays =
        repeat.weekdays.length > 0 ? repeat.weekdays : day ? [weekdayOfDay(day)] : [];
      const workweek = ["MO", "TU", "WE", "TH", "FR"];
      if (!many && weekdays.length === 5 && workweek.every((d) => weekdays.includes(d as Weekday)))
        return t("repeat.weekdays");
      const days = onDays(weekdays, t);
      return many ? t("repeat.weeklyN", { count, days }) : t("repeat.weekly", { days });
    }
    case "MONTHLY": {
      if (repeat.monthlyWeekday) {
        const { nth, weekday } = repeat.monthlyWeekday;
        const gender = t(`weekday.gender.${weekday}`);
        const words = {
          nth: t(`nth.${nth}.${gender}` as "nth.1.m"),
          weekday: t(`weekday.on.${weekday}`),
        };
        return many
          ? t("repeat.monthlyWeekdayN", { count, ...words })
          : t("repeat.monthlyWeekday", words);
      }
      const date = day ? Number(day.slice(8, 10)) : 1;
      return many ? t("repeat.monthlyN", { count, day: date }) : t("repeat.monthly", { day: date });
    }
    case "YEARLY": {
      const date = day ? formats.monthDay(day) : "";
      return many ? t("repeat.yearlyN", { count, date }) : t("repeat.yearly", { date });
    }
  }
}

/** A rule in words, with its end: "Every week on Monday, 6 times". */
export function repeatWords(
  repeat: Repeat,
  start: ItemTime | null,
  t: TFunction,
  formats: Formats,
): string {
  const rule = ruleWords(repeat, start, t, formats);
  const { end } = repeat;
  if (end.type === "never") return rule;
  const words =
    end.type === "count"
      ? t("repeat.count", { count: end.count })
      : t("repeat.until", { date: formats.date(end.until) });
  return t("repeat.withEnd", { rule, end: words });
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const WEEK = 7 * DAY;

/** "15 minutes", "2 hours", "1 day", "1 week": a reminder's distance from its item. */
function amount(seconds: number, t: TFunction): string {
  if (seconds % WEEK === 0) return t("duration.weeks", { count: seconds / WEEK });
  if (seconds % DAY === 0) return t("duration.days", { count: seconds / DAY });
  if (seconds % HOUR === 0) return t("duration.hours", { count: seconds / HOUR });
  return t("duration.minutes", { count: Math.round(seconds / MINUTE) });
}

const clockOf = (seconds: number) =>
  `${String(Math.floor(seconds / HOUR)).padStart(2, "0")}:${String(Math.floor((seconds % HOUR) / MINUTE)).padStart(2, "0")}`;

/**
 * A reminder in words. For an all-day item one before its day reads as the
 * day and the time it rings, as Google words it: "1 day before at 9:00".
 */
export function alarmWords(
  alarm: Pick<Alarm, "trigger">,
  options: { readonly allDay: boolean; readonly task: boolean },
  t: TFunction,
  formats: Formats,
  timeZone: string,
): string {
  const { trigger } = alarm;
  if (trigger.type === "absolute") {
    const at = trigger.at;
    const day = at.type === "date" ? at.date : formats.date(dayOf(at));
    return t("alarm.at", {
      time: at.type === "date" ? day : `${day}, ${formats.time(at, timeZone)}`,
    });
  }
  const offset = trigger.offsetSeconds;
  if (options.allDay && trigger.relatedTo === "start") {
    const days = Math.floor(offset / DAY);
    const time = formats.clock(clockOf(offset - days * DAY));
    if (days === 0) return t("alarm.onTheDay", { time });
    if (days < 0 && -days % 7 === 0) return t("alarm.weeksBeforeAt", { count: -days / 7, time });
    if (days < 0) return t("alarm.daysBeforeAt", { count: -days, time });
  }
  if (offset === 0) {
    return t(
      trigger.relatedTo === "end"
        ? options.task
          ? "alarm.atDue"
          : "alarm.atEnd"
        : "alarm.atStart",
    );
  }
  const words = amount(Math.abs(offset), t);
  if (trigger.relatedTo === "end" && !options.task) {
    return t(offset < 0 ? "alarm.beforeEnd" : "alarm.afterEnd", { amount: words });
  }
  return t(offset < 0 ? "alarm.before" : "alarm.after", { amount: words });
}

/** The reminders the edit dialog offers, as Google's: before a timed item, or on and before an all-day one. */
export function alarmPresets(allDay: boolean): readonly number[] {
  return allDay
    ? [9 * HOUR, -15 * HOUR, -(DAY + 15 * HOUR), -(6 * DAY + 15 * HOUR)]
    : [
        0,
        -5 * MINUTE,
        -10 * MINUTE,
        -15 * MINUTE,
        -30 * MINUTE,
        -HOUR,
        -2 * HOUR,
        -DAY,
        -2 * DAY,
        -WEEK,
      ];
}
