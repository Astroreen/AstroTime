import ICAL from "ical.js";
import { describe, expect, test } from "vite-plus/test";

import { CalendarObject } from "../src/index.ts";
import {
  jcalText,
  NotCalendarError,
  splitCalendar,
  splitCalendars,
  type SplitCalendar,
} from "../src/split.ts";
import { fixture } from "./support.ts";

const exports = [
  "radicale-export.ics",
  "nextcloud-export.ics",
  "google-export.ics",
  "thunderbird-export.ics",
  "apple-export.ics",
  "outlook-export.ics",
];

/** A component's jCal, which equal means nothing in it was lost or changed (D7). */
const jcalOf = (component: ICAL.Component) => JSON.stringify(component.toJSON());

/** The file's components (time zones aside), by their jCal. */
function componentsOf(ics: string): string[] {
  const root = new ICAL.Component(ICAL.parse(ics));
  return root
    .getAllSubcomponents()
    .filter((component) => component.name !== "vtimezone")
    .map(jcalOf);
}

const lines = (...content: string[]) => `${content.join("\r\n")}\r\n`;

const event = (uid: string, extra: string[] = []) => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  "DTSTAMP:20261101T080000Z",
  "DTSTART:20261105T090000Z",
  "SUMMARY:Meeting",
  ...extra,
  "END:VEVENT",
];

const calendar = (...components: string[][]) =>
  lines(
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Test//EN",
    ...components.flat(),
    "END:VCALENDAR",
  );

describe("an exported calendar split into objects (import D267)", () => {
  test.each(exports)("%s: every component kept as written, in an object of its UID", (name) => {
    const source = fixture(`exports/${name}`);
    const split = splitCalendar(source);
    expect(split.problems).toEqual([]);
    // Every component of the file is in exactly one object, unchanged.
    expect(split.objects.flatMap((object) => componentsOf(object.ics)).toSorted()).toEqual(
      componentsOf(source).toSorted(),
    );
    for (const object of split.objects) {
      const parsed = CalendarObject.parse(object.ics);
      expect(parsed.uid).toBe(object.uid);
      expect(object.kind).toBe(parsed.kind === "event" ? "VEVENT" : "VTODO");
      // A calendar object resource has no METHOD (RFC 4791 §4.1).
      expect(object.ics).not.toMatch(/^METHOD:/m);
    }
    expect(new Set(split.objects.map((object) => object.uid)).size).toBe(split.objects.length);
  });

  test.each(exports)("%s: the same file gives the same text, byte for byte", (name) => {
    const source = fixture(`exports/${name}`);
    expect(splitCalendar(source)).toEqual(splitCalendar(source));
  });

  test("a series and its exception, apart in the file, are one object", () => {
    const { objects } = splitCalendar(fixture("exports/google-export.ics"));
    expect(objects.map((object) => object.uid)).toEqual([
      "1r6a2kq0m9v8s7t6u5p4o3n2l1@google.com",
      "5h4g3f2e1d0c9b8a7z6y5x4w3v@google.com",
      "9q8w7e6r5t4y3u2i1o0p9a8s7d@google.com",
    ]);
    const series = CalendarObject.parse(objects[0]!.ics);
    expect(series.master?.summary).toBe("Weekly review");
    expect(series.exceptions.map((exception) => exception.description)).toEqual([
      "Moved to the afternoon.",
    ]);
  });

  test("each object takes the time zones it uses, and only those", () => {
    const { objects } = splitCalendar(fixture("exports/google-export.ics"));
    const zones = (ics: string) =>
      new ICAL.Component(ICAL.parse(ics))
        .getAllSubcomponents("vtimezone")
        .map((zone) => zone.getFirstPropertyValue("tzid"));
    expect(objects.map((object) => zones(object.ics))).toEqual([
      ["Europe/Vilnius"],
      [],
      ["America/New_York"],
    ]);
  });

  test("the calendar's own properties go with each object, but METHOD", () => {
    const { objects } = splitCalendar(fixture("exports/outlook-export.ics"));
    const header = (ics: string) =>
      new ICAL.Component(ICAL.parse(ics)).getAllProperties().map((property) => property.name);
    expect(header(objects[0]!.ics)).toEqual([
      "prodid",
      "version",
      "x-calstart",
      "x-calend",
      "x-clipstart",
      "x-clipend",
      "x-wr-relcalid",
      "x-wr-calname",
      "x-primary-calendar",
      "x-owner",
      "x-ms-olk-wkhrstart",
      "x-ms-olk-wkhrend",
      "x-ms-olk-wkhrdays",
    ]);
  });

  test("its name, colour and refresh", () => {
    const of = (name: string) => {
      const { name: calendar, color, refresh } = splitCalendar(fixture(`exports/${name}`));
      return { calendar, color, refresh };
    };
    expect(of("nextcloud-export.ics")).toEqual({
      calendar: "Personal",
      color: "#0082c9",
      refresh: 4 * 3600_000,
    });
    expect(of("apple-export.ics")).toEqual({ calendar: "Home", color: "#1badf8", refresh: null });
    expect(of("radicale-export.ics")).toEqual({
      calendar: "Import test",
      color: null,
      refresh: null,
    });
    expect(of("thunderbird-export.ics")).toEqual({ calendar: null, color: null, refresh: null });
    // RFC 7986's NAME and COLOR before the older X- names; a CSS3 colour name.
    const rfc7986 = splitCalendar(
      lines(
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "NAME:Holidays",
        "X-WR-CALNAME:Old name",
        "COLOR:mediumseagreen",
        "X-APPLE-CALENDAR-COLOR:#FF0000",
        "X-PUBLISHED-TTL:P1D",
        "END:VCALENDAR",
      ),
    );
    expect([rfc7986.name, rfc7986.color, rfc7986.refresh]).toEqual([
      "Holidays",
      "#3cb371",
      86_400_000,
    ]);
  });
});

