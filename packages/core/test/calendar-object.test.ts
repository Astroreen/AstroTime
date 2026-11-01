import { readdirSync } from "node:fs";

import ICAL from "ical.js";
import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  CalendarObjectError,
  type Event,
  type Task,
  wallClockOf,
} from "../src/index.ts";
import { fixture, load } from "./support.ts";

/** Unfolded content lines (RFC 5545 §3.1). */
function contentLines(ics: string): string[] {
  return ics
    .replaceAll(/\r\n[ \t]/g, "")
    .split("\r\n")
    .filter(Boolean);
}

/** `NAME;B=2;A="1":value` → `NAME;A=1;B=2:value`: parameters sorted, quotes off. */
function canonicalLine(line: string): string {
  let inQuotes = false;
  let colon = -1;
  const breaks: number[] = [];
  for (let i = 0; i < line.length && colon < 0; i++) {
    const c = line[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && c === ";") breaks.push(i);
    else if (!inQuotes && c === ":") colon = i;
  }
  const head = line.slice(0, colon);
  const name = head.slice(0, breaks[0] ?? head.length).toUpperCase();
  const params = breaks
    .map((at, i) => head.slice(at + 1, breaks[i + 1] ?? head.length).replaceAll('"', ""))
    // VALUE=URI on ATTACH or VALUE=TEXT is the default and may be dropped.
    .filter((param) => !/^VALUE=(URI|TEXT)$/i.test(param) || name.startsWith("X-"))
    .toSorted();
  return [name, ...params].join(";") + line.slice(colon);
}

const fixtures = readdirSync(new URL("fixtures", import.meta.url)).filter((f) =>
  f.endsWith(".ics"),
);

