// A search result's time (design D97): a task by its due.
import { CalendarObject, occurrencesBetween } from "@astrotime/core";
import { describe, expect, test } from "vite-plus/test";

import { Formats } from "../src/calendar/format.ts";
import { resultWhen } from "../src/components/search.tsx";

const timeZone = "Europe/Vilnius";
const formats = new Formats({ locale: "en-US", hour12: true, weekStart: 7, language: "en" });

function result(lines: string) {
  const object = CalendarObject.parse(
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VTODO\r\nUID:t\r\nDTSTAMP:20261101T000000Z\r\n${lines}SUMMARY:Report\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`,
  );
  const [occurrence] = occurrencesBetween(object, {
    from: "2026-11-01",
    to: "2026-12-01",
    timeZone,
  });
  return { stored: null as never, item: object.master!, occurrence: occurrence! };
}

describe("when a search result is", () => {
  test("a task reads as the calendar shows it: at its start, however far its due (design D159)", () => {
    const task = result(
      "DTSTART;TZID=Europe/Vilnius:20261103T090000\r\nDUE;TZID=Europe/Vilnius:20261105T120000\r\n",
    );
    const when = resultWhen(task, { noDate: "No date", formats, timeZone, today: "2026-11-01" });
    expect(when).toBe(`${formats.day("2026-11-03", "2026-11-01")}, 9:00 AM`);
  });

  test("a task with only a due reads as its due; one on a day as that day", () => {
    const at = (props: string) =>
      resultWhen(result(props), { noDate: "No date", formats, timeZone, today: "2026-11-01" });
    expect(at("DUE;TZID=Europe/Vilnius:20261105T120000\r\n")).toBe(
      `${formats.day("2026-11-05", "2026-11-01")}, 12:00 PM`,
    );
    expect(at("DUE;VALUE=DATE:20261105\r\n")).toBe(formats.day("2026-11-05", "2026-11-01"));
    expect(at("DTSTART;VALUE=DATE:20261103\r\nDUE;VALUE=DATE:20261105\r\n")).toBe(
      formats.day("2026-11-03", "2026-11-01"),
    );
  });
});
