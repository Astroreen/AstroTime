// The home screen's schedule widget (docs/plans/android.md#D317): what it
// shows is worked out here, from the local store, as the Agenda works out its
// days (design D87), and handed to the platform whole, in the user's words,
// as a snapshot. The widget only draws it: a day's rows, its date beside
// the first, the "N undone tasks" row on today. The open app hands it one
// at every change, background sync after every run.
import { wallClockOf, type ItemTime } from "@astrotime/core";
import type { Store } from "@astrotime/storage";
import type { TFunction } from "i18next";

import { agendaDays } from "../calendar/agenda.ts";
import { addDays, nowIn } from "../calendar/dates.ts";
import type { Formats } from "../calendar/format.ts";
import type { ObjectCache, Entry } from "../calendar/query.ts";
import { fillOf, rgbOf } from "./fill.ts";

/** Days the snapshot reaches from today, today included, each named in it. */
export const WIDGET_DAYS = 31;
/** The most rows it holds: a full month's days are cut there, not the file grown without end. */
export const WIDGET_ROWS = 200;

/** A calendar without a colour of its own (design D47), as the views draw it. */
const DEFAULT_COLOR = rgbOf("#7c8db5")!;

/** What a tap on a row opens in the app (`WidgetHost.onOpen`). */
export type WidgetOpen =
  | {
      readonly kind: "item";
      readonly objectId: string;
      readonly recurrenceId: ItemTime | null;
      readonly day: string;
    }
  /** A day in the Day view: the undone row's (today), and the header's with no `day`. */
  | { readonly kind: "day"; readonly day?: string }
  /** Quick create for a new event: the widget's "+". */
  | { readonly kind: "create" };

export type SnapshotRow =
  | {
      readonly kind: "item";
      readonly title: string;
      /** "16:20–17:55", "Day 2 of 3"; `null` for an all-day item, a line of its own. */
      readonly time: string | null;
      /** `#rrggbb` behind white text (`fillOf`). */
      readonly fill: string;
      readonly task: boolean;
      readonly done: boolean;
      /** Spoken by a screen reader: what it is, its title and when. */
      readonly label: string;
      readonly open: WidgetOpen;
    }
  | {
      readonly kind: "undone";
      readonly text: string;
      /** The oldest task's calendar colour, behind its check mark. */
      readonly fill: string;
      readonly open: WidgetOpen;
    };

/**
 * One day of the range; a day with no rows is in it only for its words: the
 * widget shows it when it is today.
 */
export interface SnapshotDay {
  /** `YYYY-MM-DD`: the widget leaves out the days before its own today. */
  readonly day: string;
  /** "вт", "Tue". */
  readonly weekday: string;
  /** "24". */
  readonly date: string;
  /** "Ноябрь": the header's title while the day is the first shown. */
  readonly month: string;
  /** Spoken for the date beside the first row. */
  readonly label: string;
  readonly rows: readonly SnapshotRow[];
}

/** What the widget draws, until the next one. */
export interface ScheduleSnapshot {
  readonly version: 1;
  readonly days: readonly SnapshotDay[];
  /** Today's line when it has nothing ("Nothing planned today"). */
  readonly empty: string;
  /** The "+" button's name for a screen reader. */
  readonly create: string;
}

/**
 * Where a shell has a home screen widget (Android's, android D317): the UI
 * hands it each snapshot, and hears the taps that open the app.
 */
export interface WidgetHost {
  /** Called at every change, the same snapshot again too: the host leaves out what it has. */
  show(snapshot: ScheduleSnapshot): void | Promise<void>;
  /** Calls `listener` with each tap that opened the app; returns the function that stops it. */
  onOpen(listener: (open: WidgetOpen) => void): () => void;
}

export interface SnapshotWords {
  readonly t: TFunction;
  readonly formats: Formats;
  readonly timeZone: string;
}

/**
 * The snapshot at `now`: the shown calendars' items from today for
 * `WIDGET_DAYS` days, with the undone tasks before today on today, each
 * coloured as the views colour it. `hidden` and `hideCompleted` are the
 * user's choices on this device.
 */