describe("round trip (D7)", () => {
  test.each(fixtures)("%s keeps every component, property and parameter", (name) => {
    const source = fixture(name);
    const written = CalendarObject.parse(source).serialize();
    // jCal is iCalendar's structure without its spelling (quotes, folding, a
    // default VALUE), so equal jCal means nothing was lost or changed.
    expect(ICAL.parse(written)).toEqual(ICAL.parse(source));
    expect(written).toMatch(/\r\n$/);
    expect(written.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(
      true,
    );
  });

  test.each(fixtures.filter((name) => /^X-|;X-/m.test(fixture(name))))(
    "%s: every X- property and parameter survives as text",
    (name) => {
      const source = fixture(name);
      const written = CalendarObject.parse(source).serialize();
      // Compared below ical.js: the content lines themselves, with parameters
      // as a set (their order and quoting carry no meaning, RFC 5545 §3.2).
      const extensions = (ics: string) =>
        contentLines(ics)
          .filter((line) => /^X-|;X-/i.test(line))
          .map(canonicalLine)
          .toSorted();
      const found = extensions(source);
      expect(found.length).toBeGreaterThan(0);
      expect(extensions(written)).toEqual(found);
    },
  );

  test("properties AstroTime does not know survive", () => {
    const written = load("apple-event-attendees.ics").serialize().replaceAll("\r\n ", "");
    expect(written).toContain("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC");
    expect(written).toContain('X-ADDRESS="One Apple Park Way, Cupertino, CA 95014"');
    expect(written).toContain("X-APPLE-DEFAULT-ALARM:TRUE");
    expect(load("nextcloud-event-recurring.ics").serialize()).toContain("X-NC-GROUP-ID:7");
  });
});

describe("events", () => {
  test("a Nextcloud series: master, exception and zoned times", () => {
    const object = load("nextcloud-event-recurring.ics");
    expect(object.kind).toBe("event");
    expect(object.uid).toBe("4f1c7a2e-9b3d-4c61-8e0a-2d7b5f9c1e44");
    const master = object.master as Event;
    expect(master).toMatchObject({
      summary: "Standup",
      location: "Room 4, second floor",
      description: "Daily sync.\nBring blockers.",
      color: "mediumseagreen",
      categories: ["Work", "Team"],
      sequence: 3,
      recurring: true,
      recurrenceId: null,
      start: {
        type: "zoned",
        local: "2026-10-20T10:00:00",
        timeZone: "Europe/Vilnius",
        epochMs: Date.parse("2026-10-20T07:00:00Z"),
      },
      end: { type: "zoned", local: "2026-10-20T10:30:00" },
      alarms: [
        {
          action: "DISPLAY",
          trigger: { type: "relative", relatedTo: "start", offsetSeconds: -600 },
        },
      ],
    });
    expect(object.exceptions).toHaveLength(1);
    expect(object.exceptions[0]).toMatchObject({
      summary: "Standup (moved)",
      recurrenceId: { type: "zoned", local: "2026-10-27T10:00:00" },
      start: { type: "zoned", local: "2026-10-27T12:00:00" },
    });
  });

  test("Apple: organizer, attendees, an absolute-free audio alarm", () => {
    const event = load("apple-event-attendees.ics").master as Event;
    expect(event.organizer).toEqual({
      address: "mailto:ada@example.com",
      name: "Ada Lovelace",
      role: null,
      status: null,
    });
    expect(event.attendees).toEqual([
      {
        address: "mailto:ada@example.com",
        name: "Ada Lovelace",
        role: "CHAIR",
        status: "ACCEPTED",
      },
      {
        address: "mailto:charles@example.com",
        name: "Charles Babbage",
        role: "REQ-PARTICIPANT",
        status: "NEEDS-ACTION",
      },
    ]);
    expect(event.location).toBe("Apple Park\nOne Apple Park Way, Cupertino");
    expect(event.start).toMatchObject({ epochMs: Date.parse("2026-11-05T19:00:00Z") });
    expect(event.alarms[0]).toMatchObject({ action: "AUDIO", trigger: { offsetSeconds: -900 } });
  });

  test("Thunderbird: an all-day span with an exclusive end, and escapes", () => {
    const event = load("thunderbird-event-allday.ics").master as Event;
    expect(event.start).toEqual({ type: "date", date: "2026-11-11" });
    expect(event.end).toEqual({ type: "date", date: "2026-11-14" });
    expect(event.transparent).toBe(true);
    expect(event.description).toBe(
      "A long description that goes on for a while so that the line has to be folded by the client that wrote it, with a comma and a semicolon; and a backslash \\ too.",
    );
  });

  test("a TZID without a VTIMEZONE resolves as an IANA zone; DURATION gives the end", () => {
    const event = load("google-event-unknown-tz.ics").master as Event;
    expect(event.start).toEqual({
      type: "zoned",
      local: "2026-10-30T23:00:00",
      timeZone: "Europe/Berlin",
      epochMs: Date.parse("2026-10-30T22:00:00Z"),
    });
    expect(event.end).toMatchObject({ type: "zoned", local: "2026-10-31T01:00:00" });
  });

  test("Outlook: a VTIMEZONE with a Windows name gives the exact instant and the IANA zone", () => {
    const event = load("outlook-event-windows-tz.ics").master as Event;
    expect(event.start).toEqual({
      type: "zoned",
      local: "2026-11-04T14:00:00",
      timeZone: "Europe/Berlin",
      epochMs: Date.parse("2026-11-04T13:00:00Z"),
    });
  });

  test("with a VTIMEZONE the zone is one Intl knows, so its wall clock reads back", () => {
    const start = (load("outlook-event-windows-tz.ics").master as Event).start;
    if (start?.type !== "zoned") throw new Error("expected a zoned start");
    expect(start.timeZone).toBe("Europe/Berlin");
    expect(wallClockOf(start, start.timeZone)).toBe(start.local);
  });

  // The fixtures below are hand-written in the shape Exchange writes
  // (PRODID, X-MICROSOFT-CDO-*, Windows TZIDs), minus the VTIMEZONE a client may
  // strip or a server may not keep.
  describe("a Windows zone name without a VTIMEZONE", () => {
    test("W. Europe Standard Time is Europe/Berlin, in summer and in winter", () => {
      const summer = load("outlook-event-windows-tz-no-vtimezone.ics").master as Event;
      expect(summer.start).toEqual({
        type: "zoned",
        local: "2026-07-15T10:00:00",
        timeZone: "Europe/Berlin",
        epochMs: Date.parse("2026-07-15T08:00:00Z"),
      });
      expect(summer.end).toMatchObject({ epochMs: Date.parse("2026-07-15T09:30:00Z") });
      const winter = load("outlook-event-windows-tz-winter-no-vtimezone.ics").master as Event;
      expect(winter.start).toMatchObject({
        local: "2026-12-04T10:00:00",
        timeZone: "Europe/Berlin",
        epochMs: Date.parse("2026-12-04T09:00:00Z"),
      });
    });

    test("Russian Standard Time is Europe/Moscow", () => {
      const event = load("outlook-event-russian-tz-no-vtimezone.ics").master as Event;
      expect(event.start).toEqual({
        type: "zoned",
        local: "2026-11-04T14:00:00",
        timeZone: "Europe/Moscow",
        epochMs: Date.parse("2026-11-04T11:00:00Z"),
      });
    });

    test("a quoted TZID parameter and another letter case resolve the same", () => {
      const quoted = load("outlook-event-recurring-no-vtimezone.ics").master as Event;
      expect(quoted.start).toMatchObject({ timeZone: "Europe/Berlin" });
      const shouting = fixture("outlook-event-windows-tz-no-vtimezone.ics").replaceAll(
        "W. Europe Standard Time",
        "w. europe standard time",
      );
      expect(CalendarObject.parse(shouting).master).toMatchObject({
        start: { timeZone: "Europe/Berlin", epochMs: Date.parse("2026-07-15T08:00:00Z") },
      });
    });

    test("a name that is neither IANA nor Windows stays floating", () => {
      const event = load("outlook-event-unknown-windows-tz.ics").master as Event;
      expect(event.start).toEqual({ type: "floating", local: "2026-11-04T14:00:00" });
    });

    test("a local time in the spring gap takes the offset before it, as for IANA names", () => {
      // Berlin skips 02:00–03:00 on 29 Mar 2026; 02:30 is read with +01:00.
      const ics = fixture("outlook-event-windows-tz-no-vtimezone.ics")
        .replace(
          "DTSTART;TZID=W. Europe Standard Time:20260715T100000",
          "DTSTART;TZID=W. Europe Standard Time:20260329T023000",
        )
        .replace(
          "DTEND;TZID=W. Europe Standard Time:20260715T113000",
          "DTEND;TZID=W. Europe Standard Time:20260329T040000",
        );
      expect(CalendarObject.parse(ics).master).toMatchObject({
        start: { timeZone: "Europe/Berlin", epochMs: Date.parse("2026-03-29T01:30:00Z") },
      });
    });

    test("an IANA name wins over a Windows one", () => {
      expect(load("google-event-unknown-tz.ics").master).toMatchObject({
        start: { timeZone: "Europe/Berlin" },
      });
    });

    test.each([
      "outlook-event-windows-tz-no-vtimezone.ics",
      "outlook-event-russian-tz-no-vtimezone.ics",
      "outlook-event-unknown-windows-tz.ics",
    ])("%s is written back with the TZID it was read with", (name) => {
      const tzids = (ics: string) =>
        contentLines(ics).filter((line) => /^DT(START|END);/.test(line));
      const written = load(name).serialize();
      expect(tzids(written)).toEqual(tzids(fixture(name)));
      expect(written).not.toMatch(/Europe\/(Berlin|Moscow)/);
    });
  });

  test("a path-style TZID reads as the IANA zone at its end", () => {
    const source = fixture("nextcloud-event-recurring.ics").replaceAll(
      "Europe/Vilnius",
      "/freeassociation.sourceforge.net/Europe/Vilnius",
    );
    expect(CalendarObject.parse(source).master).toMatchObject({
      start: { timeZone: "Europe/Vilnius", epochMs: Date.parse("2026-10-20T07:00:00Z") },
    });
  });

  test("a floating time stays floating", () => {
    const event = load("floating-event.ics").master as Event;
    expect(event.start).toEqual({ type: "floating", local: "2026-10-31T09:00:00" });
  });
});

describe("tasks (D10)", () => {
  test("Nextcloud Tasks: the full VTODO with its extensions", () => {
    const object = load("nextcloud-task-subtask.ics");
    expect(object.kind).toBe("task");
    expect(object.master as Task).toMatchObject({
      summary: "Write the CalDAV client",
      description: "Discovery, sync-collection, ETags.",
      priority: 1,
      percentComplete: 40,
      status: "IN-PROCESS",
      categories: ["AstroTime"],
      classification: "PRIVATE",
      start: { type: "zoned", local: "2026-11-02T09:00:00" },
      due: {
        type: "zoned",
        local: "2026-11-06T18:00:00",
        epochMs: Date.parse("2026-11-06T16:00:00Z"),
      },
      completed: null,
      parentUid: "9a8b7c6d-5e4f-4321-8765-0fedcba98765",
      sortOrder: 731004,
      hideSubtasks: true,
      alarms: [{ trigger: { type: "relative", relatedTo: "end", offsetSeconds: -3600 } }],
    });
  });

  test("Tasks.org: a date-only recurring task", () => {
    const task = load("tasksorg-task-recurring.ics").master as Task;
    expect(task).toMatchObject({
      due: { type: "date", date: "2026-11-02" },
      priority: 9,
      recurring: true,
      sortOrder: -2147483648,
      hideSubtasks: false,
      parentUid: null,
    });
  });

  test("Tasks.org: a completed task; PRIORITY:0 is no priority", () => {
    const task = load("tasksorg-task-completed.ics").master as Task;
    expect(task).toMatchObject({
      status: "COMPLETED",
      completed: { type: "zoned", timeZone: "UTC", local: "2026-10-29T19:00:00" },
      percentComplete: 100,
      priority: null,
      due: null,
      start: null,
    });
  });
});

// Recorded from Nextcloud's own web apps by scripts/record-nextcloud-fixtures.ts
// (fixtures/README.md), in a browser on Europe/Vilnius.
describe("as Nextcloud's web Calendar and Tasks apps write them", () => {
  test("Calendar: a timed event with a location, a description and a category", () => {
    const event = load("nextcloud-web-event-timed.ics").master as Event;
    expect(event).toMatchObject({
      summary: "Planning",
      location: "Room 4, second floor",
      description: "Agenda:\n- the week ahead\n- blockers",
      categories: ["Work"],
      status: "CONFIRMED",
      sequence: 2,
      recurring: false,
      start: {
        type: "zoned",
        local: "2026-11-16T10:00:00",
        timeZone: "Europe/Vilnius",
        epochMs: Date.parse("2026-11-16T08:00:00Z"),
      },
      end: { type: "zoned", local: "2026-11-16T11:00:00" },
    });
  });

  test("Calendar: all-day events end the day after their last", () => {
    expect(load("nextcloud-web-event-allday.ics").master).toMatchObject({
      start: { type: "date", date: "2026-11-17" },
      end: { type: "date", date: "2026-11-18" },
    });
    expect(load("nextcloud-web-event-multiday.ics").master).toMatchObject({
      start: { type: "date", date: "2026-11-18" },
      end: { type: "date", date: "2026-11-21" },
    });
  });

  test("Calendar: a reminder fifteen minutes before the start", () => {
    const event = load("nextcloud-web-event-reminder.ics").master as Event;
    expect(event.alarms).toEqual([
      {
        action: "DISPLAY",
        description: "This is an event reminder.",
        trigger: { type: "relative", relatedTo: "start", offsetSeconds: -900 },
      },
    ]);
  });

  test("Calendar: a series with one occurrence moved and one deleted", () => {
    const object = load("nextcloud-web-event-recurring.ics");
    expect(object.master).toMatchObject({ summary: "Standup", recurring: true });
    expect(object.exceptions).toHaveLength(1);
    expect(object.exceptions[0]).toMatchObject({
      summary: "Standup (moved)",
      recurrenceId: { type: "zoned", local: "2026-11-30T09:00:00", timeZone: "Europe/Vilnius" },
      start: { local: "2026-11-30T11:00:00" },
    });
  });

  test("Tasks: times in UTC, a date-only due date, completion, a parent", () => {
    expect(load("nextcloud-web-task-due.ics").master).toMatchObject({
      kind: "task",
      start: null,
      due: { type: "zoned", timeZone: "UTC", epochMs: Date.parse("2026-11-20T08:00:00Z") },
    });
    expect(load("nextcloud-web-task-start-due.ics").master).toMatchObject({
      start: { type: "zoned", epochMs: Date.parse("2026-11-16T08:00:00Z") },
      due: { type: "zoned", epochMs: Date.parse("2026-11-18T09:00:00Z") },
    });
    expect(load("nextcloud-web-task-completed.ics").master).toMatchObject({
      due: { type: "date", date: "2026-11-10" },
      status: "COMPLETED",
      percentComplete: 100,
      completed: { type: "zoned", timeZone: "UTC" },
    });
    expect(load("nextcloud-web-task-subtask.ics").master).toMatchObject({
      summary: "Pack the books",
      parentUid: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(load("nextcloud-web-task-priority-categories.ics").master).toMatchObject({
      priority: 1,
      categories: ["Errands", "Family"],
    });
  });
});

describe("invalid objects", () => {
  const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;

  test.each([
    ["not iCalendar", "hello"],
    ["no item", wrap("")],
    [
      "two UIDs",
      wrap("BEGIN:VEVENT\r\nUID:a\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b\r\nEND:VEVENT\r\n"),
    ],
    ["no UID", wrap("BEGIN:VEVENT\r\nSUMMARY:x\r\nEND:VEVENT\r\n")],
    [
      "two masters",
      wrap("BEGIN:VEVENT\r\nUID:a\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:a\r\nEND:VEVENT\r\n"),
    ],
    [
      "an event and a task",
      wrap("BEGIN:VEVENT\r\nUID:a\r\nEND:VEVENT\r\nBEGIN:VTODO\r\nUID:a\r\nEND:VTODO\r\n"),
    ],
  ])("%s is refused", (_, ics) => {
    expect(() => CalendarObject.parse(ics)).toThrow(CalendarObjectError);
  });
});

test("Cyrillic text folds on octets, never inside a character", () => {
  const summary = "Очень длинное название события на русском языке, чтобы проверить перенос строк";
  const object = CalendarObject.parse(
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ru\r\nSUMMARY:${summary.replace(",", "\\,")}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
  );
  const written = object.serialize();
  expect(written.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(
    true,
  );
  expect(CalendarObject.parse(written).master?.summary).toBe(summary);
});

test("serialize leaves ical.js's global fold length as it found it", () => {
  const before = ICAL.foldLength;
  load("apple-event-attendees.ics").serialize();
  expect(ICAL.foldLength).toBe(before);
});
