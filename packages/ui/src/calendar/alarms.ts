// The reminders the edit dialog offers (docs/plans/design.md#D206): the four
// this device's user adds most, counted as items are saved, then Google's
// defaults; and a reminder of the user's own, an amount of a unit before.
import type { Preferences } from "../preferences.ts";
import { KEYS } from "../preferences.ts";

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const WEEK = 7 * DAY;

/** How many the menu offers, besides "Custom…". */
const OFFERED = 4;
/** How many offsets the tally keeps of each kind: the most added. */
const KEPT = 24;

/** What the user has added: offsets (negative, before) and how often, for timed and all-day items. */
export interface AlarmTally {
  readonly timed: readonly (readonly [offset: number, count: number])[];
  readonly allDay: readonly (readonly [offset: number, count: number])[];
}

/** Offered with no tally: before a timed item; on and before an all-day one, at 9:00. */
export const DEFAULTS = {
  timed: [-10 * MINUTE, -30 * MINUTE, -HOUR, -DAY],
  allDay: [9 * HOUR, -15 * HOUR, -(DAY + 15 * HOUR), -(6 * DAY + 15 * HOUR)],
} as const;
/** After the defaults, so the menu still offers four when the item has some of them. */
const MORE = {
  timed: [-5 * MINUTE, -15 * MINUTE, 0, -2 * HOUR, -2 * DAY, -WEEK],
  allDay: [-(2 * DAY + 15 * HOUR), -(13 * DAY + 15 * HOUR)],
} as const;

const pairs = (value: unknown): (readonly [number, number])[] =>
  Array.isArray(value)
    ? value.filter(
        (pair): pair is [number, number] =>
          Array.isArray(pair) &&
          pair.length === 2 &&
          Number.isInteger(pair[0]) &&
          Number.isInteger(pair[1]) &&
          pair[1] > 0,
      )
    : [];

/** The tally from what was stored; anything unreadable counts nothing. */
export function readTally(stored: string | null): AlarmTally {
  try {
    const value = JSON.parse(stored ?? "{}") as Partial<Record<keyof AlarmTally, unknown>>;
    return { timed: pairs(value.timed), allDay: pairs(value.allDay) };
  } catch {
    return { timed: [], allDay: [] };
  }
}

/** The tally with `offsets` added once each, for an item all day or not. */
export function tallied(
  tally: AlarmTally,
  allDay: boolean,
  offsets: readonly number[],
): AlarmTally {
  const kind = allDay ? "allDay" : "timed";
  // Stored the most added first, a tie the latest added first: one added
  // now is kept over one added long ago as often.
  const counts = new Map(tally[kind].toReversed());
  for (const offset of offsets) {
    const count = (counts.get(offset) ?? 0) + 1;
    counts.delete(offset);
    counts.set(offset, count);
  }
  const kept = [...counts]
    .toReversed()
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, KEPT);
  return { ...tally, [kind]: kept };
}

/**
 * Counts the reminders an item was saved with in this device's preferences,
 * each under the kind of item it was added to: an offset from an all-day
 * item's midnight means another thing than one before a time.
 */
export function countAlarms(
  preferences: Preferences,
  added: readonly { readonly allDay: boolean; readonly offset: number }[],
): void {
  if (added.length === 0) return;
  let tally = readTally(preferences.get(KEYS.alarmTally));
  for (const allDay of [false, true]) {
    const offsets = added.filter((a) => a.allDay === allDay).map((a) => a.offset);
    if (offsets.length > 0) tally = tallied(tally, allDay, offsets);
  }
  preferences.set(KEYS.alarmTally, JSON.stringify(tally));
}

/**
 * The reminders the menu offers: the most added first, then the defaults,
 * none the item already has, at most `OFFERED`.
 */
export function offeredAlarms(
  tally: AlarmTally,
  allDay: boolean,
  taken: readonly number[],
): readonly number[] {
  const kind = allDay ? "allDay" : "timed";
  const ranked = [...tally[kind].map(([offset]) => offset), ...DEFAULTS[kind], ...MORE[kind]];
  return [...new Set(ranked)].filter((offset) => !taken.includes(offset)).slice(0, OFFERED);
}

export const UNITS = {
  timed: ["minutes", "hours", "days", "weeks"],
  allDay: ["days", "weeks"],
} as const;
export type AlarmUnit = (typeof UNITS)["timed"][number];
const SECONDS: Record<AlarmUnit, number> = { minutes: MINUTE, hours: HOUR, days: DAY, weeks: WEEK };

/** The most of a unit a reminder of the user's own counts. */
export const MOST = 999;

/**
 * A reminder of the user's own: `amount` of `unit` before a timed item, or
 * before an all-day item's day at `time` ("HH:MM"), as Google's custom
 * notification; `0` is at the start, or on the day.
 */
export function customOffset(
  amount: number,
  unit: AlarmUnit,
  allDay: boolean,
  time = "09:00",
): number {
  // Zero before is the start itself, not -0.
  const before = -Math.min(MOST, Math.max(0, Math.round(amount))) * SECONDS[unit] || 0;
  if (!allDay) return before;
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return before + hours * HOUR + minutes * MINUTE;
}
