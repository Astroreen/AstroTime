import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  ExpansionLimitError,
  occurrencesBetween,
  wallClockOf,
  type Occurrence,
  type Range,
} from "../src/index.ts";
import { load } from "./support.ts";

const vilnius = (from: string, to: string): Range => ({ from, to, timeZone: "Europe/Vilnius" });
const starts = (occurrences: Occurrence[], timeZone = "Europe/Vilnius") =>
  occurrences.map((o) => wallClockOf(o.start, timeZone));

describe("series", () => {
  test("RRULE with COUNT, an EXDATE and a moved exception", () => {
    const occurrences = occurrencesBetween(
      load("nextcloud-event-recurring.ics"),
      vilnius("2026-10-01", "2026-12-01"),
    );
    // Four Tuesdays from 20 Oct; 3 Nov is excluded, 27 Oct moved to noon.
    expect(starts(occurrences)).toEqual([
      "2026-10-20T10:00:00",
      "2026-10-27T12:00:00",
      "2026-11-10T10:00:00",
    ]);
    expect(occurrences[1]?.item.summary).toBe("Standup (moved)");
    expect(occurrences[1]?.recurrenceId).toMatchObject({ local: "2026-10-27T10:00:00" });
    expect(occurrences[0]?.recurrenceId).toMatchObject({ local: "2026-10-20T10:00:00" });
  });

  test("wall-clock length and time are kept across the DST change", () => {
    // Vilnius leaves summer time on 25 Oct: 10:00 is 07:00Z before, 08:00Z after.
    const occurrences = occurrencesBetween(
      load("nextcloud-event-recurring.ics"),
      vilnius("2026-11-10", "2026-11-11"),
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0]?.start).toMatchObject({ epochMs: Date.parse("2026-11-10T08:00:00Z") });
    expect(occurrences[0]?.end).toMatchObject({ local: "2026-11-10T10:30:00" });
  });

  test("an exception moved into the range shows even when its original slot is outside", () => {
    // 27 Oct 10:00 moved to 12:00 the same day; a range of the afternoon only catches it.
    const occurrences = occurrencesBetween(
      load("nextcloud-event-recurring.ics"),
      vilnius("2026-10-27", "2026-10-28"),
    );
    expect(occurrences.map((o) => o.item.summary)).toEqual(["Standup (moved)"]);
  });

  test("an unending series stops at the range", () => {
    const occurrences = occurrencesBetween(
      load("tasksorg-task-recurring.ics"),
      vilnius("2026-11-01", "2026-11-15"),
    );
    expect(starts(occurrences)).toEqual([
      "2026-11-02T00:00:00",
      "2026-11-05T00:00:00",
      "2026-11-08T00:00:00",
      "2026-11-11T00:00:00",
      "2026-11-14T00:00:00",
    ]);
    expect(occurrences[0]?.start).toEqual({ type: "date", date: "2026-11-02" });
  });
});

