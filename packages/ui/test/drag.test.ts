// Dragging and resizing without a browser (docs/plans/foundation.md#D14, D16,
// D113; design D111, D112): a point to a slot and a column, the edges that scroll,
// when a press is a drag, the times a drop or a key gives an event, a task's
// chip, a start–due task and an all-day item (on the wall clock, across DST,
// in the item's own zone), the scope a drop asks, and the write.
import {
  CalendarObject,
  isAllDay,
  layoutDay,
  occurrencesBetween,
  timesOf,
  wallClockOf,
  zonedTime,
  type ItemTime,
  type ItemTimes,
} from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import {
  columnAt,
  dropped,
  edgeScroll,
  ghostOf,
  keyMove,
  LONG_PRESS,
  moved,
  pressPhase,
  sized,
  slotAt,
  type Held,
} from "../src/calendar/drag.ts";
import { changeLocal, saveChanges, scopesForTimes, type Target } from "../src/calendar/editing.ts";
import { loadDemo } from "../src/demo/index.ts";

const timeZone = "Europe/Vilnius";
const NOW = Date.parse("2026-11-04T10:40:00+02:00");
const HOUR = 56;

const zoned = (local: string, zone = timeZone) => zonedTime(local, zone);
const date = (day: string): ItemTime => ({ type: "date", date: day });
const event = (start: ItemTime, end: ItemTime): Held => ({ kind: "event", times: { start, end } });
const task = (start: ItemTime | null, due: ItemTime | null): Held => ({
  kind: "task",
  times: { start, end: due },
});
/** The wall clocks of times on the user's grid. */
const walls = (times: ItemTimes | null) =>
  times && [times.start, times.end].map((time) => time && wallClockOf(time, timeZone));

describe("the geometry under the pointer", () => {
  test("a point is the 15-minute slot it is in, the day's first or last beyond it", () => {
    expect(slotAt(0, HOUR)).toBe(0);
    expect(slotAt(14.25 * HOUR, HOUR)).toBe(14 * 60 + 15);
    // Just above a slot's edge is still the slot before.
    expect(slotAt(14.25 * HOUR - 0.5, HOUR)).toBe(14 * 60);
    expect(slotAt(-30, HOUR)).toBe(0);
    expect(slotAt(25 * HOUR, HOUR)).toBe(23 * 60 + 45);
  });

  test("a point is the column it is over, the first or last beside them", () => {
    const columns = [
      { left: 50, right: 150 },
      { left: 150, right: 250 },
      { left: 250, right: 350 },
    ];
    expect(columnAt(10, columns)).toBe(0);
    expect(columnAt(149, columns)).toBe(0);
    expect(columnAt(150, columns)).toBe(1);
    expect(columnAt(300, columns)).toBe(2);
    expect(columnAt(900, columns)).toBe(2);
  });

  test("near the grid's edges a drag scrolls, once it has moved that way; over the strip it does not", () => {
    const [top, bottom] = [100, 700];
    // Moved up into the top edge: up, faster nearer the edge.
    expect(edgeScroll(140, 400, top, bottom)).toBeLessThan(0);
    expect(edgeScroll(101, 400, top, bottom)).toBeLessThan(edgeScroll(140, 400, top, bottom));
    // Picked up in the top edge and not moved up: still.
    expect(edgeScroll(130, 120, top, bottom)).toBe(0);
    // Above the grid, over the all-day strip: it drops there instead.
    expect(edgeScroll(80, 400, top, bottom)).toBe(0);
    expect(edgeScroll(400, 300, top, bottom)).toBe(0);
    expect(edgeScroll(690, 400, top, bottom)).toBeGreaterThan(0);
    expect(edgeScroll(900, 400, top, bottom)).toBe(16);
  });

  test("a mouse drags once it moves; a finger after a long press, and scrolls if it moves first", () => {
    expect(pressPhase("mouse", 3, 2000)).toBe("wait");
    expect(pressPhase("mouse", 4, 0)).toBe("drag");
    expect(pressPhase("pen", 6, 0)).toBe("drag");
    expect(pressPhase("touch", 5, 200)).toBe("wait");
    expect(pressPhase("touch", 9, 200)).toBe("scroll");
    expect(pressPhase("touch", 3, LONG_PRESS)).toBe("drag");
  });

  test("a press dragged over empty slots sizes from the first to the end of the last", () => {
    expect(sized(14 * 60, 16 * 60 + 15)).toEqual({ at: 14 * 60, length: 150 });
    // Dragged upwards: the same span.
    expect(sized(16 * 60 + 15, 14 * 60)).toEqual({ at: 14 * 60, length: 150 });
    expect(sized(600, 600)).toEqual({ at: 600, length: 15 });
  });
});