export async function scheduleSnapshot(options: {
  readonly store: Store;
  readonly cache: ObjectCache;
  readonly hidden: ReadonlySet<string>;
  readonly hideCompleted: boolean;
  readonly words: SnapshotWords;
  readonly now: number;
  /** The most rows; `WIDGET_ROWS` unless a test asks for fewer. */
  readonly limit?: number;
}): Promise<ScheduleSnapshot> {
  const { store, cache, hidden, hideCompleted, words, now } = options;
  const { t, formats, timeZone } = words;
  const { today } = nowIn(now, timeZone);
  const to = addDays(today, WIDGET_DAYS);
  const calendars = (await store.calendars()).filter((calendar) => !hidden.has(calendar.id));
  const ids = calendars.map((calendar) => calendar.id);
  const colors = new Map(
    calendars.map((calendar) => [calendar.id, rgbOf(calendar.color) ?? DEFAULT_COLOR]),
  );
  const colorOf = (calendarId: string) => colors.get(calendarId) ?? DEFAULT_COLOR;
  const range = { from: today, to, timeZone };
  const all = cache.entries(await store.objectsBetween(ids, range), range);
  const entries = hideCompleted ? all.filter((entry) => !entry.done) : all;
  const undone = await store.undoneTasksBefore(ids, today, timeZone);

  const timeOf = (entry: Entry, allDay: boolean, part: { index: number; total: number } | null) => {
    if (part) return t("agenda.dayOf", part);
    if (allDay) return null;
    const { item, start, end } = entry.occurrence;
    // As the app's cards say it (`useItemTime`).
    return item.kind === "task" || wallClockOf(start, timeZone) === wallClockOf(end, timeZone)
      ? formats.time(start, timeZone)
      : formats.timeRange(start, end, timeZone);
  };

  let budget = options.limit ?? WIDGET_ROWS;
  const days: SnapshotDay[] = [];
  const agenda = new Map(
    agendaDays(entries, today, to, { today, timeZone, undone: undone.length }).map((day) => [
      day.day,
      day,
    ]),
  );
  // Every day of the range, those with nothing too: after midnight the
  // widget names the new today, and its month, from the snapshot's words.
  for (let date = today; date < to; date = addDays(date, 1)) {
    const day = agenda.get(date) ?? { day: date, items: [], undone: false };
    const rows: SnapshotRow[] = [];
    if (day.undone) {
      rows.push({
        kind: "undone",
        text: t("undone", { count: undone.length }),
        fill: fillOf(colorOf(undone[0]!.object.calendarId)),
        open: { kind: "day", day: day.day },
      });
    }
    for (const { entry, allDay, part } of day.items) {
      const { item } = entry.occurrence;
      const title = item.summary?.trim() || t("item.untitled");
      const time = timeOf(entry, allDay, part);
      const when = time ?? t("grid.allDay");
      rows.push({
        kind: "item",
        title,
        time,
        fill: fillOf(rgbOf(item.color) ?? colorOf(entry.calendarId), entry.done),
        task: item.kind === "task",
        done: entry.done,
        label:
          item.kind === "event"
            ? t("item.event", { title, time: when })
            : t(entry.done ? "item.taskDone" : "item.task", { title, time: when }),
        open: {
          kind: "item",
          objectId: entry.objectId,
          recurrenceId: entry.occurrence.recurrenceId,
          day: day.day,
        },
      });
    }
    // Past the most rows, a day keeps its date and none of its items.
    const kept = rows.slice(0, Math.max(0, budget));
    budget -= kept.length;
    days.push({
      day: day.day,
      weekday: formats.weekday(day.day),
      date: formats.dayNumber(day.day),
      month: formats.month(day.day),
      label: formats.fullDate(day.day),
      rows: kept,
    });
  }
  return { version: 1, days, empty: t("agenda.nothingToday"), create: t("edit.newEvent") };
}
