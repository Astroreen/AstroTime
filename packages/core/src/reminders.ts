// Reminders: when an item's alarms (`VALARM`) ask the user to be told, as
// one set every platform shows the same (docs/plans/android.md#D60). How an
// alarm becomes a reminder: docs/plans/foundation.md#D100.
import type { CalendarObject } from "./calendar-object.ts";
import type { Alarm, Item } from "./item.ts";
import { occurrencesBetween, type Occurrence, type Range } from "./occurrences.ts";
import { wallClockIn, zonedToEpoch, type ItemTime } from "./time.ts";
import { isDone } from "./undone.ts";

const DAY_MS = 86_400_000;

/** How far ahead the set reaches (android D60). */
export const REMINDER_HORIZON_MS = 7 * DAY_MS;
/** The most reminders a set holds, the soonest first (android D60). */
export const MAX_REMINDERS = 100;

/** One time an alarm asks to notify (GLOSSARY.md: Reminder). */
export interface Reminder {
  /**
   * Stable while the item and its alarm stay: the object, the occurrence,
   * the repeat and the alarm (its `UID`, else its place), so a platform can
   * tell a set from the one before.
   */
  readonly id: string;
  /** The calendar object it comes from, as the caller named it (the store's id). */
  readonly objectId: string;
  readonly uid: string;
  readonly kind: Item["kind"];
  /** The occurrence it is about; `null` for an item that does not recur, or a series as a whole. */
  readonly recurrenceId: ItemTime | null;
  /** When it fires, in milliseconds since the epoch. */
  readonly fireAt: number;
  /** `SUMMARY`. */
  readonly title: string | null;
  /** The occurrence's start (a task's `DTSTART`); `null` when it has none. */
  readonly start: ItemTime | null;
  /** An event's end (exclusive); `null` for a task. */
  readonly end: ItemTime | null;
  /** A task's due; `null` for an event, or a task without one. */
  readonly due: ItemTime | null;
}

/** A reminder with the words a platform shows, in the user's language. */
export interface ScheduledReminder extends Reminder {
  readonly notification: { readonly title: string; readonly body: string };
}

/** Whether the platform may notify: the web asks once, from a tap (foundation D101). */
export type ReminderPermission = "granted" | "denied" | "default" | "unsupported";

/**
 * How a platform shows reminders (docs/plans/android.md#D60): the shared code
 * hands it the whole set each time, and the platform only shows them.
 */
export interface ReminderScheduler {
  /** Replaces every reminder scheduled before with these, the soonest first. */
  schedule(reminders: readonly ScheduledReminder[]): void | Promise<void>;
  /** Calls `listener` with a reminder the user tapped; returns the function that stops it. */
  onOpen(listener: (reminder: ScheduledReminder) => void): () => void;
  permission(): ReminderPermission;
  /** Asks the user to let the platform notify; call it from a gesture. */
  requestPermission(): Promise<ReminderPermission>;
  /** Reminders fire only while the app is open (the web, foundation D101): the setting says so. */
  readonly whileOpenOnly: boolean;
}

/** Alarms that notify: `DISPLAY` and `AUDIO`. `EMAIL` is a server's, `NONE` (RFC 9074) is none. */
function notifies(alarm: Alarm): boolean {
  const action = alarm.action.toUpperCase();
  return action === "DISPLAY" || action === "AUDIO";
}

/** An item that reminds: not a done task (completed or cancelled), not a cancelled event. */
function reminds(item: Item): boolean {
  return item.kind === "task" ? !isDone(item) : item.status?.toUpperCase() !== "CANCELLED";
}

/** The times of an occurrence an alarm relates to. */
interface Times {
  readonly start: ItemTime | null;
  readonly end: ItemTime | null;
  readonly due: ItemTime | null;
}

function timesOf(occurrence: Occurrence): Times {
  const { item, start, end } = occurrence;
  if (item.kind === "event") return { start, end, due: null };
  // A task's occurrence spans its start to its due, or sits at whichever it
  // has; a due date ends the day after it (`Occurrence.end`).
  if (!item.due) return { start, end: null, due: null };
  if (!item.start) return { start: null, end: null, due: start };
  return { start, end: null, due: end.type === "date" ? shiftDate(end, -1) : end };
}

/** An item's own times, for an alarm at a time of its own (`TRIGGER;VALUE=DATE-TIME`). */
function ownTimes(item: Item): Times {
  return item.kind === "event"
    ? { start: item.start, end: item.end, due: null }
    : { start: item.start, end: null, due: item.due };
}