describe("what a drop gives an event", () => {
  const lunch = event(zoned("2026-11-04T13:00:00"), zoned("2026-11-04T14:00:00"));

  test("moved by the slots and days between pick-up and drop, its zone kept", () => {
    const times = dropped(
      lunch,
      "move",
      { day: "2026-11-04", minutes: 13 * 60 },
      { day: "2026-11-05", minutes: 15 * 60 },
      timeZone,
    );
    expect(times).toEqual({
      start: zoned("2026-11-05T15:00:00"),
      end: zoned("2026-11-05T16:00:00"),
    });
  });

  test("a drop that changes nothing gives nothing to write", () => {
    const spot = { day: "2026-11-04", minutes: 13 * 60 + 30 };
    expect(dropped(lunch, "move", spot, spot, timeZone)).toBeNull();
    expect(dropped(lunch, "end", spot, spot, timeZone)).toBeNull();
  });

  test("an item in another zone moves on the user's clock and stays in its own zone", () => {
    // 7:00 in New York is 14:00 in Vilnius.
    const call = event(
      zoned("2026-11-04T07:00:00", "America/New_York"),
      zoned("2026-11-04T08:00:00", "America/New_York"),
    );
    const times = moved(call, "move", 90, timeZone)!;
    expect(times.start).toEqual(zoned("2026-11-04T08:30:00", "America/New_York"));
    expect(walls(times)).toEqual(["2026-11-04T15:30:00", "2026-11-04T16:30:00"]);
  });

  test("a floating time keeps its wall clock; a UTC time stays UTC", () => {
    const floating = event(
      { type: "floating", local: "2026-11-04T09:00:00" },
      { type: "floating", local: "2026-11-04T10:00:00" },
    );
    expect(moved(floating, "move", 45, timeZone)).toEqual({
      start: { type: "floating", local: "2026-11-04T09:45:00" },
      end: { type: "floating", local: "2026-11-04T10:45:00" },
    });
    // Nextcloud Tasks writes UTC: 13:00Z is 15:00 in Vilnius.
    const report = task(null, zoned("2026-11-04T13:00:00", "UTC"));
    expect(moved(report, "move", 30, timeZone)!.end).toEqual(zoned("2026-11-04T13:30:00", "UTC"));
  });

  test("onto the day the clocks go back it keeps the length the grid draws (design D59)", () => {
    // Vilnius goes from 04:00 back to 03:00 on Sunday, October 25, 2026.
    const night = event(zoned("2026-10-24T01:00:00"), zoned("2026-10-24T05:00:00"));
    const times = moved(night, "move", 24 * 60, timeZone)!;
    expect(walls(times)).toEqual(["2026-10-25T01:00:00", "2026-10-25T05:00:00"]);
    const start = times.start as Extract<ItemTime, { type: "zoned" }>;
    const end = times.end as Extract<ItemTime, { type: "zoned" }>;
    // Drawn four tiles tall, as before; five hours pass that night.
    expect((end.epochMs - start.epochMs) / 3_600_000).toBe(5);
  });

  test("a start dropped into the hour the clocks skip goes forward and keeps its length", () => {
    // Vilnius skips 03:00–04:00 on Sunday, March 29, 2026.
    const early = event(zoned("2026-03-28T03:00:00"), zoned("2026-03-28T04:00:00"));
    const times = moved(early, "move", 24 * 60, timeZone)!;
    expect(walls(times)).toEqual(["2026-03-29T04:00:00", "2026-03-29T05:00:00"]);
  });

  test("its end resizes by the slots, at least 15 minutes after the start, at most its midnight", () => {
    expect(walls(moved(lunch, "end", 90, timeZone))).toEqual([
      "2026-11-04T13:00:00",
      "2026-11-04T15:30:00",
    ]);
    expect(walls(moved(lunch, "end", -120, timeZone))).toEqual([
      "2026-11-04T13:00:00",
      "2026-11-04T13:15:00",
    ]);
    expect(walls(moved(lunch, "end", 12 * 60, timeZone))).toEqual([
      "2026-11-04T13:00:00",
      "2026-11-05T00:00:00",
    ]);
  });

  test("its start resizes too, at most 15 minutes before the end, at least its midnight", () => {
    expect(walls(moved(lunch, "start", -60, timeZone))).toEqual([
      "2026-11-04T12:00:00",
      "2026-11-04T14:00:00",
    ]);
    expect(walls(moved(lunch, "start", 90, timeZone))).toEqual([
      "2026-11-04T13:45:00",
      "2026-11-04T14:00:00",
    ]);
    expect(walls(moved(lunch, "start", -15 * 60, timeZone))).toEqual([
      "2026-11-04T00:00:00",
      "2026-11-04T14:00:00",
    ]);
  });

  test("from the grid into the strip it is all day on that day; back onto the grid an hour long", () => {
    const allDay = dropped(
      lunch,
      "move",
      { day: "2026-11-04", minutes: 13 * 60 },
      { day: "2026-11-06", minutes: null },
      timeZone,
    );
    expect(allDay).toEqual({ start: date("2026-11-06"), end: date("2026-11-07") });
    const timed = dropped(
      event(date("2026-11-04"), date("2026-11-07")),
      "move",
      { day: "2026-11-05", minutes: null },
      { day: "2026-11-02", minutes: 9 * 60 + 30 },
      timeZone,
    );
    // A date made a time takes the user's zone (foundation D104).
    expect(timed).toEqual({
      start: zoned("2026-11-02T09:30:00"),
      end: zoned("2026-11-02T10:30:00"),
    });
  });

  test("in the strip and the Month it moves by days, keeping its length and its time", () => {
    const conference = event(date("2026-11-05"), date("2026-11-08"));
    expect(
      dropped(
        conference,
        "move",
        { day: "2026-11-06", minutes: null },
        { day: "2026-11-02", minutes: null },
        timeZone,
      ),
    ).toEqual({ start: date("2026-11-01"), end: date("2026-11-04") });
    expect(
      walls(
        dropped(
          lunch,
          "move",
          { day: "2026-11-04", minutes: null },
          { day: "2026-11-12", minutes: null },
          timeZone,
        ),
      ),
    ).toEqual(["2026-11-12T13:00:00", "2026-11-12T14:00:00"]);
    // Already all day on the day it is dropped on: nothing changes.
    expect(
      dropped(
        event(date("2026-11-06"), date("2026-11-07")),
        "move",
        { day: "2026-11-06", minutes: 600 },
        { day: "2026-11-06", minutes: null },
        timeZone,
      ),
    ).toBeNull();
  });

  test("a timed item over a day in the strip keeps its length when put on the grid", () => {
    const trip = event(zoned("2026-11-04T08:00:00"), zoned("2026-11-06T20:00:00"));
    expect(
      walls(
        dropped(
          trip,
          "move",
          { day: "2026-11-05", minutes: null },
          { day: "2026-11-05", minutes: 10 * 60 },
          timeZone,
        ),
      ),
    ).toEqual(["2026-11-05T10:00:00", "2026-11-07T22:00:00"]);
  });
});

