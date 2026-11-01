import { describe, expect, test } from "vite-plus/test";

import type ICAL from "ical.js";

import { CalendarObject } from "../src/index.ts";
import { fromIcalTime, wallClockIn, zonedToEpoch, zoneOrigin } from "../src/time.ts";
import { WINDOWS_ZONES } from "../src/windows-zones.ts";

describe("zoned wall clocks (RFC 5545 §3.3.5)", () => {
  test("an ordinary time", () => {
    expect(zonedToEpoch("2026-07-01T12:00:00", "Europe/Vilnius")).toBe(
      Date.parse("2026-07-01T09:00:00Z"),
    );
    expect(wallClockIn(Date.parse("2026-07-01T09:00:00Z"), "Europe/Vilnius")).toBe(
      "2026-07-01T12:00:00",
    );
  });

  test("a time in the spring gap uses the offset before the gap", () => {
    // Vilnius jumps from 03:00 to 04:00 on 29 Mar 2026; 03:30 does not exist.
    expect(zonedToEpoch("2026-03-29T03:30:00", "Europe/Vilnius")).toBe(
      Date.parse("2026-03-29T01:30:00Z"),
    );
  });

  test("a time repeated in autumn takes the earlier instant", () => {
    // Vilnius goes from 04:00 back to 03:00 on 25 Oct 2026; 03:30 happens twice.
    expect(zonedToEpoch("2026-10-25T03:30:00", "Europe/Vilnius")).toBe(
      Date.parse("2026-10-25T00:30:00Z"),
    );
  });
});

describe("Windows zone names (D32)", () => {
  test("the table names IANA's current zones, not CLDR's old spellings", () => {
    expect(WINDOWS_ZONES["India Standard Time"]).toBe("Asia/Kolkata");
    expect(WINDOWS_ZONES["FLE Standard Time"]).toBe("Europe/Kyiv");
  });

  test("every zone in the generated table names an IANA zone the runtime knows", () => {
    for (const [windows, iana] of Object.entries(WINDOWS_ZONES)) {
      expect(() => wallClockIn(0, iana), `${windows} → ${iana}`).not.toThrow();
    }
  });
});

describe("where a time's zone comes from (D32, D141)", () => {
  const VILNIUS = [
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Vilnius",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0300",
    "TZOFFSETTO:+0200",
    "DTSTART:19701025T040000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0300",
    "DTSTART:19700329T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ];
  /** The DTSTART of an event written `line`, with the zones given. */
  const start = (line: string, zones: string[] = []) => {
    const object = CalendarObject.parse(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        ...zones,
        "BEGIN:VEVENT",
        "UID:z",
        "DTSTAMP:20261101T000000Z",
        line,
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
    return object.components.master!.getFirstPropertyValue("dtstart") as ICAL.Time;
  };

  test.each([
    ["DTSTART;VALUE=DATE:20261102", [], { kind: "date" }, "date"],
    ["DTSTART:20261102T090000Z", [], { kind: "utc" }, "zoned"],
    [
      "DTSTART;TZID=Europe/Vilnius:20261102T090000",
      VILNIUS,
      { kind: "defined", timeZone: "Europe/Vilnius" },
      "zoned",
    ],
    [
      "DTSTART;TZID=Europe/Vilnius:20261102T090000",
      [],
      { kind: "undefined", timeZone: "Europe/Vilnius" },
      "zoned",
    ],
    [
      "DTSTART;TZID=W. Europe Standard Time:20261102T090000",
      [],
      { kind: "undefined", timeZone: "Europe/Berlin" },
      "zoned",
    ],
    ["DTSTART:20261102T090000", [], { kind: "floating" }, "floating"],
    ["DTSTART;TZID=Nowhere/Atlantis:20261102T090000", [], { kind: "floating" }, "floating"],
  ])("%s %#", (line, zones, origin, type) => {
    const time = start(line, zones);
    expect(zoneOrigin(time)).toEqual(origin);
    expect(fromIcalTime(time).type).toBe(type);
  });
});
