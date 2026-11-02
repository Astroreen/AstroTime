// Which occurrence lands after a save (design D193): its item and its start
// on the form's own wall clock, whatever zone the views are shown in.
import { CalendarObject, occurrencesBetween } from "@astrotime/core";
import { describe, expect, test } from "vite-plus/test";

import { expand } from "../src/calendar/query.ts";
import { lands } from "../src/components/items.tsx";

const ics = (start: string) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:call",
    "DTSTAMP:20261101T000000Z",
    "SUMMARY:Call New York",
    `DTSTART;TZID=America/New_York:${start}`,
    "RRULE:FREQ=DAILY;COUNT=3",
    "DURATION:PT1H",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");

describe("the occurrence that lands (design D193)", () => {
  const object = CalendarObject.parse(ics("20261104T090000"));
  const range = { from: "2026-11-04", to: "2026-11-08", timeZone: "Europe/Vilnius" };
  const entries = expand(object, { id: "call", calendarId: "c" }, range);

  test("read on the form's zone: 9:00 in New York is 16:00 in Vilnius, and still lands", () => {
    expect(occurrencesBetween(object, range)).toHaveLength(3);
    const landed = { uid: "call", at: "2026-11-04T09:00", zone: "America/New_York" };
    expect(entries.map((entry) => lands(entry, landed, "Europe/Vilnius"))).toEqual([
      true,
      false,
      false,
    ]);
    // Read on the view's zone it would land none.
    expect(entries.some((entry) => lands(entry, { ...landed, zone: null }, "Europe/Vilnius"))).toBe(
      false,
    );
  });

  test("another item's UID lands nothing", () => {
    const landed = { uid: "other", at: "2026-11-04T09:00", zone: "America/New_York" };
    expect(entries.some((entry) => lands(entry, landed, "Europe/Vilnius"))).toBe(false);
  });
});
