// `calendar-query`'s time range (RFC 4791 §9.9) as `inRange` reads it.
import { describe, expect, test } from "vite-plus/test";

import { inRange } from "../src/query.ts";

const at = (iso: string) => Date.parse(iso);
const range = (start: string, end: string) => ({ start: at(start), end: at(end) });
const wrap = (component: string, lines: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:${component}\r\nUID:x\r\nDTSTAMP:20261101T080000Z\r\n${lines}END:${component}\r\nEND:VCALENDAR\r\n`;

describe("events", () => {
  test("an all-day event covers its day in UTC, and not the next", () => {
    const allDay = wrap("VEVENT", "DTSTART;VALUE=DATE:20261102\r\nDTEND;VALUE=DATE:20261103\r\n");
    expect(inRange(allDay, range("2026-11-02T23:00:00Z", "2026-11-03T00:00:00Z"))).toBe(true);
    expect(inRange(allDay, range("2026-11-03T00:00:00Z", "2026-11-04T00:00:00Z"))).toBe(false);
  });

  test("a floating time is read in UTC", () => {
    const floating = wrap("VEVENT", "DTSTART:20261102T090000\r\nDTEND:20261102T100000\r\n");
    expect(inRange(floating, range("2026-11-02T09:30:00Z", "2026-11-02T09:45:00Z"))).toBe(true);
    expect(inRange(floating, range("2026-11-02T10:00:00Z", "2026-11-02T11:00:00Z"))).toBe(false);
  });

  test("a zoned series keeps its wall clock across the end of summer time", () => {
    // 09:00 in Vilnius: 06:00Z in summer, 07:00Z from October 25.
    const weekly = wrap(
      "VEVENT",
      "DTSTART;TZID=Europe/Vilnius:20261019T090000\r\nDTEND;TZID=Europe/Vilnius:20261019T100000\r\nRRULE:FREQ=WEEKLY;COUNT=3\r\n",
    );
    expect(inRange(weekly, range("2026-10-19T06:00:00Z", "2026-10-19T06:30:00Z"))).toBe(true);
    expect(inRange(weekly, range("2026-10-26T06:00:00Z", "2026-10-26T06:30:00Z"))).toBe(false);
    expect(inRange(weekly, range("2026-10-26T07:00:00Z", "2026-10-26T07:30:00Z"))).toBe(true);
  });

  test("an event with no length is in the range its start is in", () => {
    const instant = wrap("VEVENT", "DTSTART:20261102T090000Z\r\n");
    expect(inRange(instant, range("2026-11-02T09:00:00Z", "2026-11-02T09:01:00Z"))).toBe(true);
    expect(inRange(instant, range("2026-11-02T08:00:00Z", "2026-11-02T09:00:00Z"))).toBe(false);
  });
});

describe("tasks (RFC 4791 §9.9's VTODO table)", () => {
  const day = range("2026-11-02T00:00:00Z", "2026-11-03T00:00:00Z");

  test("by DUE alone", () => {
    expect(inRange(wrap("VTODO", "DUE:20261102T120000Z\r\n"), day)).toBe(true);
    expect(inRange(wrap("VTODO", "DUE:20261105T120000Z\r\n"), day)).toBe(false);
  });

  test("by COMPLETED and CREATED when it has neither DTSTART nor DUE", () => {
    expect(inRange(wrap("VTODO", "COMPLETED:20261102T120000Z\r\n"), day)).toBe(true);
    expect(inRange(wrap("VTODO", "COMPLETED:20261101T120000Z\r\n"), day)).toBe(false);
    expect(inRange(wrap("VTODO", "CREATED:20261101T120000Z\r\n"), day)).toBe(true);
    expect(inRange(wrap("VTODO", "CREATED:20261104T120000Z\r\n"), day)).toBe(false);
    expect(
      inRange(wrap("VTODO", "CREATED:20261020T120000Z\r\nCOMPLETED:20261025T120000Z\r\n"), day),
    ).toBe(false);
    expect(
      inRange(wrap("VTODO", "CREATED:20261020T120000Z\r\nCOMPLETED:20261102T120000Z\r\n"), day),
    ).toBe(true);
  });

  test("in any range with none of them", () => {
    expect(inRange(wrap("VTODO", "SUMMARY:someday\r\n"), day)).toBe(true);
  });
});
