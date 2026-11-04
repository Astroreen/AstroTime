import ICAL from "ical.js";
import { describe, expect, test } from "vite-plus/test";

import { CalendarObject } from "../src/index.ts";
import {
  jcalText,
  NotCalendarError,
  splitCalendar,
  splitCalendars,
  overlay,
  type SplitCalendar,
  withUid,
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
      const { name: named, color, refresh } = splitCalendar(fixture(`exports/${name}`));
      return { calendar: named, color, refresh };
    };
    expect(of("nextcloud-export.ics")).toEqual({
      calendar: "Import test",
      color: "#0b8043",
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

describe("components that cannot be objects, and those kept all the same (D272)", () => {
  test("each is named with its place and UID; nothing that can be kept is lost", () => {
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
        event("good", ["DESCRIPTION:Another master"]),
      ),
    );
    // In the file's order; what had to leave its UID under one made from
    // it, the same on every run; VJOURNAL kept as written, for a caller to keep or leave.
    expect(split.objects.map(({ uid, kind }) => [uid, kind])).toEqual([
      ["good", "VEVENT"],
      ["mixed", "VTODO"],
      ["mixed-2", "VEVENT"],
      ["twice", "VEVENT"],
      ["journal", "VJOURNAL"],
      ["good-2", "VEVENT"],
    ]);
    expect(CalendarObject.parse(split.objects[5]!.ics).master?.description).toBe("Another master");
    expect(split.problems).toEqual([
      { index: 1, uid: null, component: "VEVENT", reason: "no-uid", kept: false },
      { index: 3, uid: "mixed", component: "VEVENT", reason: "mixed-kinds", kept: true },
      { index: 5, uid: "twice", component: "VEVENT", reason: "duplicate", kept: true },
      { index: 6, uid: "broken", component: "VEVENT", reason: "invalid", kept: false },
      { index: 8, uid: "good", component: "VEVENT", reason: "several-masters", kept: true },
    ]);
  });

  test("an exception that cannot be read costs itself, not its series and the other exceptions", () => {
    const split = splitCalendar(
      calendar(
        event("s", ["RRULE:FREQ=DAILY;COUNT=3"]),
        event("s", ["RECURRENCE-ID:20261106T090000Z", "DESCRIPTION:Moved"]),
        event("s", ["RECURRENCE-ID:not a time", "DESCRIPTION:Broken"]),
      ),
    );
    const series = CalendarObject.parse(split.objects[0]!.ics);
    expect(series.master?.recurring).toBe(true);
    expect(series.exceptions.map((exception) => exception.description)).toEqual(["Moved"]);
    expect(split.problems).toEqual([
      { index: 2, uid: "s", component: "VEVENT", reason: "invalid", kept: false },
    ]);
  });

  test("after a text value, a line that reads as a property iCalendar does not name is kept, and said", () => {
    const [split] = splitCalendars(
      calendar(event("a", ["DESCRIPTION:Join the call", "Meeting-ID:123", "PIN 1234"])),
      { newUid: () => "x" },
    );
    const object = new ICAL.Component(ICAL.parse(split!.objects[0]!.ics)).getFirstSubcomponent(
      "vevent",
    )!;
    expect(object.getFirstPropertyValue("meeting-id")).toBe("123");
    // The broken line after it still goes on the text value.
    expect(object.getFirstPropertyValue("description")).toBe("Join the call\nPIN 1234");
    expect(split!.problems.map((problem) => problem.reason)).toEqual([
      "joined-line",
      "ambiguous-line",
    ]);
  });

  test("a series' exceptions stay with its first master; a second master leaves under a new UID", () => {
    let n = 0;
    const [split] = splitCalendars(
      calendar(
        event("s", ["RRULE:FREQ=DAILY;COUNT=3"]),
        event("s", ["RECURRENCE-ID:20261106T090000Z", "SUMMARY:Moved"]),
        event("s", ["SUMMARY:Other"]),
      ),
      { newUid: () => `fresh-${++n}` },
    );
    expect(split!.objects.map((object) => object.uid)).toEqual(["s", "fresh-1"]);
    expect(CalendarObject.parse(split!.objects[0]!.ics).exceptions).toHaveLength(1);
  });

  test("a component given again after its UID had to be left is kept once; a new UID is none of the file's", () => {
    const split = splitCalendar(
      calendar(
        event("u"),
        event("u", ["DESCRIPTION:Second"]),
        // The same as the one that left its UID: given twice.
        event("u", ["DESCRIPTION:Second"]),
        // A third master: under the next UID free, past the file's own u-2.
        event("u", ["DESCRIPTION:Third"]),
        event("u-2"),
        event("u-3"),
      ),
    );
    expect(split.objects.map((object) => object.uid)).toEqual(["u", "u-4", "u-5", "u-2", "u-3"]);
    const description = (uid: string) =>
      CalendarObject.parse(split.objects.find((object) => object.uid === uid)!.ics).master
        ?.description;
    expect([description("u-4"), description("u-5")]).toEqual(["Second", "Third"]);
    expect(split.problems.map(({ index, reason }) => [index, reason])).toEqual([
      [1, "several-masters"],
      [2, "duplicate"],
      [3, "several-masters"],
    ]);
  });

  test("an exception of another kind goes with the object of its kind that left the UID", () => {
    const split = splitCalendar(
      calendar(
        ["BEGIN:VTODO", "UID:m", "SUMMARY:A task", "END:VTODO"],
        event("m", ["RRULE:FREQ=DAILY;COUNT=3"]),
        event("m", ["RECURRENCE-ID:20261106T090000Z", "SUMMARY:Moved"]),
      ),
    );
    expect(split.objects.map(({ uid, kind }) => [uid, kind])).toEqual([
      ["m", "VTODO"],
      ["m-2", "VEVENT"],
    ]);
    expect(CalendarObject.parse(split.objects[1]!.ics).exceptions).toHaveLength(1);
  });

  test("a component whose END never came ends where the next begins; the rest of the file is read", () => {
    const text = calendar(event("a"), event("cut").slice(0, -1), event("b"), [
      "BEGIN:VTODO",
      "UID:t",
      "SUMMARY:x",
    ]);
    for (const split of [splitCalendar(text), splitCalendars(text, { newUid: () => "x" })[0]!]) {
      // What it said reads whole: kept, and said.
      expect(split.objects.map((object) => object.uid)).toEqual(["a", "cut", "b", "t"]);
      expect(split.problems).toEqual([
        { index: 1, uid: "cut", component: "VEVENT", reason: "unterminated", kept: true },
        { index: 3, uid: "t", component: "VTODO", reason: "unterminated", kept: true },
      ]);
    }
    // One that does not read whole, the END of what was in it lost: not kept.
    const broken = splitCalendar(
      calendar(["BEGIN:VEVENT", "UID:v", "BEGIN:VALARM", "ACTION:DISPLAY"], event("c")),
    );
    expect(broken.objects.map((object) => object.uid)).toEqual(["c"]);
    expect(broken.problems).toEqual([
      { index: 0, uid: "v", component: "VEVENT", reason: "unterminated", kept: false },
    ]);
    // And the next calendar after it, in a file of several.
    const two = lines(
      "BEGIN:VCALENDAR",
      ...event("a").slice(0, -1),
      "END:VCALENDAR",
      "BEGIN:VCALENDAR",
      ...event("b"),
      "END:VCALENDAR",
    );
    expect(
      splitCalendars(two, { newUid: () => "x" }).map((one) => one.objects.map((o) => o.uid)),
    ).toEqual([["a"], ["b"]]);
  });

  test("a VTIMEZONE that cannot be read is named; the objects naming it are kept and read the TZID", () => {
    const zone = [
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Vilnius",
      "BEGIN:STANDARD",
      "DTSTART:19701025T040000",
      "RRULE:FREQ=SOMETIMES",
      "TZOFFSETFROM:+0300",
      "TZOFFSETTO:+0200",
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
    const split = splitCalendar(
      calendar(zone, [
        "BEGIN:VEVENT",
        "UID:z",
        "DTSTAMP:20261101T080000Z",
        "DTSTART;TZID=Europe/Vilnius:20261105T090000",
        "END:VEVENT",
      ]),
    );
    expect(split.problems).toEqual([
      {
        index: 0,
        uid: "Europe/Vilnius",
        component: "VTIMEZONE",
        reason: "invalid-zone",
        kept: false,
      },
    ]);
    const start = CalendarObject.parse(split.objects[0]!.ics).master!.start;
    expect(start).toMatchObject({ type: "zoned", timeZone: "Europe/Vilnius" });
  });

  test("a TZID defined twice, differently: the objects take the first, the second is named", () => {
    const zone = (offset: string) => [
      "BEGIN:VTIMEZONE",
      "TZID:Office",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      `TZOFFSETFROM:${offset}`,
      `TZOFFSETTO:${offset}`,
      "END:STANDARD",
      "END:VTIMEZONE",
    ];
    const at = (uid: string) => event(uid, ["DTEND;TZID=Office:20261105T120000"]);
    const split = splitCalendar(
      calendar(
        zone("+0200"),
        at("a"),
        [
          "BEGIN:VTIMEZONE",
          "BEGIN:STANDARD",
          "TZOFFSETTO:+0200",
          "TZOFFSETFROM:+0200",
          "DTSTART:19700101T000000",
          "END:STANDARD",
          "TZID:Office",
          "END:VTIMEZONE",
        ],
        zone("+0500"),
        at("b"),
      ),
    );
    // The same definition again, its lines in another order, is no problem; a different one is.
    expect(split.problems).toEqual([
      { index: 3, uid: "Office", component: "VTIMEZONE", reason: "conflicting-zone", kept: false },
    ]);
    for (const object of split.objects) {
      expect(object.ics).toContain("TZOFFSETTO:+0200");
      expect(object.ics).not.toContain("+0500");
    }
  });

  test("an END with no BEGIN is named as one, and the calendar's properties are kept", () => {
    const split = splitCalendar(
      lines(
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "X-WR-CALNAME:Kept",
        "END:VEVENT",
        ...event("a"),
        "END:VCALENDAR",
      ),
    );
    expect(split.name).toBe("Kept");
    expect(split.objects.map((object) => object.uid)).toEqual(["a"]);
    expect(split.problems).toEqual([
      { index: -1, uid: null, component: "VCALENDAR", reason: "stray-end", kept: true },
    ]);
  });

  test("a calendar property that cannot be read is named; the others go with each object", () => {
    const split = splitCalendar(
      lines(
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "X-WR-CALNAME:Kept",
        "REFRESH-INTERVAL;VALUE=DURATION:soon",
        ...event("a"),
        "END:VCALENDAR",
      ),
    );
    expect(split.name).toBe("Kept");
    expect(split.problems).toEqual([
      {
        index: -1,
        uid: "REFRESH-INTERVAL",
        component: "VCALENDAR",
        reason: "invalid-property",
        kept: false,
      },
    ]);
    expect(split.objects[0]!.ics).toContain("X-WR-CALNAME:Kept");
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

  test("a line broken without folding joins the text value before it as a line break", () => {
    const text = calendar(
      event("a", ["DESCRIPTION:Call the office", "Dial in: 555 0100", "PIN 1234"]),
    );
    const [split] = splitCalendars(text, { newUid });
    expect(CalendarObject.parse(split!.objects[0]!.ics).master?.description).toBe(
      "Call the office\nDial in: 555 0100\nPIN 1234",
    );
    expect(split!.problems).toEqual([
      { index: 0, uid: "a", component: "VEVENT", reason: "joined-line", kept: true },
    ]);
  });

  test("any line that starts as a content line is a property, known to AstroTime or not (D7)", () => {
    const after = [
      "DESCRIPTION:Notes",
      "LINK;LINKREL=latest-version:https://example.com/v2",
      "CONCEPT:https://example.com/concepts/meeting",
      "REFID:project-x",
      "ESTIMATED-DURATION:PT1H",
      "description:written in lower case",
      "X-FOO;X-BAR=1:baz",
      "Dial-in:555 0100",
    ];
    const [split] = splitCalendars(calendar(event("a", after)), { newUid });
    // After a text value, a name iCalendar does not have may be its line: kept, and said.
    expect(split!.problems).toEqual([
      { index: 0, uid: "a", component: "VEVENT", reason: "ambiguous-line", kept: true },
    ]);
    const names = new ICAL.Component(ICAL.parse(split!.objects[0]!.ics))
      .getFirstSubcomponent("vevent")!
      .getAllProperties()
      .map((property) => property.name);
    for (const name of ["link", "concept", "refid", "estimated-duration", "x-foo", "dial-in"])
      expect(names, name).toContain(name);
    expect(names.filter((name) => name === "description")).toHaveLength(2);
  });

  test("a stray line anywhere else is left out and named; nothing else changes", () => {
    const text = calendar(
      [
        "BEGIN:VEVENT",
        "UID:a",
        "DTSTAMP:20261101T080000Z",
        "DTSTART:20261105T090000Z",
        "stray",
        "END:VEVENT",
      ],
      [...event("b"), "after the end"],
      event("c"),
    );
    const [split] = splitCalendars(text, { newUid });
    expect(split!.objects.map((object) => object.uid)).toEqual(["a", "b", "c"]);
    expect(CalendarObject.parse(split!.objects[0]!.ics).master?.start).toMatchObject({
      type: "zoned",
      epochMs: Date.UTC(2026, 10, 5, 9),
    });
    expect(split!.problems).toEqual([
      { index: -1, uid: null, component: "VCALENDAR", reason: "dropped-line", kept: true },
      { index: 0, uid: "a", component: "VEVENT", reason: "dropped-line", kept: true },
    ]);
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
      { index: 1, uid: "b", component: "VEVENT", reason: "unterminated", kept: false },
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

describe("an object under another UID (import D270)", () => {
  test("every component, a series' exceptions too, and nothing else changed", () => {
    const [series] = splitCalendar(fixture("exports/google-export.ics")).objects;
    const copy = CalendarObject.parse(withUid(series!.ics, "copy"));
    expect(copy.uid).toBe("copy");
    expect(copy.exceptions.map((exception) => exception.uid)).toEqual(["copy"]);
    const original = CalendarObject.parse(series!.ics);
    expect({ ...copy.master, uid: "x" }).toEqual({ ...original.master, uid: "x" });
  });
});

describe("the file's object over the one stored (import D270, Update them)", () => {
  const vevents = (ics: string) =>
    new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents("vevent");

  test("the file says what the item is: its end, its rule, its exceptions", () => {
    const stored = calendar(
      event("s", [
        "DTEND:20261105T100000Z",
        "RRULE:FREQ=DAILY;COUNT=5",
        "EXDATE:20261106T090000Z",
        "LOCATION:Old room",
      ]),
      event("s", ["RECURRENCE-ID:20261107T090000Z", "DESCRIPTION:stored only"]),
    );
    // DURATION for DTEND, no rule, so no exceptions: a single event.
    const incoming = calendar(event("s", ["DURATION:PT2H"]));
    const merged = overlay(stored, incoming);
    const [master, ...rest] = vevents(merged);
    expect(rest).toEqual([]);
    expect(master!.hasProperty("dtend")).toBe(false);
    expect(master!.getFirstPropertyValue("duration")?.toString()).toBe("PT2H");
    for (const gone of ["rrule", "exdate", "location"])
      expect(master!.hasProperty(gone)).toBe(false);
    CalendarObject.parse(merged);
  });

  test("SEQUENCE goes past both versions' where an occurrence changed, and only there", () => {
    const seq = (stored: string[], file: string[]) =>
      vevents(
        overlay(calendar(event("s", stored)), calendar(event("s", file))),
      )[0]!.getFirstPropertyValue("sequence");
    // Changed: past both.
    expect(seq(["SEQUENCE:3"], ["SEQUENCE:1", "LOCATION:Moved"])).toBe(4);
    expect(seq(["SEQUENCE:1"], ["SEQUENCE:5", "LOCATION:Moved"])).toBe(6);
    expect(seq([], ["LOCATION:Moved"])).toBe(1);
    // The same but for what the stored copy keeps (its X- properties): the stored one's.
    expect(seq(["SEQUENCE:3", "X-MINE:1"], ["SEQUENCE:1"])).toBe(3);
    expect(seq(["X-MINE:1"], [])).toBeNull();
  });

  test("an exception the file gives as it was keeps its SEQUENCE while its series moves on", () => {
    const exception = ["RECURRENCE-ID:20261106T090000Z", "SEQUENCE:2", "DESCRIPTION:Moved"];
    const merged = vevents(
      overlay(
        calendar(event("s", ["RRULE:FREQ=DAILY;COUNT=3", "SEQUENCE:2"]), event("s", exception)),
        calendar(event("s", ["RRULE:FREQ=DAILY;COUNT=4", "SEQUENCE:2"]), event("s", exception)),
      ),
    );
    expect(merged.map((one) => one.getFirstPropertyValue("sequence"))).toEqual([3, 2]);
  });

  test("its EXDATEs are the file's", () => {
    const merged = overlay(
      calendar(event("s", ["RRULE:FREQ=DAILY;COUNT=5", "EXDATE:20261106T090000Z"])),
      calendar(event("s", ["RRULE:FREQ=DAILY;COUNT=5", "EXDATE:20261107T090000Z"])),
    );
    expect(merged).toContain("EXDATE:20261107T090000Z");
    expect(merged).not.toContain("EXDATE:20261106T090000Z");
  });

  test("what another app cannot know stays: X- properties, alarms and attachments the file has none of", () => {
    const alarm = [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER:-PT10M",
      "DESCRIPTION:Soon",
      "END:VALARM",
    ];
    const stored = calendar([
      ...event("s", ["X-MINE:1", "X-BOTH:stored", "ATTACH:https://e.com/a"]).slice(0, -1),
      ...alarm,
      "END:VEVENT",
    ]);
    const kept = vevents(overlay(stored, calendar(event("s", ["X-BOTH:file"]))))[0]!;
    expect(kept.getFirstPropertyValue("x-mine")).toBe("1");
    expect(kept.getFirstPropertyValue("x-both")).toBe("file");
    expect(kept.getFirstPropertyValue("attach")).toBe("https://e.com/a");
    expect(kept.getAllSubcomponents("valarm")).toHaveLength(1);
    // The file has its own: the stored ones go.
    const own = vevents(
      overlay(
        stored,
        calendar([
          ...event("s", ["ATTACH:https://e.com/b"]).slice(0, -1),
          "BEGIN:VALARM",
          "ACTION:DISPLAY",
          "TRIGGER:-PT1H",
          "DESCRIPTION:Hour",
          "END:VALARM",
          "END:VEVENT",
        ]),
      ),
    )[0]!;
    expect(own.getAllProperties("attach").map((p) => p.getFirstValue())).toEqual([
      "https://e.com/b",
    ]);
    expect(
      own.getAllSubcomponents("valarm").map((a) => a.getFirstPropertyValue("description")),
    ).toEqual(["Hour"]);
  });
});
