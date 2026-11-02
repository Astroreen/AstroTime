// The reminders the edit dialog offers (design D206): the most added on this
// device first, then the defaults, and a reminder of the user's own.
import { describe, expect, test } from "vite-plus/test";

import {
  countAlarms,
  customOffset,
  DEFAULTS,
  offeredAlarms,
  readTally,
  tallied,
} from "../src/calendar/alarms.ts";
import { KEYS, memoryPreferences } from "../src/preferences.ts";

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;
const NONE = readTally(null);

describe("offeredAlarms", () => {
  test("with nothing added, Google's defaults: four before a timed item, four at 9:00 for an all-day one", () => {
    expect(offeredAlarms(NONE, false, [])).toEqual([-10 * MINUTE, -30 * MINUTE, -HOUR, -DAY]);
    expect(offeredAlarms(NONE, true, [])).toEqual(DEFAULTS.allDay);
  });

  test("the most added come first, a tie the latest added first; defaults fill the rest", () => {
    let tally = tallied(NONE, false, [-2 * 7 * DAY, -4 * DAY]);
    tally = tallied(tally, false, [-4 * DAY]);
    expect(offeredAlarms(tally, false, [])).toEqual([
      -4 * DAY,
      -14 * DAY,
      -10 * MINUTE,
      -30 * MINUTE,
    ]);
    // A timed item's tally is not an all-day one's.
    expect(offeredAlarms(tally, true, [])).toEqual(DEFAULTS.allDay);
  });

  test("a reminder the item already has is not offered again; four are still offered", () => {
    expect(offeredAlarms(NONE, false, [-30 * MINUTE])).toEqual([
      -10 * MINUTE,
      -HOUR,
      -DAY,
      -5 * MINUTE,
    ]);
    const tally = tallied(NONE, false, [-5 * MINUTE]);
    expect(offeredAlarms(tally, false, [-10 * MINUTE])).toEqual([
      -5 * MINUTE,
      -30 * MINUTE,
      -HOUR,
      -DAY,
    ]);
  });
});

describe("the tally", () => {
  test("is kept in the preferences as items are saved, each under the kind it was added to", () => {
    const preferences = memoryPreferences();
    countAlarms(preferences, [{ allDay: true, offset: -14 * DAY + 9 * HOUR }]);
    countAlarms(preferences, []);
    // Added before "All day" switched on: a timed reminder still.
    countAlarms(preferences, [
      { allDay: false, offset: -10 * MINUTE },
      { allDay: true, offset: -15 * HOUR },
    ]);
    expect(readTally(preferences.get(KEYS.alarmTally))).toEqual({
      timed: [[-10 * MINUTE, 1]],
      allDay: [
        [-15 * HOUR, 1],
        [-14 * DAY + 9 * HOUR, 1],
      ],
    });
  });

  test("anything unreadable counts nothing", () => {
    expect(readTally("not json")).toEqual(NONE);
    expect(readTally('{"timed":[[1.5,2],[60,0],["x",1],[-600,3]],"allDay":7}')).toEqual({
      timed: [[-600, 3]],
      allDay: [],
    });
  });

  test("keeps the 24 most added of a kind; one added now outlasts the oldest as often", () => {
    const offsets = Array.from({ length: 30 }, (_, i) => -(i + 1) * MINUTE);
    let tally = tallied(NONE, false, offsets);
    expect(tally.timed).toHaveLength(24);
    expect(tally.timed[0]).toEqual([-30 * MINUTE, 1]);
    tally = tallied(tally, false, [-MINUTE, -20 * MINUTE]);
    expect(tally.timed[0]).toEqual([-20 * MINUTE, 2]);
    expect(tally.timed[1]).toEqual([-MINUTE, 1]);
    expect(tally.timed.map(([offset]) => offset)).not.toContain(-7 * MINUTE);
    expect(tally.timed).toHaveLength(24);
  });

  test("a reminder added now is kept even when 24 others were added more often", () => {
    const offsets = Array.from({ length: 24 }, (_, i) => -(i + 1) * MINUTE);
    let tally = tallied(NONE, false, offsets);
    tally = tallied(tally, false, offsets);
    tally = tallied(tally, false, [-3 * HOUR]);
    expect(tally.timed).toHaveLength(24);
    expect(tally.timed.at(-1)).toEqual([-3 * HOUR, 1]);
    // The least added (the oldest of those) went to make room.
    expect(tally.timed.map(([offset]) => offset)).not.toContain(-MINUTE);
    expect(offeredAlarms(tally, false, [])).toHaveLength(4);
  });
});

describe("customOffset", () => {
  test("an amount of a unit before a timed item", () => {
    expect(customOffset(2, "weeks", false)).toBe(-14 * DAY);
    expect(customOffset(4, "days", false)).toBe(-4 * DAY);
    expect(customOffset(90, "minutes", false)).toBe(-90 * MINUTE);
    expect(customOffset(0, "hours", false)).toBe(0);
  });

  test("days or weeks before an all-day item's day, at a time of the day", () => {
    expect(customOffset(2, "weeks", true, "09:00")).toBe(-14 * DAY + 9 * HOUR);
    expect(customOffset(1, "days", true, "18:30")).toBe(-DAY + 18 * HOUR + 30 * MINUTE);
    expect(customOffset(0, "days", true, "08:00")).toBe(8 * HOUR);
  });

  test("an amount out of range is held to 0–999", () => {
    expect(customOffset(-3, "days", false)).toBe(0);
    expect(customOffset(5000, "minutes", false)).toBe(-999 * MINUTE);
  });
});