/**
 * What a relative trigger counts from. `START` is an event's start, a task's
 * `DTSTART`, or its due when it has no start: RFC 5545 requires a `DTSTART`
 * for it, and the due is the one time such a task has. `END` is an event's
 * end, a task's due, or its start when it has no due.
 */
function anchorOf(times: Times, kind: Item["kind"], relatedTo: "start" | "end"): ItemTime | null {
  if (kind === "event") return relatedTo === "start" ? times.start : times.end;
  return relatedTo === "start" ? (times.start ?? times.due) : (times.due ?? times.start);
}

const localMs = (local: string) => Date.parse(`${local}Z`);
const localOf = (ms: number) => new Date(ms).toISOString().slice(0, 19);

function shiftDate(time: ItemTime, days: number): ItemTime {
  if (time.type !== "date") return time;
  return {
    type: "date",
    date: localOf(localMs(`${time.date}T00:00:00`) + days * DAY_MS).slice(0, 10),
  };
}

/**
 * The instant an anchor plus an offset names. On a zoned time the offset's
 * days are days of its zone's wall clock and the rest is exact (RFC 5545
 * §3.3.6). A date (an all-day item) counts from the start of its day in the
 * user's zone, and a floating time is read in the user's zone; on both the
 * whole offset is wall-clock time, so `-PT15H` before an all-day item is
 * 09:00 the day before even across a DST change, as Google and Nextcloud
 * mean it.
 */
function instantOf(anchor: ItemTime, days: number, seconds: number, timeZone: string): number {
  if (anchor.type === "zoned") {
    let base = anchor.epochMs + days * DAY_MS;
    if (days !== 0) {
      try {
        base = zonedToEpoch(localOf(localMs(anchor.local) + days * DAY_MS), anchor.timeZone);
      } catch {
        // A zone `Intl` does not know (a VTIMEZONE's own name): exact days.
      }
    }
    return base + seconds * 1000;
  }
  const local = anchor.type === "date" ? `${anchor.date}T00:00:00` : anchor.local;
  return zonedToEpoch(localOf(localMs(local) + days * DAY_MS + seconds * 1000), timeZone);
}

/** The first fire of an alarm on an occurrence's times, or `null` when it has nothing to count from. */
function firstFire(alarm: Alarm, times: Times, kind: Item["kind"], timeZone: string) {
  const { trigger } = alarm;
  if (trigger.type === "absolute") return instantOf(trigger.at, 0, 0, timeZone);
  const anchor = anchorOf(times, kind, trigger.relatedTo);
  if (!anchor) return null;
  const exact = trigger.offsetSeconds - trigger.offsetDays * 86_400;
  return instantOf(anchor, trigger.offsetDays, exact, timeZone);
}

/** How an occurrence is named in a reminder's id. */
function occurrenceKey(recurrenceId: ItemTime | null): string {
  if (!recurrenceId) return "-";
  switch (recurrenceId.type) {
    case "date":
      return recurrenceId.date;
    case "floating":
      return recurrenceId.local;
    case "zoned":
      return String(recurrenceId.epochMs);
  }
}

/** The day `epochMs` falls on in `timeZone`. */
function dayIn(epochMs: number, timeZone: string): string {
  return wallClockIn(epochMs, timeZone).slice(0, 10);
}

/** Slack for days of the wall clock against exact days (a DST change moves by up to 2 hours). */
const SLACK_MS = 3 * 3_600_000;

/**
 * The reminders of a calendar object that fire within the range's days, in
 * the user's zone, soonest first. Throws `ExpansionLimitError` for a series
 * too dense to expand, as `occurrencesBetween` does.
 *
 * Each occurrence reminds by the alarms of the item that shows there: the
 * master's, or an exception's own (RFC 5545: an exception replaces the
 * occurrence whole). Cancelled occurrences, done tasks and cancelled events
 * do not remind; an alarm acknowledged at or after a time it fires does not
 * fire then. Two alarms of one occurrence at the same instant are one reminder.
 */