describe("what is not one calendar (subscriptions, providers D251)", () => {
  test.each([
    ["an HTML page", "<!DOCTYPE html>\n<html><body>Sign in</body></html>\n"],
    ["an empty text", ""],
    ["blank lines", "\r\n\r\n"],
    ["a file cut short", calendar(event("a")).replace(/END:VCALENDAR\r\n$/, "")],
    ["a file cut inside a component", lines("BEGIN:VCALENDAR", ...event("a").slice(0, 3))],
    ["two calendars", calendar(event("a")) + calendar(event("b"))],
    ["a lone event", lines(...event("a"))],
  ])("%s throws NotCalendarError", (_name, text) => {
    expect(() => splitCalendar(text)).toThrow(NotCalendarError);
  });

  test("a calendar with no component is a calendar with no object", () => {
    expect(splitCalendar(lines("BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR"))).toEqual({
      name: null,
      color: null,
      refresh: null,
      objects: [],
      problems: [],
    } satisfies SplitCalendar);
  });

  test("a byte order mark and LF line ends are a calendar still", () => {
    const text = `﻿${calendar(event("a")).replaceAll("\r\n", "\n")}`;
    expect(splitCalendar(text).objects.map((object) => object.uid)).toEqual(["a"]);
  });
});

describe("components that cannot be objects", () => {
  test("each is named with its place and UID; the others are kept", () => {
    const split = splitCalendar(
      calendar(
        event("good"),
        ["BEGIN:VEVENT", "DTSTART:20261105T090000Z", "SUMMARY:No UID", "END:VEVENT"],
        ["BEGIN:VTODO", "UID:mixed", "SUMMARY:A task", "END:VTODO"],
        event("mixed"),
        event("twice"),
        event("twice"),
        event("broken", ["RRULE:FREQ=SOMETIMES"]),
        ["BEGIN:VJOURNAL", "UID:journal", "SUMMARY:A note", "END:VJOURNAL"],
      ),
    );
    expect(split.objects.map(({ uid, kind }) => [uid, kind])).toEqual([
      ["good", "VEVENT"],
      // Kept as written, for a caller to keep or leave (VJOURNAL).
      ["journal", "VJOURNAL"],
    ]);
    expect(split.problems).toEqual([
      { index: 1, uid: null, component: "VEVENT", reason: "no-uid" },
      { index: 2, uid: "mixed", component: "VTODO", reason: "mixed-kinds" },
      { index: 4, uid: "twice", component: "VEVENT", reason: "several-masters" },
      { index: 6, uid: "broken", component: "VEVENT", reason: "invalid" },
    ]);
  });
});

