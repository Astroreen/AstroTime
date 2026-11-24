// What a tap from outside the page opens of a series (docs/plans/android.md#D317):
// the occurrence the views draw on its day, found by its time whatever way
// the server wrote its recurrence id; none once the series has it no more.
import { CalendarObject, occurrencesBetween, type ItemTime } from "@astrotime/core";
import { expect, test } from "vite-plus/test";

import { addDays } from "../src/calendar/dates.ts";
import { occurrenceOn } from "../src/calendar/editing.ts";

const timeZone = "Europe/Vilnius";

/** A daily stand-up at 9:00 in Vilnius from November 1, with these components after the master. */
function series(master: string, ...exceptions: string[]): CalendarObject {
  return CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:standup",
      "DTSTAMP:20261101T000000Z",
      "DTSTART;TZID=Europe/Vilnius:20261101T090000",
      "DTEND;TZID=Europe/Vilnius:20261101T093000",
      "RRULE:FREQ=DAILY",
      "SUMMARY:Stand-up",
      ...master.split("\n").filter((line) => line !== ""),
      "END:VEVENT",
      ...exceptions.flatMap((lines) => [
        "BEGIN:VEVENT",
        "UID:standup",
        "DTSTAMP:20261101T000000Z",
        ...lines.split("\n"),
        "END:VEVENT",
      ]),
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
}

/** The fifth's occurrence as the widget's snapshot keeps it: zoned in Vilnius. */
const fifth: ItemTime = {
  type: "zoned",
  local: "2026-11-05T09:00:00",
  timeZone,
  epochMs: Date.parse("2026-11-05T07:00:00Z"),
};

test("an occurrence of the series opens as the views draw it", () => {
  const occurrence = occurrenceOn(series(""), fifth, "2026-11-05", timeZone);
  expect(occurrence?.item.summary).toBe("Stand-up");
  expect(occurrence?.recurrenceId).toMatchObject({ local: "2026-11-05T09:00:00" });
});

test("an exception the server wrote in UTC is the same occurrence, its own item", () => {
  const moved = series(
    "",
    "RECURRENCE-ID:20261105T070000Z\nDTSTART;TZID=Europe/Vilnius:20261105T100000\nDTEND;TZID=Europe/Vilnius:20261105T103000\nSUMMARY:Stand-up, later",
  );
  expect(occurrenceOn(moved, fifth, "2026-11-05", timeZone)?.item.summary).toBe("Stand-up, later");
});

test("one the server cancelled, by an id in UTC too, or took out with an EXDATE, is gone", () => {
  const cancelled = series(
    "",
    "RECURRENCE-ID:20261105T070000Z\nDTSTART:20261105T070000Z\nDTEND:20261105T073000Z\nSTATUS:CANCELLED",
  );
  expect(occurrenceOn(cancelled, fifth, "2026-11-05", timeZone)).toBeNull();
  const excluded = series("EXDATE;TZID=Europe/Vilnius:20261105T090000");
  expect(occurrenceOn(excluded, fifth, "2026-11-05", timeZone)).toBeNull();
});

test("a series cancelled as a whole still opens: the views draw it", () => {
  const cancelled = series("STATUS:CANCELLED");
  expect(occurrenceOn(cancelled, fifth, "2026-11-05", timeZone)?.item.status).toBe("CANCELLED");
});

test("a task due at midnight is found on the day it is due, where the reminder opens", () => {
  const task = CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VTODO",
      "UID:late",
      "DTSTAMP:20261101T000000Z",
      "DTSTART;TZID=Europe/Vilnius:20261104T220000",
      "DUE;TZID=Europe/Vilnius:20261105T000000",
      "RRULE:FREQ=DAILY",
      "SUMMARY:Lock up",
      "END:VTODO",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
  const fourth: ItemTime = {
    type: "zoned",
    local: "2026-11-04T22:00:00",
    timeZone,
    epochMs: Date.parse("2026-11-04T20:00:00Z"),
  };
  expect(occurrenceOn(task, fourth, "2026-11-05", timeZone)?.item.summary).toBe("Lock up");
});

test("an exception another client wrote with a date id is the same occurrence", () => {
  const moved = series(
    "",
    "RECURRENCE-ID;VALUE=DATE:20261105\nDTSTART;TZID=Europe/Vilnius:20261105T110000\nDTEND;TZID=Europe/Vilnius:20261105T113000\nSUMMARY:Stand-up at 11",
  );
  expect(occurrenceOn(moved, fifth, "2026-11-05", timeZone)?.item.summary).toBe("Stand-up at 11");
});

