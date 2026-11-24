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
