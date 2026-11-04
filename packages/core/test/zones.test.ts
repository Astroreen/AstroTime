// An item whose ends are in two zones, or whose times are in another zone
// than its series' (docs/plans/foundation.md#D31, D32).
import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  editItem,
  repeatOf,
  zonedTime,
  occurrencesBetween,
  timesOf,
  wallClockOf,
  type Range,
} from "../src/index.ts";
import { vtimezone } from "../src/vtimezone.ts";

const ics = (...lines: string[]) => zoned([], ...lines);
/** The object with a VTIMEZONE for each of `zones`. */
const zoned = (zones: readonly string[], ...lines: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    ...zones.map((zone) => vtimezone(zone, 2026).toString().replace(/\r?\n/g, "\r\n")),
    "BEGIN:VEVENT",
    "UID:z",
    "DTSTAMP:20260101T000000Z",
    "SUMMARY:Review",
    ...lines,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
const utc = (from: string, to: string): Range => ({ from, to, timeZone: "UTC" });

describe("ends in two zones the object does not define (Google, Outlook)", () => {
  test("a flight from Berlin to New York lasts as long as it flies", () => {
    const object = CalendarObject.parse(
      ics(
        "DTSTART;TZID=Europe/Berlin:20260115T100000",
        "DTEND;TZID=America/New_York:20260115T080000",
      ),
    );
    const [flight] = occurrencesBetween(object, utc("2026-01-15", "2026-01-16"));
    expect(wallClockOf(flight!.start, "UTC")).toBe("2026-01-15T09:00:00");
    expect(wallClockOf(flight!.end, "UTC")).toBe("2026-01-15T13:00:00");
  });

  test("so does each occurrence of a series, and the one an edit dialog opens", () => {
    const object = CalendarObject.parse(
      ics(
        "DTSTART;TZID=America/New_York:20260115T100000",
        "DTEND;TZID=Europe/Berlin:20260115T230000",
        "RRULE:FREQ=WEEKLY",
      ),
    );
    const [next] = occurrencesBetween(object, utc("2026-01-22", "2026-01-23"));
    expect(wallClockOf(next!.end, "UTC")).toBe("2026-01-22T22:00:00");
    expect(wallClockOf(timesOf(object, next!.recurrenceId).end!, "UTC")).toBe(
      "2026-01-22T22:00:00",
    );
  });
});

describe("ends in two zones the object defines", () => {
  test("an occurrence's own exception keeps its end where it was, in its own zone", () => {
    const object = CalendarObject.parse(
      zoned(
        ["America/New_York", "Europe/Berlin"],
        "DTSTART;TZID=America/New_York:20260115T100000",
        "DTEND;TZID=Europe/Berlin:20260115T230000",
        "RRULE:FREQ=WEEKLY",
      ),
    );
    const range = utc("2026-01-22", "2026-01-23");
    const [next] = occurrencesBetween(object, range);
    expect(wallClockOf(next!.end, "UTC")).toBe("2026-01-22T22:00:00");
    expect(wallClockOf(timesOf(object, next!.recurrenceId).end!, "UTC")).toBe(
      "2026-01-22T22:00:00",
    );
    const { ics: edited } = editItem(
      object,
      { summary: "Moved review" },
      { now: 0, scope: "this", recurrenceId: next!.recurrenceId },
    );
    const [moved] = occurrencesBetween(CalendarObject.parse(edited), range);
    expect([moved!.item.summary, wallClockOf(moved!.end, "UTC")]).toEqual([
      "Moved review",
      "2026-01-22T22:00:00",
    ]);
  });
});

describe("an occurrence named in another zone than its series'", () => {
  test("an RDATE in UTC edited alone is replaced, at its own instant, not doubled", () => {
    const object = CalendarObject.parse(
      zoned(
        ["Europe/Berlin"],
        "DTSTART;TZID=Europe/Berlin:20260115T100000",
        "DTEND;TZID=Europe/Berlin:20260115T110000",
        "RDATE:20260120T090000Z",
      ),
    );
    const range = utc("2026-01-20", "2026-01-21");
    const [extra] = occurrencesBetween(object, range);
    expect(wallClockOf(timesOf(object, extra!.recurrenceId).start!, "UTC")).toBe(
      "2026-01-20T09:00:00",
    );
    const { ics: edited } = editItem(
      object,
      { summary: "Moved review" },
      { now: 0, scope: "this", recurrenceId: extra!.recurrenceId },
    );
    expect(
      occurrencesBetween(CalendarObject.parse(edited), range).map((o) => [
        o.item.summary,
        wallClockOf(o.start, "UTC"),
      ]),
    ).toEqual([["Moved review", "2026-01-20T09:00:00"]]);
  });
});

describe("a zone only the object's VTIMEZONE names (Outlook's Customized Time Zone, D32)", () => {
  const custom = () =>
    CalendarObject.parse(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//test//EN",
        vtimezone("Europe/Berlin", 2026)
          .toString()
          .replace("TZID:Europe/Berlin", "TZID:Customized Time Zone")
          .replace(/\r?\n/g, "\r\n"),
        "BEGIN:VEVENT",
        "UID:custom",
        "DTSTAMP:20260101T000000Z",
        "SUMMARY:Weekly",
        "DTSTART;TZID=Customized Time Zone:20260115T100000",
        "DTEND;TZID=Customized Time Zone:20260115T110000",
        "RRULE:FREQ=WEEKLY;UNTIL=20260301T085959Z",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );

  test("its rule reads, with the day it ends", () => {
    expect(repeatOf(custom())?.repeat.end).toEqual({ type: "until", until: "2026-03-01" });
  });

  test("a series moved by dragging an occurrence moves", () => {
    const object = custom();
    const range = utc("2026-01-22", "2026-01-23");
    const [next] = occurrencesBetween(object, range);
    const time = {
      start: zonedTime("2026-01-22T11:00:00", "Europe/Berlin"),
      end: zonedTime("2026-01-22T12:00:00", "Europe/Berlin"),
    };
    const { ics: edited } = editItem(
      object,
      { time },
      { now: 0, scope: "all", recurrenceId: next!.recurrenceId },
    );
    expect(
      occurrencesBetween(CalendarObject.parse(edited), range).map((o) =>
        wallClockOf(o.start, "UTC"),
      ),
    ).toEqual(["2026-01-22T10:00:00"]);
  });
});

describe("an occurrence in a DST gap", () => {
  test("edited alone, its exception is named by the series' wall clock, and replaces it", () => {
    // 02:30 on 29 March 2026 does not exist in Berlin; the series names it so.
    for (const zones of [[], ["Europe/Berlin"]]) {
      const object = CalendarObject.parse(
        zoned(
          zones,
          "DTSTART;TZID=Europe/Berlin:20260327T023000",
          "DTEND;TZID=Europe/Berlin:20260327T033000",
          "RRULE:FREQ=DAILY;COUNT=4",
        ),
      );
      const range = utc("2026-03-29", "2026-03-30");
      const [gap] = occurrencesBetween(object, range);
      const { ics: edited } = editItem(
        object,
        { summary: "Moved review" },
        { now: 0, scope: "this", recurrenceId: gap!.recurrenceId },
      );
      // Named as the series names it, so a client matching wall clocks finds it too.
      expect(edited).toContain("RECURRENCE-ID;TZID=Europe/Berlin:20260329T023000\r\n");
      expect(
        occurrencesBetween(CalendarObject.parse(edited), range).map((o) => o.item.summary),
      ).toEqual(["Moved review"]);
    }
  });
});