describe("what a drop gives a task (foundation D16)", () => {
  test("a chip moves its due; a start on a date goes with it by the days it moved", () => {
    const report = task(null, zoned("2026-11-04T15:00:00"));
    expect(moved(report, "move", 120, timeZone)).toEqual({
      start: null,
      end: zoned("2026-11-04T17:00:00"),
    });
    const dated = task(date("2026-11-02"), zoned("2026-11-04T15:00:00"));
    expect(moved(dated, "move", 24 * 60 + 60, timeZone)).toEqual({
      start: date("2026-11-03"),
      end: zoned("2026-11-05T16:00:00"),
    });
    // A chip has no ends to resize.
    expect(moved(report, "end", 30, timeZone)).toBeNull();
  });

  test("a chip of a task with only a start moves its start", () => {
    const call = task(zoned("2026-11-04T11:00:00"), null);
    expect(moved(call, "move", -30, timeZone)).toEqual({
      start: zoned("2026-11-04T10:30:00"),
      end: null,
    });
  });

  test("a start–due block moves both; either end resizes", () => {
    const proposal = task(zoned("2026-11-05T10:00:00"), zoned("2026-11-05T12:00:00"));
    expect(walls(moved(proposal, "move", 60, timeZone))).toEqual([
      "2026-11-05T11:00:00",
      "2026-11-05T13:00:00",
    ]);
    expect(walls(moved(proposal, "end", 30, timeZone))).toEqual([
      "2026-11-05T10:00:00",
      "2026-11-05T12:30:00",
    ]);
    expect(walls(moved(proposal, "start", -45, timeZone))).toEqual([
      "2026-11-05T09:15:00",
      "2026-11-05T12:00:00",
    ]);
  });

  test("a task due on a day moves in the strip; into the grid it is due at the slot, out of it due that day", () => {
    const gift = task(null, date("2026-11-04"));
    expect(
      dropped(
        gift,
        "move",
        { day: "2026-11-04", minutes: null },
        { day: "2026-11-06", minutes: null },
        timeZone,
      ),
    ).toEqual({ start: null, end: date("2026-11-06") });
    expect(
      dropped(
        gift,
        "move",
        { day: "2026-11-04", minutes: null },
        { day: "2026-11-05", minutes: 16 * 60 },
        timeZone,
      ),
    ).toEqual({ start: null, end: zoned("2026-11-05T16:00:00") });
    expect(
      dropped(
        task(null, zoned("2026-11-04T15:00:00")),
        "move",
        { day: "2026-11-04", minutes: 15 * 60 },
        { day: "2026-11-04", minutes: null },
        timeZone,
      ),
    ).toEqual({ start: null, end: date("2026-11-04") });
  });
});

