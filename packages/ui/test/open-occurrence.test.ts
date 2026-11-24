// What a tap from outside the page opens of a series (docs/plans/android.md#D317):
// the occurrence the views draw on its day, found by its time whatever way
// the server wrote its recurrence id; none once the series has it no more.
import { CalendarObject, type ItemTime } from "@astrotime/core";
import { expect, test } from "vite-plus/test";

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
      ...master.split("\n").filter(Boolean),
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

test("the two 3:30s of the night the clocks go back are told apart by their instant", () => {
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
  // October 25th's 3:30 is the summer one, 00:30Z; the winter one an hour
  // later reads 3:30 on the wall clock too, and is not this occurrence.
  const at = (iso: string): ItemTime => ({
    type: "zoned",
    local: "2026-10-25T03:30:00",
    timeZone,
    epochMs: Date.parse(iso),
  });
  expect(occurrenceOn(nightly, at("2026-10-25T00:30:00Z"), "2026-10-25", timeZone)).not.toBeNull();
  expect(occurrenceOn(nightly, at("2026-10-25T01:30:00Z"), "2026-10-25", timeZone)).toBeNull();
});