describe("a file from the device, forgiven what exporters get wrong (import D267)", () => {
  const uids = (calendars: readonly SplitCalendar[]) =>
    calendars.map((one) => one.objects.map((object) => object.uid));
  let next = 0;
  const newUid = () => `new-${++next}`;

  test("CR line ends, blank lines and a byte order mark", () => {
    const text = `﻿${calendar(event("a"), event("b")).replaceAll("\r\n", "\r\n\r\n").replaceAll("\r\n", "\r")}`;
    expect(uids(splitCalendars(text, { newUid }))).toEqual([["a", "b"]]);
  });

  test("a line broken without folding joins the line before as a line break", () => {
    const text = calendar(event("a", ["DESCRIPTION:First line", "second line"]));
    const [split] = splitCalendars(text, { newUid });
    expect(CalendarObject.parse(split!.objects[0]!.ics).master?.description).toBe(
      "First line\nsecond line",
    );
  });

  test("several calendars, one after another", () => {
    const text = calendar(event("a")) + calendar(event("b"), event("c"));
    expect(uids(splitCalendars(text, { newUid }))).toEqual([["a"], ["b", "c"]]);
  });

  test("a component with no UID gets one", () => {
    next = 0;
    const text = calendar(["BEGIN:VEVENT", "DTSTART:20261105T090000Z", "SUMMARY:x", "END:VEVENT"]);
    const [split] = splitCalendars(text, { newUid });
    expect(split!.problems).toEqual([]);
    expect(split!.objects.map((object) => object.uid)).toEqual(["new-1"]);
    expect(CalendarObject.parse(split!.objects[0]!.ics).uid).toBe("new-1");
  });

  test("a missing VTIMEZONE leaves the TZID as written", () => {
    const text = calendar(event("a", ["DTEND;TZID=Europe/Vilnius:20261105T120000"]));
    const [split] = splitCalendars(text, { newUid });
    expect(split!.objects[0]!.ics).toContain("DTEND;TZID=Europe/Vilnius:20261105T120000");
  });

  test("what is still not iCalendar throws", () => {
    expect(() => splitCalendars("<html></html>", { newUid })).toThrow(NotCalendarError);
    expect(() => splitCalendars("", { newUid })).toThrow(NotCalendarError);
  });

  test("a file cut short keeps what came whole; the component cut is a problem", () => {
    const text = lines("BEGIN:VCALENDAR", ...event("a"), ...event("b").slice(0, 3));
    const [split] = splitCalendars(text, { newUid });
    expect(split!.objects.map((object) => object.uid)).toEqual(["a"]);
    expect(split!.problems).toEqual([
      { index: 1, uid: "b", component: "VEVENT", reason: "invalid" },
    ]);
  });

  test("a big file: ten thousand events", () => {
    const many = Array.from({ length: 10_000 }, (_, i) => event(`e${i}`));
    const [split] = splitCalendars(calendar(...many), { newUid });
    expect(split!.objects).toHaveLength(10_000);
    expect(split!.objects.at(-1)!.uid).toBe("e9999");
  });
});

describe("jCal (RFC 7265)", () => {
  test("is read as the iCalendar it spells", () => {
    const source = fixture("exports/google-export.ics");
    const json: unknown = JSON.parse(JSON.stringify(ICAL.parse(source)));
    expect(splitCalendars(jcalText(json), { newUid: () => "x" })).toEqual([splitCalendar(source)]);
  });

  test("other JSON throws NotCalendarError", () => {
    expect(() => jcalText({ items: [] })).toThrow(NotCalendarError);
    expect(() => jcalText(["vevent", [], []])).toThrow(NotCalendarError);
    expect(() => jcalText([])).toThrow(NotCalendarError);
  });
});