describe("the keys (design D112)", () => {
  test("Alt and an arrow: 15 minutes or a day on the grid, a day in the strip, a week up or down in the Month", () => {
    expect(keyMove("grid", "ArrowDown", false)).toEqual({ grip: "move", minutes: 15 });
    expect(keyMove("grid", "ArrowUp", false)).toEqual({ grip: "move", minutes: -15 });
    expect(keyMove("grid", "ArrowLeft", false)).toEqual({ grip: "move", minutes: -1440 });
    expect(keyMove("grid", "ArrowDown", true)).toEqual({ grip: "end", minutes: 15 });
    expect(keyMove("strip", "ArrowRight", false)).toEqual({ grip: "move", minutes: 1440 });
    expect(keyMove("strip", "ArrowUp", false)).toBeNull();
    expect(keyMove("strip", "ArrowUp", true)).toBeNull();
    expect(keyMove("month", "ArrowUp", false)).toEqual({ grip: "move", minutes: -7 * 1440 });
    expect(keyMove("grid", "Enter", false)).toBeNull();
  });
});

describe("the ghost", () => {
  test("is placed as the item will be: a block at its new time, a task due on a day in the strip", () => {
    const ics = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\nBEGIN:VEVENT\r\nUID:lunch\r\nDTSTAMP:20260101T000000Z\r\nSUMMARY:Lunch\r\nDTSTART;TZID=Europe/Vilnius:20261104T130000\r\nDTEND;TZID=Europe/Vilnius:20261104T140000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
    const [occurrence] = occurrencesBetween(CalendarObject.parse(ics), {
      from: "2026-11-04",
      to: "2026-11-05",
      timeZone,
    });
    const ghost = ghostOf(occurrence!, {
      start: zoned("2026-11-05T15:00:00"),
      end: zoned("2026-11-05T16:30:00"),
    });
    const [placed] = layoutDay([ghost], "2026-11-05", { timeZone }).timed;
    expect([placed!.top, placed!.bottom]).toEqual([900, 990]);
    expect(
      isAllDay(
        ghostOf(occurrence!, { start: date("2026-11-06"), end: date("2026-11-07") }),
        timeZone,
      ),
    ).toBe(true);
  });
});