test("on the night the clocks go back, an occurrence is found by its instant", () => {
  const nightly = CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:nightly",
      "DTSTAMP:20261001T000000Z",
      "DTSTART;TZID=Europe/Vilnius:20261024T033000",
      "DURATION:PT10M",
      "RRULE:FREQ=DAILY;COUNT=3",
      "SUMMARY:Backup",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
  // October 25th's 3:30 is the summer one, 00:30Z, here as a server wrote it in UTC.
  const utc: ItemTime = {
    type: "zoned",
    local: "2026-10-25T00:30:00",
    timeZone: "UTC",
    epochMs: Date.parse("2026-10-25T00:30:00Z"),
  };
  expect(occurrenceOn(nightly, utc, "2026-10-25", timeZone)?.recurrenceId).toMatchObject({
    local: "2026-10-25T03:30:00",
  });
  // The winter 3:30, an hour later, reads 3:30 too, and is no occurrence of it.
  const winter = {
    ...utc,
    local: "2026-10-25T01:30:00",
    epochMs: Date.parse("2026-10-25T01:30:00Z"),
  };
  expect(occurrenceOn(nightly, winter, "2026-10-25", timeZone)).toBeNull();
});

/** A daily call at 22:00 in New York, from November 4, with these exceptions. */
function newYork(...exceptions: string[]): CalendarObject {
  return CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:call",
      "DTSTAMP:20261101T000000Z",
      "DTSTART;TZID=America/New_York:20261104T220000",
      "DURATION:PT30M",
      "RRULE:FREQ=DAILY",
      "SUMMARY:Call",
      "END:VEVENT",
      ...exceptions.flatMap((lines) => [
        "BEGIN:VEVENT",
        "UID:call",
        "DTSTAMP:20261101T000000Z",
        ...lines.split("\n"),
        "END:VEVENT",
      ]),
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
}

test("a date id names its day on the series' own wall clock, not the viewer's", () => {
  // November 5th's call at 22:00 in New York is 05:00 on the 6th in Vilnius;
  // another client moved it with a date id for the 5th, and another for the 6th.
  const call = newYork(
    "RECURRENCE-ID;VALUE=DATE:20261105\nDTSTART;TZID=America/New_York:20261105T110000\nDURATION:PT30M\nSUMMARY:Moved call",
    "RECURRENCE-ID;VALUE=DATE:20261106\nDTSTART;TZID=America/New_York:20261106T110000\nDURATION:PT30M\nSUMMARY:Next call",
  );
  const shown: ItemTime = {
    type: "zoned",
    local: "2026-11-05T22:00:00",
    timeZone: "America/New_York",
    epochMs: Date.parse("2026-11-06T03:00:00Z"),
  };
  expect(occurrenceOn(call, shown, "2026-11-06", timeZone)?.item.summary).toBe("Moved call");
});

test("every occurrence the views draw opens itself, by the id they drew it with", () => {
  // Days in Vilnius around a New York series, one of them moved by a client
  // that named it by its day (on the 6th in Vilnius, beside the 5th's evening one).
  const call = newYork(
    "RECURRENCE-ID;VALUE=DATE:20261106\nDTSTART;TZID=America/New_York:20261106T090000\nDURATION:PT30M\nSUMMARY:Morning call",
  );
  for (const day of ["2026-11-05", "2026-11-06"]) {
    const drawn = occurrencesBetween(call, { from: day, to: addDays(day, 1), timeZone });
    expect(drawn.length).toBeGreaterThan(0);
    for (const occurrence of drawn)
      expect(occurrenceOn(call, occurrence.recurrenceId!, day, timeZone)).toEqual(occurrence);
  }
});

/**
 * A series kept in UTC, 00:30Z and 01:30Z by RDATE: both read 3:30 in Vilnius
 * on its fall-back night. (A series in Vilnius' own zone has no two 3:30s:
 * the expansion keeps one.)
 */
function twoThreeThirties(...extra: string[]): CalendarObject {
  return CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:twice",
      "DTSTAMP:20261001T000000Z",
      "DTSTART:20261025T003000Z",
      "DURATION:PT10M",
      "RDATE:20261025T013000Z",
      "SUMMARY:Check",
      ...extra,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
}

