import ICAL from "ical.js";
import { describe, expect, test } from "vite-plus/test";

import { CalendarObject, createItem, zonedTime, type Event } from "../src/index.ts";
import { vtimezone } from "../src/vtimezone.ts";

const NOW = Date.parse("2026-11-04T08:40:00Z");

/** Instants through two years, every 5 days and 7 hours, as a VTIMEZONE and `Intl` place them. */
function compare(timeZone: string, year: number) {
  const component = vtimezone(timeZone, year);
  const zone = new ICAL.Timezone({ component, tzid: timeZone });
  const misses: string[] = [];
  for (
    let at = Date.UTC(year, 0, 1);
    at < Date.UTC(year + 2, 0, 1);
    at += 5 * 86_400_000 + 7 * 3_600_000
  ) {
    const time = ICAL.Time.fromJSDate(new Date(at), true).convertToZone(zone);
    const local = new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .format(at)
      .replace(" ", "T");
    if (time.toString() !== local) misses.push(`${new Date(at).toISOString()}: ${time} ≠ ${local}`);
  }
  return { component, misses };
}

describe("a VTIMEZONE made from Intl (RFC 5545 §3.6.5)", () => {
  test.each([
    "Europe/Vilnius",
    "America/New_York",
    "Australia/Sydney",
    "Australia/Lord_Howe",
    "Pacific/Chatham",
    "America/Santiago",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Africa/Casablanca",
  ])("%s places every instant as Intl does", (timeZone) => {
    const { misses } = compare(timeZone, 2026);
    expect(misses).toEqual([]);
  });

  test("a zone with DST gets a yearly rule per observance, starting the year before", () => {
    expect(vtimezone("Europe/Vilnius", 2026).toString()).toBe(
      [
        "BEGIN:VTIMEZONE",
        "TZID:Europe/Vilnius",
        "BEGIN:DAYLIGHT",
        "TZOFFSETFROM:+0200",
        "TZOFFSETTO:+0300",
        "DTSTART:20250330T030000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:+0300",
        "TZOFFSETTO:+0200",
        "DTSTART:20251026T040000",
        "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
        "END:STANDARD",
        "END:VTIMEZONE",
      ].join("\r\n"),
    );
    expect(vtimezone("Asia/Tokyo", 2026).toString()).toContain(
      "BEGIN:STANDARD\r\nTZOFFSETFROM:+0900\r\nTZOFFSETTO:+0900\r\nDTSTART:19700101T000000\r\nEND:STANDARD",
    );
  });

  test("an item written in it reads back at the instant it was made for", () => {
    const start = zonedTime("2026-07-01T09:00:00", "America/New_York");
    const ics = createItem(
      "event",
      { summary: "x", time: { start, end: zonedTime("2026-07-01T10:00:00", "America/New_York") } },
      { now: NOW, uid: "x" },
    );
    expect((CalendarObject.parse(ics).master as Event).start).toEqual(start);
  });
});