describe("a drop saved (foundation D113)", () => {
  async function demo() {
    const store = await Store.open(nodeDriver());
    await loadDemo(store, { languages: ["en-US"], timeZone, now: NOW });
    const calendars = await store.calendars();
    const byName = (name: string) => calendars.find((c) => c.name === name)!;
    return { store, byName };
  }
  const targetOf = (row: { id: string; calendarId: string; ics: string }, day: string): Target => {
    const object = CalendarObject.parse(row.ics);
    const [occurrence] = occurrencesBetween(object, {
      from: day,
      to: `${day.slice(0, 8)}${String(Number(day.slice(8)) + 1).padStart(2, "0")}`,
      timeZone,
    });
    return {
      objectId: row.id,
      calendarId: row.calendarId,
      object,
      recurrenceId: occurrence!.recurrenceId,
      item: occurrence!.item,
    };
  };

  test("an occurrence asks all three scopes on its day, two on another, as its rights allow; an item that does not repeat none", async () => {
    const { store, byName } = await demo();
    const work = byName("Work");
    const standUp = targetOf((await store.objectAt(work.id, "demo-standup.ics"))!, "2026-11-05");
    const held: Held = { kind: "event", times: timesOf(standUp.object, standUp.recurrenceId) };
    expect(scopesForTimes(standUp, moved(held, "move", 60, timeZone)!, timeZone)).toEqual([
      "this",
      "following",
      "all",
    ]);
    expect(scopesForTimes(standUp, moved(held, "end", 15, timeZone)!, timeZone)).toHaveLength(3);
    expect(scopesForTimes(standUp, moved(held, "move", 1440, timeZone)!, timeZone)).toEqual([
      "this",
      "following",
    ]);
    // A split is a new item: a calendar that takes none offers no "following" (D37).
    const noCreate = { create: false, edit: true, delete: true };
    expect(
      scopesForTimes(standUp, moved(held, "move", 1440, timeZone)!, timeZone, noCreate),
    ).toEqual(["this"]);
    const review = targetOf((await store.objectAt(work.id, "demo-review.ics"))!, "2026-11-04");
    const times = timesOf(review.object, null);
    expect(
      scopesForTimes(review, moved({ kind: "event", times }, "move", 60, timeZone)!, timeZone),
    ).toEqual([]);
  });

  test("writes only the new times, every other line kept; this occurrence as its exception", async () => {
    const { store, byName } = await demo();
    const personal = byName("Personal");
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Another client//EN",
      "BEGIN:VEVENT",
      "UID:yoga",
      "DTSTAMP:20260101T000000Z",
      "SUMMARY:Yoga",
      "DTSTART;TZID=Europe/Vilnius:20261104T180000",
      "DTEND;TZID=Europe/Vilnius:20261104T190000",
      "X-OTHER-CLIENT;KEEP=yes:its own",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    await changeLocal(store, async (local) => {
      await local.save(personal.id, ics);
    });
    const row = (await store.objectAt(personal.id, "yoga.ics"))!;
    const target = targetOf(row, "2026-11-04");
    const times = moved(
      { kind: "event", times: timesOf(target.object, null) },
      "move",
      30,
      timeZone,
    )!;
    await saveChanges(
      store,
      { target, changes: { time: times }, calendarId: personal.id, scope: "all" },
      { now: NOW, uid: () => "unused" },
    );
    const saved = (await store.objectAt(personal.id, "yoga.ics"))!.ics;
    expect(saved).toContain("DTSTART;TZID=Europe/Vilnius:20261104T183000");
    expect(saved).toContain("DTEND;TZID=Europe/Vilnius:20261104T193000");
    expect(saved).toContain("X-OTHER-CLIENT;KEEP=yes:its own");
    expect(saved).toContain("PRODID:-//Another client//EN");

    const work = byName("Work");
    const standUp = targetOf((await store.objectAt(work.id, "demo-standup.ics"))!, "2026-11-05");
    const later = moved(
      { kind: "event", times: timesOf(standUp.object, standUp.recurrenceId) },
      "move",
      60,
      timeZone,
    )!;
    await saveChanges(
      store,
      { target: standUp, changes: { time: later }, calendarId: work.id, scope: "this" },
      { now: NOW, uid: () => "unused" },
    );
    const series = CalendarObject.parse((await store.objectAt(work.id, "demo-standup.ics"))!.ics);
    expect(series.exceptions).toHaveLength(1);
    expect(timesOf(series, standUp.recurrenceId).start).toEqual(zoned("2026-11-05T10:00:00"));
    // The master is as it was: the other days keep 9:00.
    expect(timesOf(series, null).start).toEqual(
      standUp.object.master && timesOf(standUp.object, null).start,
    );
  });
});