const utc = (iso: string): ItemTime => ({
  type: "zoned",
  local: iso.slice(0, 19),
  timeZone: "UTC",
  epochMs: Date.parse(iso),
});

test("in a series kept in UTC, an EXDATE'd occurrence does not open the next one", () => {
  const object = twoThreeThirties("EXDATE:20261025T003000Z");
  expect(occurrenceOn(object, utc("2026-10-25T00:30:00Z"), "2026-10-25", timeZone)).toBeNull();
  expect(occurrenceOn(object, utc("2026-10-25T01:30:00Z"), "2026-10-25", timeZone)).not.toBeNull();
});

test("on a spring-forward night, the id itself tells 3:30 from 4:30 at one instant", () => {
  const hourly = CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:hourly",
      "DTSTAMP:20260301T000000Z",
      "DTSTART;TZID=Europe/Vilnius:20260329T013000",
      "DURATION:PT10M",
      "RRULE:FREQ=HOURLY;COUNT=5",
      "SUMMARY:Check",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
  const ids = occurrencesBetween(hourly, { from: "2026-03-29", to: "2026-03-30", timeZone })
    .map((occurrence) => occurrence.recurrenceId!)
    .filter((id) => id.type === "zoned");
  const later = ids.find((id) => id.local === "2026-03-29T04:30:00")!;
  expect(occurrenceOn(hourly, later, "2026-03-29", timeZone)?.recurrenceId).toEqual(later);
});

test("on a spring-forward night, a stale 3:30 does not open the 4:30 at its instant", () => {
  // 3:30 does not exist on March 29th in Vilnius; the expansion keeps it at
  // 4:30's instant. With 4:30 moved away, an old 3:30 is not taken for it.
  const hourly = CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:hourly",
      "DTSTAMP:20260301T000000Z",
      "DTSTART;TZID=Europe/Vilnius:20260329T013000",
      "DURATION:PT10M",
      "RRULE:FREQ=HOURLY;COUNT=5",
      "SUMMARY:Check",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:hourly",
      "DTSTAMP:20260301T000000Z",
      "RECURRENCE-ID;TZID=Europe/Vilnius:20260329T043000",
      "DTSTART;TZID=Europe/Vilnius:20260329T063000",
      "DURATION:PT10M",
      "SUMMARY:Check, moved",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
  const stale: ItemTime = {
    type: "zoned",
    local: "2026-03-29T03:30:00",
    timeZone,
    epochMs: Date.parse("2026-03-29T01:30:00Z"),
  };
  // The exception takes 3:30 away with 4:30 (core matches it by instant):
  // the day alone, and never the moved one, by the series' zone or by UTC.
  expect(occurrenceOn(hourly, stale, "2026-03-29", timeZone)).toBeNull();
  const moved = CalendarObject.parse(
    hourly
      .serialize()
      .replace(
        "RECURRENCE-ID;TZID=Europe/Vilnius:20260329T043000",
        "RECURRENCE-ID:20260329T013000Z",
      ),
  );
  expect(occurrenceOn(moved, stale, "2026-03-29", timeZone)).toBeNull();
});

test("two ids of one kind are never matched by the series' rule", () => {
  // An all-day series with two exceptions on one date, at 9:00 and 11:00
  // (floating ids); the first cancelled: its stale id opens the day alone.
  const daily = CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:allday",
      "DTSTAMP:20261101T000000Z",
      "DTSTART;VALUE=DATE:20261101",
      "RRULE:FREQ=DAILY",
      "SUMMARY:Day",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:allday",
      "DTSTAMP:20261101T000000Z",
      "RECURRENCE-ID:20261105T110000",
      "DTSTART:20261105T110000",
      "DURATION:PT1H",
      "SUMMARY:Later",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:allday",
      "DTSTAMP:20261101T000000Z",
      "RECURRENCE-ID:20261105T090000",
      "DTSTART:20261105T090000",
      "DURATION:PT1H",
      "STATUS:CANCELLED",
      "SUMMARY:Morning",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
  const morning: ItemTime = { type: "floating", local: "2026-11-05T09:00:00" };
  expect(occurrenceOn(daily, morning, "2026-11-05", timeZone)).toBeNull();
});

