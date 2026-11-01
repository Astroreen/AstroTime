import { describe, expect, test } from "vite-plus/test";

import {
  boundsOf,
  layoutDay,
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

  test("Nextcloud's web Calendar: weekly six times, the second moved, the third deleted", () => {
    const occurrences = occurrencesBetween(
      load("nextcloud-web-event-recurring.ics"),
      vilnius("2026-11-01", "2027-02-01"),
    );
    expect(starts(occurrences)).toEqual([
      "2026-11-23T09:00:00",
      "2026-11-30T11:00:00",
      "2026-12-14T09:00:00",
      "2026-12-21T09:00:00",
      "2026-12-28T09:00:00",
    ]);
    expect(occurrences.map((o) => o.item.summary)).toEqual([
      "Standup",
      "Standup (moved)",
      "Standup",
      "Standup",
      "Standup",
    ]);
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

  test("an Outlook series without a VTIMEZONE keeps its wall clock across the DST change", () => {
    // Weekly on Thursdays from 15 Oct, 09:00 in W. Europe Standard Time (Berlin);
    // Berlin leaves summer time on 25 Oct: 09:00 is 07:00Z before, 08:00Z after.
    const occurrences = occurrencesBetween(
      load("outlook-event-recurring-no-vtimezone.ics"),
      vilnius("2026-10-01", "2026-12-01"),
    );
    // The same instants seen from Vilnius (an hour ahead of Berlin).
    expect(starts(occurrences)).toEqual([
      "2026-10-15T10:00:00",
      "2026-10-22T10:00:00",
      "2026-10-29T10:00:00",
      "2026-11-05T10:00:00",
    ]);
    expect(occurrences.map((o) => (o.start.type === "zoned" ? o.start.epochMs : 0))).toEqual([
      Date.parse("2026-10-15T07:00:00Z"),
      Date.parse("2026-10-22T07:00:00Z"),
      Date.parse("2026-10-29T08:00:00Z"),
      Date.parse("2026-11-05T08:00:00Z"),
    ]);
    expect(starts(occurrences, "Europe/Berlin")).toEqual([
      "2026-10-15T09:00:00",
      "2026-10-22T09:00:00",
      "2026-10-29T09:00:00",
      "2026-11-05T09:00:00",
    ]);
    expect(occurrences.map((o) => wallClockOf(o.end, "Europe/Berlin").slice(11))).toEqual(
      Array.from({ length: 4 }, () => "09:30:00"),
    );
  });

  test("an Outlook series without a VTIMEZONE matches its EXDATE and RECURRENCE-ID across DST (D32)", () => {
    // Thursdays at 09:00 Berlin from 15 Oct; 22 Oct (summer time) is excluded, and
    // 29 Oct (after the change on 25 Oct) is moved to 11:00. Both name the slot by
    // the Windows TZID, so they must resolve to the same instants as the series.
    const occurrences = occurrencesBetween(
      load("outlook-event-recurring-exceptions-no-vtimezone.ics"),
      vilnius("2026-10-01", "2026-12-01"),
    );
    expect(starts(occurrences, "Europe/Berlin")).toEqual([
      "2026-10-15T09:00:00",
      "2026-10-29T11:00:00",
      "2026-11-05T09:00:00",
    ]);
    expect(occurrences.map((o) => o.item.summary)).toEqual([
      "Weekly sync",
      "Weekly sync (moved)",
      "Weekly sync",
    ]);
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

  test("Nextcloud's web apps: a multi-day event, and tasks with UTC times seen in Vilnius", () => {
    const [conference] = occurrencesBetween(
      load("nextcloud-web-event-multiday.ics"),
      vilnius("2026-11-19", "2026-11-20"),
    );
    expect(conference).toMatchObject({
      start: { type: "date", date: "2026-11-18" },
      end: { type: "date", date: "2026-11-21" },
    });
    const [slides] = occurrencesBetween(
      load("nextcloud-web-task-start-due.ics"),
      vilnius("2026-11-17", "2026-11-18"),
    );
    expect(starts([slides!])).toEqual(["2026-11-16T10:00:00"]);
    expect(wallClockOf(slides!.end, "Europe/Vilnius")).toBe("2026-11-18T11:00:00");
    const [report] = occurrencesBetween(
      load("nextcloud-web-task-due.ics"),
      vilnius("2026-11-20", "2026-11-21"),
    );
    expect(starts([report!])).toEqual(["2026-11-20T10:00:00"]);
  });

  test("a task with neither DTSTART nor DUE has no occurrence; it lives in the tasks screen", () => {
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

describe("exceptions, leniently (D35)", () => {
  const series = (exception: string) =>
    CalendarObject.parse(
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:s\r\nDTSTART:20261102T090000Z\r\nDTEND:20261102T100000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Series\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:s\r\n${exception}END:VEVENT\r\nEND:VCALENDAR\r\n`,
    );
  const summaries = (object: CalendarObject) =>
    occurrencesBetween(object, { from: "2026-11-01", to: "2026-11-06", timeZone: "UTC" }).map(
      (o) => `${wallClockOf(o.start, "UTC")} ${o.item.summary}`,
    );

  test("a cancelled exception removes its occurrence", () => {
    expect(
      summaries(
        series(
          "RECURRENCE-ID:20261103T090000Z\r\nDTSTART:20261103T090000Z\r\nSTATUS:CANCELLED\r\n",
        ),
      ),
    ).toEqual(["2026-11-02T09:00:00 Series", "2026-11-04T09:00:00 Series"]);
  });

  test("a floating RECURRENCE-ID replaces the zoned occurrence at that wall clock", () => {
    expect(
      summaries(
        series("RECURRENCE-ID:20261103T090000\r\nDTSTART:20261103T150000Z\r\nSUMMARY:Moved\r\n"),
      ),
    ).toEqual([
      "2026-11-02T09:00:00 Series",
      "2026-11-03T15:00:00 Moved",
      "2026-11-04T09:00:00 Series",
    ]);
  });

  test("a date RECURRENCE-ID replaces the zoned occurrence on that day", () => {
    expect(
      summaries(
        series(
          "RECURRENCE-ID;VALUE=DATE:20261104\r\nDTSTART:20261104T120000Z\r\nSUMMARY:Moved\r\n",
        ),
      ),
    ).toEqual([
      "2026-11-02T09:00:00 Series",
      "2026-11-03T09:00:00 Series",
      "2026-11-04T12:00:00 Moved",
    ]);
  });
});

test("an occurrence far ahead on its own wall clock still shows for a user far behind", () => {
  // Kiritimati (UTC+14) is 25 hours ahead of Pago Pago (UTC−11): 2 Nov 00:30
  // there is 31 Oct 23:30 here, two days past its own wall clock.
  const object = CalendarObject.parse(
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:k\r\nDTSTART;TZID=Pacific/Kiritimati:20261101T003000\r\nRRULE:FREQ=DAILY;COUNT=2\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  );
  const shown = occurrencesBetween(object, {
    from: "2026-10-31",
    to: "2026-11-01",
    timeZone: "Pacific/Pago_Pago",
  });
  expect(shown.map((o) => wallClockOf(o.start, "Pacific/Pago_Pago"))).toEqual([
    "2026-10-31T23:30:00",
  ]);
});
describe("bounds (for the local store's date index)", () => {
  test("a one-off zoned event spans its own instants", () => {
    expect(boundsOf(load("apple-event-attendees.ics"))).toEqual({
      startMs: Date.parse("2026-11-05T19:00:00Z"),
      endMs: Date.parse("2026-11-05T20:00:00Z"),
    });
  });

  test("a counted series ends at its last occurrence; an exception moved later widens it", () => {
    expect(boundsOf(load("nextcloud-event-recurring.ics"))).toEqual({
      startMs: Date.parse("2026-10-20T07:00:00Z"),
      endMs: Date.parse("2026-11-10T08:30:00Z"),
    });
  });

  test("an all-day span is widened by the furthest zones", () => {
    expect(boundsOf(load("thunderbird-event-allday.ics"))).toEqual({
      startMs: Date.parse("2026-11-10T10:00:00Z"),
      endMs: Date.parse("2026-11-14T14:00:00Z"),
    });
  });

  test("an unending series is open; an undated task has no bounds", () => {
    expect(boundsOf(load("tasksorg-task-recurring.ics")).endMs).toBeNull();
    expect(boundsOf(load("tasksorg-task-completed.ics"))).toEqual({ startMs: null, endMs: null });
  });
});

describe("leftovers from the review of #2", () => {
  const vcal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;

  test("an end before the start is no length, and the series still shows", () => {
    const object = CalendarObject.parse(
      vcal(
        "BEGIN:VEVENT\r\nUID:n\r\nDTSTART:20261102T100000Z\r\nDTEND:20261102T090000Z\r\nRRULE:FREQ=DAILY;COUNT=2\r\nEND:VEVENT\r\n",
      ),
    );
    const shown = occurrencesBetween(object, {
      from: "2026-11-02",
      to: "2026-11-04",
      timeZone: "UTC",
    });
    expect(shown.map((o) => [wallClockOf(o.start, "UTC"), wallClockOf(o.end, "UTC")])).toEqual([
      ["2026-11-02T10:00:00", "2026-11-02T10:00:00"],
      ["2026-11-03T10:00:00", "2026-11-03T10:00:00"],
    ]);
  });

  test("a RECURRENCE-ID in another zone than the series matches by instant", () => {
    // 10:00 Vilnius is 09:00 Berlin on 3 Nov (both winter time).
    const object = CalendarObject.parse(
      vcal(
        "BEGIN:VEVENT\r\nUID:z\r\nDTSTART;TZID=Europe/Vilnius:20261102T100000\r\nRRULE:FREQ=DAILY;COUNT=3\r\nSUMMARY:Series\r\nEND:VEVENT\r\n" +
          "BEGIN:VEVENT\r\nUID:z\r\nRECURRENCE-ID;TZID=Europe/Berlin:20261103T090000\r\nDTSTART;TZID=Europe/Vilnius:20261103T150000\r\nSUMMARY:Moved\r\nEND:VEVENT\r\n",
      ),
    );
    expect(
      occurrencesBetween(object, vilnius("2026-11-01", "2026-11-06")).map((o) => o.item.summary),
    ).toEqual(["Series", "Moved", "Series"]);
  });

  test("enumerated values are read case-insensitively", () => {
    const object = CalendarObject.parse(
      vcal(
        "BEGIN:VEVENT\r\nUID:c\r\nDTSTART:20261102T090000Z\r\nRRULE:FREQ=DAILY;COUNT=2\r\nTRANSP:transparent\r\nEND:VEVENT\r\n" +
          "BEGIN:VEVENT\r\nUID:c\r\nRECURRENCE-ID:20261103T090000Z\r\nDTSTART:20261103T090000Z\r\nSTATUS:cancelled\r\nEND:VEVENT\r\n",
      ),
    );
    expect(object.master).toMatchObject({ transparent: true });
    expect(
      occurrencesBetween(object, { from: "2026-11-01", to: "2026-11-05", timeZone: "UTC" }),
    ).toHaveLength(1);
  });
});

describe("where a task ends (D42)", () => {
  const vcal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
  const utc = (from: string, to: string) => ({ from, to, timeZone: "UTC" });

  test("a due date is the task's last day: the occurrence ends the day after", () => {
    const object = CalendarObject.parse(
      vcal(
        "BEGIN:VTODO\r\nUID:d\r\nDTSTART;VALUE=DATE:20261102\r\nDUE;VALUE=DATE:20261104\r\nEND:VTODO\r\n",
      ),
    );
    const [occurrence] = occurrencesBetween(object, utc("2026-11-01", "2026-11-10"));
    expect([occurrence?.start, occurrence?.end]).toEqual([
      { type: "date", date: "2026-11-02" },
      { type: "date", date: "2026-11-05" },
    ]);
    expect(boundsOf(object).endMs).toBe(Date.parse("2026-11-05T14:00:00Z"));
  });

  test("a task with only a due date covers that day", () => {
    const object = CalendarObject.parse(
      vcal("BEGIN:VTODO\r\nUID:o\r\nDUE;VALUE=DATE:20261104\r\nEND:VTODO\r\n"),
    );
    expect(occurrencesBetween(object, utc("2026-11-04", "2026-11-05"))).toHaveLength(1);
    expect(occurrencesBetween(object, utc("2026-11-05", "2026-11-06"))).toHaveLength(0);
  });

  test("a task with only a start date covers that day; a timed start or due stays a moment", () => {
    const start = CalendarObject.parse(
      vcal("BEGIN:VTODO\r\nUID:s\r\nDTSTART;VALUE=DATE:20261104\r\nEND:VTODO\r\n"),
    );
    expect(occurrencesBetween(start, utc("2026-11-04", "2026-11-05"))[0]?.end).toEqual({
      type: "date",
      date: "2026-11-05",
    });
    const timed = CalendarObject.parse(
      vcal("BEGIN:VTODO\r\nUID:t\r\nDUE:20261104T150000Z\r\nEND:VTODO\r\n"),
    );
    const [moment] = occurrencesBetween(timed, utc("2026-11-04", "2026-11-05"));
    expect(moment?.end).toEqual(moment?.start);
  });

  test("a recurring task with date dues covers each due day", () => {
    const object = CalendarObject.parse(
      vcal(
        "BEGIN:VTODO\r\nUID:r\r\nDTSTART;VALUE=DATE:20261102\r\nDUE;VALUE=DATE:20261102\r\nRRULE:FREQ=WEEKLY;COUNT=2\r\nEND:VTODO\r\n",
      ),
    );
    expect(
      occurrencesBetween(object, utc("2026-11-01", "2026-11-15")).map((o) => [o.start, o.end]),
    ).toEqual([
      [
        { type: "date", date: "2026-11-02" },
        { type: "date", date: "2026-11-03" },
      ],
      [
        { type: "date", date: "2026-11-09" },
        { type: "date", date: "2026-11-10" },
      ],
    ]);
  });

  test("a one-off item ending before it starts is a moment at its start, still shown", () => {
    const object = CalendarObject.parse(
      vcal(
        "BEGIN:VEVENT\r\nUID:b\r\nDTSTART:20261102T100000Z\r\nDTEND:20261102T090000Z\r\nEND:VEVENT\r\n",
      ),
    );
    const [occurrence] = occurrencesBetween(object, utc("2026-11-02", "2026-11-03"));
    expect(occurrence?.end).toEqual(occurrence?.start);
    expect(
      layoutDay([occurrence!], "2026-11-02", { timeZone: "UTC" }).timed.map((p) => [
        p.top,
        p.bottom,
      ]),
    ).toEqual([[600, 615]]);
  });
});