export function remindersOf(object: CalendarObject, objectId: string, range: Range): Reminder[] {
  const { timeZone } = range;
  const fromMs = zonedToEpoch(`${range.from}T00:00:00`, timeZone);
  const toMs = zonedToEpoch(`${range.to}T00:00:00`, timeZone);
  const { master } = object;
  // A done task is done in every occurrence (design D51), a cancelled series cancelled in each.
  if (master && !reminds(master)) return [];
  const items = [...(master ? [master] : []), ...object.exceptions];

  const found = new Map<string, Reminder>();
  const add = (
    item: Item,
    recurrenceId: ItemTime | null,
    times: Times,
    alarm: Alarm,
    index: number,
  ) => {
    const first = firstFire(alarm, times, item.kind, timeZone);
    if (first === null || !Number.isFinite(first)) return;
    const acknowledged = alarm.acknowledged
      ? instantOf(alarm.acknowledged, 0, 0, timeZone)
      : Number.NEGATIVE_INFINITY;
    const key = occurrenceKey(recurrenceId);
    // A server's REPEAT is not bounded: start at the first repeat in the
    // range, and stop after a set's worth of them.
    const step = (alarm.repeatEverySeconds ?? 0) * 1000;
    const start = step > 0 && first < fromMs ? Math.ceil((fromMs - first) / step) : 0;
    const last = Math.min(alarm.repeat, start + MAX_REMINDERS - 1);
    for (let repeat = start; repeat <= last; repeat++) {
      const fireAt = first + repeat * step;
      if (fireAt >= toMs) break;
      if (fireAt < fromMs || fireAt <= acknowledged) continue;
      const same = `${key}@${fireAt}`;
      const id = `${objectId}/${key}/${repeat}/${alarm.uid ?? `#${index}`}`;
      // Two alarms at one instant are one reminder: the same one whatever
      // their order, so its id stays when the other is removed or moved.
      const known = found.get(same);
      if (known && known.id <= id) continue;
      found.set(same, {
        id,
        objectId,
        uid: object.uid,
        kind: item.kind,
        recurrenceId,
        fireAt,
        title: item.summary,
        ...times,
      });
    }
  };

  // Alarms relative to an occurrence: every occurrence they can fire from
  // within the range, so the days before it (a lead) and after it (an alarm
  // after its time, and its repeats).
  const relative = items.flatMap((item) =>
    item.alarms.filter((alarm) => notifies(alarm) && alarm.trigger.type === "relative"),
  );
  if (relative.length > 0) {
    const offsets = relative.map((alarm) =>
      alarm.trigger.type === "relative" ? alarm.trigger.offsetSeconds * 1000 : 0,
    );
    const lead = Math.max(0, ...offsets.map((offset) => -offset));
    const lag = Math.max(
      0,
      ...relative.map(
        (alarm, i) => offsets[i]! + alarm.repeat * (alarm.repeatEverySeconds ?? 0) * 1000,
      ),
    );
    const from = dayIn(fromMs - lag - SLACK_MS, timeZone);
    const to = dayIn(toMs + lead + SLACK_MS + DAY_MS, timeZone);
    for (const occurrence of occurrencesBetween(object, { from, to, timeZone })) {
      const { item } = occurrence;
      if (!reminds(item)) continue;
      const times = timesOf(occurrence);
      item.alarms.forEach((alarm, index) => {
        if (notifies(alarm) && alarm.trigger.type === "relative") {
          add(item, occurrence.recurrenceId, times, alarm, index);
        }
      });
    }
  }

  // Alarms at a time of their own fire once: about their item, or about a
  // series as a whole (no one occurrence) when the master holds them.
  for (const item of items) {
    if (!reminds(item)) continue;
    const series = item === master && item.recurring;
    item.alarms.forEach((alarm, index) => {
      if (notifies(alarm) && alarm.trigger.type === "absolute") {
        add(
          item,
          item.recurrenceId,
          series ? { start: null, end: null, due: null } : ownTimes(item),
          alarm,
          index,
        );
      }
    });
  }

  return [...found.values()].toSorted(bySoonest);
}

function bySoonest(a: Reminder, b: Reminder): number {
  return a.fireAt - b.fireAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The set a platform is handed (android D60): the reminders that fire from
 * `nowMs` on within the horizon, the soonest first, at most `MAX_REMINDERS`.
 * A reminder whose time has passed is not in it.
 */
/**
 * How far back the set handed to a platform reaches: a reminder missed in a
 * sleep stays in it this long, and each platform shows it within its own
 * grace (the web 5 minutes, the desktop an hour) and drops it after.
 */
export const REMINDER_GRACE_MS = 60 * 60_000;

export function soonestReminders(
  reminders: Iterable<Reminder>,
  nowMs: number,
  options: { readonly horizonMs?: number; readonly max?: number; readonly backMs?: number } = {},
): Reminder[] {
  const { horizonMs = REMINDER_HORIZON_MS, max = MAX_REMINDERS, backMs = 0 } = options;
  const all = [...reminders].toSorted(bySoonest);
  // The hour back never takes a place of the ones to come.
  const back = all.filter((r) => r.fireAt >= nowMs - backMs && r.fireAt < nowMs);
  const ahead = all.filter((r) => r.fireAt >= nowMs && r.fireAt < nowMs + horizonMs);
  return [...back, ...ahead.slice(0, max)];
}