test("a zone of the calendar's own, which Intl knows not, is read by its VTIMEZONE", () => {
  const custom = CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VTIMEZONE",
      "TZID:Customized Time Zone",
      "BEGIN:STANDARD",
      "DTSTART:16010101T000000",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0200",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:custom",
      "DTSTAMP:20261101T000000Z",
      "DTSTART;TZID=Customized Time Zone:20261101T090000",
      "DURATION:PT30M",
      "RRULE:FREQ=DAILY",
      "SUMMARY:Sync",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:custom",
      "DTSTAMP:20261101T000000Z",
      "RECURRENCE-ID:20261105T070000Z",
      "DTSTART;TZID=Customized Time Zone:20261105T100000",
      "DURATION:PT30M",
      "SUMMARY:Sync, moved",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
  const shown: ItemTime = {
    type: "zoned",
    local: "2026-11-05T09:00:00",
    timeZone: "Customized Time Zone",
    epochMs: Date.parse("2026-11-05T07:00:00Z"),
  };
  expect(occurrenceOn(custom, shown, "2026-11-05", timeZone)?.item.summary).toBe("Sync, moved");
});

test("an id naming a zone nobody knows (a crafted widget address) throws nothing", () => {
  // A zone neither Intl nor the calendar knows is taken to read its clock:
  // at the stand-up's instant, it is the stand-up.
  const crafted: ItemTime = { ...fifth, timeZone: "Not/A_Zone" };
  expect(occurrenceOn(series(""), crafted, "2026-11-05", timeZone)?.item.summary).toBe("Stand-up");
});

/** Outlook's own zone, +02:00 in winter and +03:00 in summer, and a daily 9:00 from January. */
function outlook(...exceptions: string[]): CalendarObject {
  return CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VTIMEZONE",
      "TZID:Customized Time Zone",
      "BEGIN:STANDARD",
      "DTSTART:16011028T040000",
      "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
      "TZOFFSETFROM:+0300",
      "TZOFFSETTO:+0200",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:16010325T030000",
      "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0300",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:outlook",
      "DTSTAMP:20260101T000000Z",
      "DTSTART;TZID=Customized Time Zone:20260101T090000",
      "DURATION:PT30M",
      "RRULE:FREQ=DAILY",
      "SUMMARY:Sync",
      "END:VEVENT",
      ...exceptions.flatMap((lines) => [
        "BEGIN:VEVENT",
        "UID:outlook",
        "DTSTAMP:20260101T000000Z",
        ...lines.split("\n"),
        "END:VEVENT",
      ]),
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
}

test("a summer occurrence of a zone of the calendar's own, moved by a UTC id, opens", () => {
  const moved = outlook(
    "RECURRENCE-ID:20260705T060000Z\nDTSTART;TZID=Customized Time Zone:20260705T100000\nDURATION:PT30M\nSUMMARY:Sync, moved",
  );
  const shown: ItemTime = {
    type: "zoned",
    local: "2026-07-05T09:00:00",
    timeZone: "Customized Time Zone",
    epochMs: Date.parse("2026-07-05T06:00:00Z"),
  };
  expect(occurrenceOn(moved, shown, "2026-07-05", timeZone)?.item.summary).toBe("Sync, moved");
});

test("a spring-forward 3:30 is not another zone's exception at its instant", () => {
  // A series kept in UTC with an exception at 03:30 Vilnius (no clock shows
  // it) and one at 04:30 Riga, both 01:30Z: the first cancelled, its stale
  // id opens the day alone.
  const utcSeries = CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:imported",
      "DTSTAMP:20260301T000000Z",
      "DTSTART:20260327T013000Z",
      "DURATION:PT10M",
      "RRULE:FREQ=DAILY;COUNT=5",
      "SUMMARY:Check",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:imported",
      "DTSTAMP:20260301T000000Z",
      "RECURRENCE-ID;TZID=Europe/Riga:20260329T043000",
      "DTSTART;TZID=Europe/Riga:20260329T050000",
      "DURATION:PT10M",
      "SUMMARY:Riga",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
  const stale: ItemTime = {
    type: "zoned",
    local: "2026-03-29T03:30:00",
    timeZone,
    epochMs: Date.parse("2026-03-29T01:30:00Z"),
  };
  expect(occurrenceOn(utcSeries, stale, "2026-03-29", timeZone)).toBeNull();
});