describe("placement", () => {
  test("an all-day span touches each of its days and no more", () => {
    const object = load("thunderbird-event-allday.ics");
    expect(occurrencesBetween(object, vilnius("2026-11-13", "2026-11-14"))).toHaveLength(1);
    expect(occurrencesBetween(object, vilnius("2026-11-14", "2026-11-15"))).toHaveLength(0);
    expect(occurrencesBetween(object, vilnius("2026-11-10", "2026-11-11"))).toHaveLength(0);
  });

  test("a zoned event shows on the user's day, not the event's", () => {
    // 23:00 in Berlin is 00:00 next day in Vilnius.
    const object = load("google-event-unknown-tz.ics");
    expect(starts(occurrencesBetween(object, vilnius("2026-10-31", "2026-11-01")))).toEqual([
      "2026-10-31T00:00:00",
    ]);
    expect(
      occurrencesBetween(object, {
        from: "2026-10-30",
        to: "2026-10-31",
        timeZone: "Europe/Berlin",
      }),
    ).toHaveLength(1);
  });

  test("a floating event shows at the same wall clock in every zone", () => {
    const object = load("floating-event.ics");
    for (const timeZone of ["Europe/Vilnius", "America/New_York", "Asia/Tokyo"]) {
      expect(
        starts(
          occurrencesBetween(object, { from: "2026-10-31", to: "2026-11-01", timeZone }),
          timeZone,
        ),
      ).toEqual(["2026-10-31T09:00:00"]);
    }
  });

  test("a task spans DTSTART–DUE (D16)", () => {
    const [occurrence] = occurrencesBetween(
      load("nextcloud-task-subtask.ics"),
      vilnius("2026-11-04", "2026-11-05"),
    );
    expect(occurrence).toMatchObject({
      start: { local: "2026-11-02T09:00:00" },
      end: { local: "2026-11-06T18:00:00" },
    });
  });

  test("a task with neither DTSTART nor DUE has no occurrence; it lives in the task panel", () => {
    expect(
      occurrencesBetween(load("tasksorg-task-completed.ics"), vilnius("2026-01-01", "2027-01-01")),
    ).toEqual([]);
  });

  test("a zero-length event at midnight belongs to the day it starts", () => {
    const object = CalendarObject.parse(
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:z\r\nDTSTART:20261101T000000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
    );
    expect(occurrencesBetween(object, vilnius("2026-11-01", "2026-11-02"))).toHaveLength(1);
    expect(occurrencesBetween(object, vilnius("2026-10-31", "2026-11-01"))).toHaveLength(0);
  });
});

test("a series in a zone the object does not define keeps that zone in every occurrence", () => {
  const object = CalendarObject.parse(
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:g\r\nDTSTART;TZID=Europe/Berlin:20261020T090000\r\nDTEND;TZID=Europe/Berlin:20261020T100000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  );
  const occurrences = occurrencesBetween(object, vilnius("2026-10-01", "2026-11-30"));
  // Berlin leaves summer time on 25 Oct too: 09:00 is 07:00Z, then 08:00Z.
  expect(occurrences.map((o) => o.start)).toMatchObject([
    { type: "zoned", timeZone: "Europe/Berlin", epochMs: Date.parse("2026-10-20T07:00:00Z") },
    { type: "zoned", timeZone: "Europe/Berlin", epochMs: Date.parse("2026-10-27T08:00:00Z") },
    { type: "zoned", timeZone: "Europe/Berlin", epochMs: Date.parse("2026-11-03T08:00:00Z") },
  ]);
  expect(occurrences[2]?.end).toMatchObject({ type: "zoned", local: "2026-11-03T10:00:00" });
});

test("an exception whose master the server does not hold still shows (D34)", () => {
  const object = CalendarObject.parse(
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:orphan\r\nRECURRENCE-ID:20261102T090000Z\r\nDTSTART:20261102T100000Z\r\nDTEND:20261102T110000Z\r\nSUMMARY:Invited occurrence\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  );
  expect(object.master).toBeNull();
  expect(
    occurrencesBetween(object, vilnius("2026-11-02", "2026-11-03")).map((o) => o.item.summary),
  ).toEqual(["Invited occurrence"]);
});

test("a series too dense to reach the range is refused, not cut short", () => {
  const object = CalendarObject.parse(
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:m\r\nDTSTART:20200101T000000Z\r\nRRULE:FREQ=MINUTELY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  );
  expect(() => occurrencesBetween(object, vilnius("2026-11-01", "2026-11-02"))).toThrow(
    ExpansionLimitError,
  );
});

test("a dense series close to the range still expands", () => {
  const object = CalendarObject.parse(
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:h\r\nDTSTART:20250101T000000Z\r\nRRULE:FREQ=HOURLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  );
  expect(occurrencesBetween(object, vilnius("2026-11-01", "2026-11-02"))).toHaveLength(24);
});
