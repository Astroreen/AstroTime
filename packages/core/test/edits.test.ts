import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  createItem,
  deleteItem,
  editItem,
  occurrencesBetween,
  repeatOf,
  timesOf,
  zonedTime,
  type Event,
  type ItemTime,
  type Repeat,
  type Task,
} from "../src/index.ts";
import { fixture, load } from "./support.ts";

const NOW = Date.parse("2026-11-04T08:40:00Z");
const STAMP = "20261104T084000Z";
const timeZone = "Europe/Vilnius";
const vilnius = (local: string) => zonedTime(local, timeZone);

/** `ics` with each line `from` replaced by `to` (`null` removes it), checking each is there. */
function edit(ics: string, changes: [string, string | null][]): string {
  let lines = ics.split("\r\n");
  for (const [from, to] of changes) {
    const at = lines.indexOf(from);
    expect(at, from).toBeGreaterThanOrEqual(0);
    lines = to === null ? lines.toSpliced(at, 1) : lines.toSpliced(at, 1, ...to.split("\r\n"));
  }
  return lines.join("\r\n");
}

/** The starts of the occurrences in a range, as wall clocks in Vilnius. */
function starts(ics: string, from = "2026-11-01", to = "2027-02-01"): string[] {
  return occurrencesBetween(CalendarObject.parse(ics), { from, to, timeZone }).map((o) =>
    o.start.type === "date" ? o.start.date : o.start.local,
  );
}

const weekly: Repeat = {
  frequency: "WEEKLY",
  interval: 1,
  weekdays: [],
  monthlyWeekday: null,
  end: { type: "never" },
};

describe("creating (D9, D10)", () => {
  test("an event: UID, DTSTAMP, CREATED, LAST-MODIFIED, SEQUENCE:0, the fields, and a VTIMEZONE for its zone", () => {
    const ics = createItem(
      "event",
      {
        summary: "Planning",
        location: "Room 4",
        description: "The week ahead",
        time: { start: vilnius("2026-11-04T11:00:00"), end: vilnius("2026-11-04T12:00:00") },
        alarms: { remove: [], add: [{ relatedTo: "start", offsetSeconds: -900 }] },
      },
      { now: NOW, uid: "new-event" },
    );
    expect(ics.split("\r\n").slice(0, 20)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//AstroTime//AstroTime//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "UID:new-event",
      `DTSTAMP:${STAMP}`,
      `CREATED:${STAMP}`,
      `LAST-MODIFIED:${STAMP}`,
      "SEQUENCE:0",
      "SUMMARY:Planning",
      "LOCATION:Room 4",
      "DESCRIPTION:The week ahead",
      "DTSTART;TZID=Europe/Vilnius:20261104T110000",
      "DTEND;TZID=Europe/Vilnius:20261104T120000",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Planning",
      "TRIGGER:-PT15M",
      "END:VALARM",
    ]);
    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/Vilnius\r\n");
    const object = CalendarObject.parse(ics);
    expect(object.master).toMatchObject({
      kind: "event",
      summary: "Planning",
      start: { type: "zoned", epochMs: Date.parse("2026-11-04T09:00:00Z") },
      alarms: [{ trigger: { type: "relative", relatedTo: "start", offsetSeconds: -900 } }],
    });
  });

  test("an all-day event and an undated task", () => {
    const allDay = createItem(
      "event",
      { summary: "Day off", time: { start: date("2026-11-17"), end: date("2026-11-18") } },
      { now: NOW, uid: "day-off" },
    );
    expect(allDay).toContain("DTSTART;VALUE=DATE:20261117\r\nDTEND;VALUE=DATE:20261118\r\n");
    expect(allDay).not.toContain("VTIMEZONE");
    const task = createItem("task", { summary: "Buy milk" }, { now: NOW, uid: "milk" });
    expect(task).toContain("BEGIN:VTODO\r\nUID:milk\r\n");
    expect(CalendarObject.parse(task).master).toMatchObject({ kind: "task", due: null });
  });

  test("a task due at a time: a reminder before its due is related to its end", () => {
    const ics = createItem(
      "task",
      {
        summary: "Send the report",
        time: { start: null, end: vilnius("2026-11-20T10:00:00") },
        alarms: { remove: [], add: [{ relatedTo: "end", offsetSeconds: -3600 }] },
        priority: 1,
      },
      { now: NOW, uid: "report" },
    );
    expect(ics).toContain("DUE;TZID=Europe/Vilnius:20261120T100000\r\n");
    expect(ics).toContain("TRIGGER;RELATED=END:-PT1H\r\n");
    expect(ics).toContain("PRIORITY:1\r\n");
    expect(ics.slice(0, ics.indexOf("END:VTODO"))).not.toContain("DTSTART");
  });

  test("a series in its own zone: the rule's UNTIL is the end of that day in UTC", () => {
    const ics = createItem(
      "event",
      {
        summary: "Standup",
        time: { start: vilnius("2026-11-02T09:00:00"), end: vilnius("2026-11-02T09:15:00") },
        repeat: {
          ...weekly,
          interval: 2,
          weekdays: ["MO", "WE"],
          end: { type: "until", until: "2026-11-30" },
        },
      },
      { now: NOW, uid: "standup" },
    );
    expect(ics).toContain("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261130T215959Z\r\n");
    expect(starts(ics)).toEqual([
      "2026-11-02T09:00:00",
      "2026-11-04T09:00:00",
      "2026-11-16T09:00:00",
      "2026-11-18T09:00:00",
      "2026-11-30T09:00:00",
    ]);
  });

  test("an event needs a start", () => {
    expect(() => createItem("event", { summary: "x" }, { now: NOW, uid: "x" })).toThrow();
  });
});

const date = (day: string): ItemTime => ({ type: "date", date: day });

describe("editing writes what the user changed, and nothing else (D7)", () => {
  test("a new title: SUMMARY, LAST-MODIFIED and DTSTAMP; SEQUENCE stays; every other line byte for byte", () => {
    const source = fixture("nextcloud-web-event-timed.ics");
    const { ics, split } = editItem(
      CalendarObject.parse(source),
      { summary: "Planning, week 47" },
      {
        now: NOW,
      },
    );
    expect(split).toBeNull();
    expect(ics).toBe(
      `${edit(source, [
        ["DTSTAMP:20261102T070004Z", `DTSTAMP:${STAMP}`],
        ["LAST-MODIFIED:20261102T070004Z", `LAST-MODIFIED:${STAMP}`],
        ["SUMMARY:Planning", "SUMMARY:Planning\\, week 47"],
      ])}\r\n`,
    );
  });

  test("a new time keeps its TZID and the VTIMEZONE, and counts a SEQUENCE", () => {
    const source = fixture("nextcloud-web-event-timed.ics");
    const { ics } = editItem(
      CalendarObject.parse(source),
      { time: { start: vilnius("2026-11-16T14:00:00"), end: vilnius("2026-11-16T15:30:00") } },
      { now: NOW },
    );
    expect(ics).toBe(
      `${edit(source, [
        ["DTSTAMP:20261102T070004Z", `DTSTAMP:${STAMP}`],
        ["LAST-MODIFIED:20261102T070004Z", `LAST-MODIFIED:${STAMP}`],
        ["SEQUENCE:2", "SEQUENCE:3"],
        [
          "DTSTART;TZID=Europe/Vilnius:20261116T100000",
          "DTSTART;TZID=Europe/Vilnius:20261116T140000",
        ],
        ["DTEND;TZID=Europe/Vilnius:20261116T110000", "DTEND;TZID=Europe/Vilnius:20261116T153000"],
      ])}\r\n`,
    );
  });

  test("Outlook's Windows TZID stays as written when the time moves in its zone", () => {
    const object = load("outlook-event-windows-tz.ics");
    const start = (object.master as Event).start!;
    expect(start).toMatchObject({ type: "zoned", timeZone: "Europe/Berlin" });
    const { ics } = editItem(
      object,
      {
        time: {
          start: zonedTime("2026-11-10T15:00:00", "Europe/Berlin"),
          end: zonedTime("2026-11-10T16:00:00", "Europe/Berlin"),
        },
      },
      { now: NOW },
    );
    expect(ics).toContain("DTSTART;TZID=W. Europe Standard Time:20261110T150000\r\n");
    expect(ics.match(/BEGIN:VTIMEZONE/g)).toHaveLength(1);
  });

  test("all day → timed: VALUE=DATE goes, the time is in the user's zone with its VTIMEZONE", () => {
    const source = fixture("nextcloud-web-event-allday.ics");
    const { ics } = editItem(
      CalendarObject.parse(source),
      { time: { start: vilnius("2026-11-17T10:00:00"), end: vilnius("2026-11-17T11:00:00") } },
      { now: NOW },
    );
    expect(ics).toContain(
      "DTSTART;TZID=Europe/Vilnius:20261117T100000\r\nDTEND;TZID=Europe/Vilnius:20261117T110000\r\n",
    );
    expect(ics).toContain("END:VEVENT\r\nBEGIN:VTIMEZONE\r\nTZID:Europe/Vilnius\r\n");
    expect(starts(ics)).toEqual(["2026-11-17T10:00:00"]);
    // And back: dates, and the VTIMEZONE stays (nothing is lost, D7).
    const back = editItem(
      CalendarObject.parse(ics),
      { time: { start: date("2026-11-17"), end: date("2026-11-18") } },
      { now: NOW },
    ).ics;
    expect(back).toContain("DTSTART;VALUE=DATE:20261117\r\nDTEND;VALUE=DATE:20261118\r\n");
    expect(starts(back)).toEqual(["2026-11-17"]);
  });

  test("a DURATION gives way to the DTEND written", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:duration",
      "DTSTAMP:20261001T000000Z",
      "DTSTART:20261110T100000Z",
      "DURATION:PT1H",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    const { ics: written } = editItem(
      CalendarObject.parse(ics),
      {
        time: {
          start: zonedTime("2026-11-10T11:00:00", "UTC"),
          end: zonedTime("2026-11-10T13:00:00", "UTC"),
        },
      },
      { now: NOW },
    );
    expect(written).not.toContain("DURATION");
    expect(written).toContain(
      "DTSTART:20261110T110000Z\r\nDTEND:20261110T130000Z\r\nSEQUENCE:1\r\n",
    );
  });

  test("Apple's attendees, organizer and X- properties survive an edit of the location", () => {
    const source = fixture("apple-event-attendees.ics");
    const { ics } = editItem(CalendarObject.parse(source), { location: "Room 1" }, { now: NOW });
    const unchanged = (text: string) =>
      text
        .replaceAll(/\r\n[ \t]/g, "")
        .split("\r\n")
        .filter((line) => !/^(LOCATION|DTSTAMP|LAST-MODIFIED)[:;]/.test(line));
    // As ical.js writes the source back (quotes only where a value needs them).
    expect(unchanged(ics)).toEqual(unchanged(CalendarObject.parse(source).serialize()));
    expect(ics).toContain("LOCATION:Room 1\r\n");
  });

  test("a new description drops its HTML twins (ALTREP, X-ALT-DESC); other parameters stay", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:html",
      "DTSTAMP:20261001T000000Z",
      "DTSTART;VALUE=DATE:20261110",
      'DESCRIPTION;LANGUAGE=en;ALTREP="data:text/html,<b>Old</b>":Old',
      "X-ALT-DESC;FMTTYPE=text/html:<b>Old</b>",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    const { ics: written } = editItem(
      CalendarObject.parse(ics),
      { description: "New" },
      { now: NOW },
    );
    expect(written).toContain("DESCRIPTION;LANGUAGE=en:New\r\n");
    expect(written).not.toContain("X-ALT-DESC");
  });

  test("an empty text removes its property; a colour is set and taken away", () => {
    const source = fixture("nextcloud-web-event-timed.ics");
    const coloured = editItem(
      CalendarObject.parse(source),
      { location: "", color: "tomato" },
      { now: NOW },
    ).ics;
    expect(coloured).not.toContain("LOCATION");
    expect(coloured).toContain("COLOR:tomato\r\n");
    const plain = editItem(CalendarObject.parse(coloured), { color: null }, { now: NOW }).ics;
    expect(plain).not.toContain("COLOR");
  });

  test("reminders: one removed by its index, one added; the others stay byte for byte", () => {
    const source = fixture("nextcloud-web-event-reminder.ics");
    const removed = editItem(
      CalendarObject.parse(source),
      { alarms: { remove: [0], add: [{ relatedTo: "start", offsetSeconds: -86_400 }] } },
      { now: NOW },
    ).ics;
    expect(removed).not.toContain("This is an event reminder.");
    expect(removed).toContain(
      "BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Dentist\r\nTRIGGER:-P1D\r\nEND:VALARM\r\n",
    );
    const added = editItem(
      CalendarObject.parse(source),
      { alarms: { remove: [], add: [{ relatedTo: "start", offsetSeconds: 0 }] } },
      { now: NOW },
    ).ics;
    expect(added).toContain(
      "TRIGGER;RELATED=START:-PT15M\r\nSUMMARY:Dentist\r\nDESCRIPTION:This is an event reminder.\r\nEND:VALARM\r\n",
    );
    expect(CalendarObject.parse(added).master!.alarms).toHaveLength(2);
  });

  test("a task's status, progress, priority and categories (D10), as Nextcloud Tasks writes them", () => {
    const source = fixture("nextcloud-web-task-priority-categories.ics");
    const object = CalendarObject.parse(source);
    const done = editItem(object, { status: "COMPLETED" }, { now: NOW }).ics;
    expect(CalendarObject.parse(done).master).toMatchObject({
      status: "COMPLETED",
      percentComplete: 100,
      completed: { type: "zoned", epochMs: NOW },
    });
    const changed = CalendarObject.parse(
      editItem(
        CalendarObject.parse(done),
        {
          status: "IN-PROCESS",
          percentComplete: 30,
          priority: 5,
          categories: ["Home", "Errands"],
        },
        { now: NOW },
      ).ics,
    ).master as Task;
    expect(changed).toMatchObject({
      status: "IN-PROCESS",
      percentComplete: 30,
      priority: 5,
      completed: null,
      categories: ["Home", "Errands"],
    });
    const none = editItem(
      CalendarObject.parse(source),
      { priority: null, categories: [] },
      { now: NOW },
    ).ics;
    expect(none).not.toMatch(/PRIORITY|CATEGORIES/);
  });

  test("a task's due moves, and its start can be added or taken away", () => {
    const source = fixture("nextcloud-web-task-due.ics");
    const withStart = editItem(
      CalendarObject.parse(source),
      {
        time: {
          start: zonedTime("2026-11-19T08:00:00", "UTC"),
          end: zonedTime("2026-11-20T08:00:00", "UTC"),
        },
      },
      { now: NOW },
    ).ics;
    // UTC stays UTC, as Nextcloud Tasks writes it.
    expect(withStart).toContain("DTSTART:20261119T080000Z\r\n");
    expect(withStart).toContain("DUE:20261120T080000Z\r\n");
    const undated = editItem(
      CalendarObject.parse(withStart),
      { time: { start: null, end: null } },
      { now: NOW },
    ).ics;
    expect(undated).not.toMatch(/DTSTART|DUE/);
  });
});

describe("the repeat rule", () => {
  test("is read from the fixtures, exactly where it can be", () => {
    expect(repeatOf(load("nextcloud-web-event-recurring.ics"))).toEqual({
      repeat: { ...weekly, weekdays: ["MO"], end: { type: "count", count: 6 } },
      exact: true,
    });
    expect(repeatOf(load("tasksorg-task-recurring.ics"))).toEqual({
      repeat: { ...weekly, frequency: "DAILY", interval: 3 },
      exact: true,
    });
    expect(repeatOf(load("nextcloud-web-event-timed.ics"))).toBeNull();
  });

  test("a rule beyond the presets is inexact, and stays untouched by an edit of something else", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:setpos",
      "DTSTAMP:20261001T000000Z",
      "DTSTART;VALUE=DATE:20261130",
      "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    expect(repeatOf(CalendarObject.parse(ics))?.exact).toBe(false);
    const { ics: written } = editItem(
      CalendarObject.parse(ics),
      { summary: "Pay day" },
      { now: NOW },
    );
    expect(written).toContain("RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1\r\n");
  });

  test("monthly on the nth weekday, yearly, and an end by count", () => {
    const start = vilnius("2026-11-04T18:00:00");
    const make = (repeat: Repeat) =>
      createItem(
        "event",
        { summary: "x", time: { start, end: vilnius("2026-11-04T19:00:00") }, repeat },
        { now: NOW, uid: "x" },
      );
    const monthly = make({
      ...weekly,
      frequency: "MONTHLY",
      monthlyWeekday: { nth: 1, weekday: "WE" },
      end: { type: "count", count: 3 },
    });
    expect(monthly).toContain("RRULE:FREQ=MONTHLY;COUNT=3;BYDAY=1WE\r\n");
    expect(starts(monthly)).toEqual([
      "2026-11-04T18:00:00",
      "2026-12-02T18:00:00",
      "2027-01-06T18:00:00",
    ]);
    expect(repeatOf(CalendarObject.parse(monthly))?.repeat.monthlyWeekday).toEqual({
      nth: 1,
      weekday: "WE",
    });
    const yearly = make({ ...weekly, frequency: "YEARLY" });
    expect(yearly).toContain("RRULE:FREQ=YEARLY\r\n");
  });

  test("set on an item that did not repeat, and taken away with its exclusions and exceptions", () => {
    const repeating = editItem(
      load("nextcloud-web-event-timed.ics"),
      { repeat: weekly },
      {
        now: NOW,
      },
    ).ics;
    expect(repeating).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO\r\n");
    expect(repeating).toContain("SEQUENCE:3\r\n");
    expect(starts(repeating, "2026-11-16", "2026-12-01")).toEqual([
      "2026-11-16T10:00:00",
      "2026-11-23T10:00:00",
      "2026-11-30T10:00:00",
    ]);
    const series = load("nextcloud-web-event-recurring.ics");
    const single = editItem(
      series,
      { repeat: null },
      {
        now: NOW,
        scope: "all",
        recurrenceId: vilnius("2026-11-23T09:00:00"),
      },
    ).ics;
    expect(single.slice(0, single.indexOf("BEGIN:VTIMEZONE"))).not.toMatch(
      /RRULE|EXDATE|RECURRENCE-ID/,
    );
    expect(starts(single)).toEqual(["2026-11-23T09:00:00"]);
  });
});

describe("the scope of an edit of one occurrence (D11)", () => {
  // Weekly on Mondays at 9:00 from November 23, six times; the second moved to
  // 11:00 and renamed, the third deleted (Nextcloud's web calendar).
  const source = fixture("nextcloud-web-event-recurring.ics");
  const series = () => CalendarObject.parse(source);
  const occurrence = (local: string) => vilnius(local);

  test("the series as recorded", () => {
    expect(starts(source)).toEqual([
      "2026-11-23T09:00:00",
      "2026-11-30T11:00:00",
      "2026-12-14T09:00:00",
      "2026-12-21T09:00:00",
      "2026-12-28T09:00:00",
    ]);
  });

  test("this occurrence: an exception at its time, the master untouched", () => {
    const recurrenceId = occurrence("2026-12-14T09:00:00");
    expect(timesOf(series(), recurrenceId)).toEqual({
      start: vilnius("2026-12-14T09:00:00"),
      end: vilnius("2026-12-14T09:30:00"),
    });
    const { ics } = editItem(
      series(),
      {
        summary: "Standup, longer",
        time: { start: vilnius("2026-12-14T09:00:00"), end: vilnius("2026-12-14T10:00:00") },
      },
      { now: NOW, scope: "this", recurrenceId },
    );
    expect(ics.slice(0, ics.indexOf("END:VEVENT"))).toBe(
      source.slice(0, source.indexOf("END:VEVENT")),
    );
    const exception = ics.slice(ics.lastIndexOf("BEGIN:VEVENT"), ics.lastIndexOf("END:VEVENT"));
    expect(exception).toContain("RECURRENCE-ID;TZID=Europe/Vilnius:20261214T090000\r\n");
    expect(exception).toContain("DTEND;TZID=Europe/Vilnius:20261214T100000\r\n");
    expect(exception).toContain("SUMMARY:Standup\\, longer\r\n");
    expect(exception).toContain("SEQUENCE:4\r\n");
    expect(exception).not.toMatch(/RRULE|EXDATE/);
    expect(starts(ics)).toHaveLength(5);
  });

  test("this occurrence, already an exception: changed in place", () => {
    const { ics } = editItem(
      series(),
      { summary: "Standup (moved again)" },
      { now: NOW, scope: "this", recurrenceId: occurrence("2026-11-30T09:00:00") },
    );
    expect(CalendarObject.parse(ics).exceptions).toHaveLength(1);
    expect(ics).toContain("SUMMARY:Standup (moved again)\r\n");
    expect(ics).toContain("DTSTART;TZID=Europe/Vilnius:20261130T110000\r\n");
  });

  test("this and following: the series ends before it; the rest is a new series with the edit", () => {
    const { ics, split } = editItem(
      series(),
      {
        summary: "Standup v2",
        time: { start: vilnius("2026-12-21T10:00:00"), end: vilnius("2026-12-21T10:30:00") },
      },
      {
        now: NOW,
        scope: "following",
        recurrenceId: occurrence("2026-12-21T09:00:00"),
        newUid: "v2",
      },
    );
    // 9:00 in Vilnius in winter is 7:00 UTC; a COUNT became the UNTIL.
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261221T065959Z\r\n");
    expect(starts(ics)).toEqual([
      "2026-11-23T09:00:00",
      "2026-11-30T11:00:00",
      "2026-12-14T09:00:00",
    ]);
    expect(split).not.toBeNull();
    const rest = CalendarObject.parse(split!);
    expect(rest.uid).toBe("v2");
    expect(rest.master).toMatchObject({ summary: "Standup v2", sequence: 0 });
    // Six in all: four before the split, two left.
    expect(split).toContain("RRULE:FREQ=WEEKLY;COUNT=2;BYDAY=MO\r\n");
    expect(split).toContain(`CREATED:${STAMP}\r\n`);
    expect(split).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/Vilnius");
    expect(starts(split!)).toEqual(["2026-12-21T10:00:00", "2026-12-28T10:00:00"]);
  });

  test("this and following moves the exceptions and EXDATEs after it to the new series", () => {
    const { ics, split } = editItem(
      series(),
      { location: "Room 2" },
      {
        now: NOW,
        scope: "following",
        recurrenceId: occurrence("2026-11-30T09:00:00"),
        newUid: "v2",
      },
    );
    expect(CalendarObject.parse(ics).exceptions).toHaveLength(0);
    expect(ics).not.toContain("EXDATE");
    expect(starts(ics)).toEqual(["2026-11-23T09:00:00"]);
    const rest = CalendarObject.parse(split!);
    expect(rest.exceptions).toHaveLength(1);
    expect(rest.exceptions[0]).toMatchObject({
      uid: "v2",
      summary: "Standup (moved)",
      location: "Room 2",
    });
    expect(split).toContain("EXDATE;TZID=Europe/Vilnius:20261207T090000\r\n");
    expect(split).toContain("RRULE:FREQ=WEEKLY;COUNT=5;BYDAY=MO\r\n");
    expect(starts(split!)).toEqual([
      "2026-11-30T11:00:00",
      "2026-12-14T09:00:00",
      "2026-12-21T09:00:00",
      "2026-12-28T09:00:00",
    ]);
  });

  test("this and following from the first occurrence is all of them", () => {
    const { split } = editItem(
      series(),
      { summary: "Daily" },
      {
        now: NOW,
        scope: "following",
        recurrenceId: occurrence("2026-11-23T09:00:00"),
        newUid: "v2",
      },
    );
    expect(split).toBeNull();
  });

  test("all: a new time moves the series, its EXDATEs and RECURRENCE-IDs; a moved exception keeps its time", () => {
    const { ics } = editItem(
      series(),
      { time: { start: vilnius("2026-12-14T10:00:00"), end: vilnius("2026-12-14T11:00:00") } },
      { now: NOW, scope: "all", recurrenceId: occurrence("2026-12-14T09:00:00") },
    );
    expect(ics).toContain("DTSTART;TZID=Europe/Vilnius:20261123T100000\r\n");
    expect(ics).toContain("DTEND;TZID=Europe/Vilnius:20261123T110000\r\n");
    expect(ics).toContain("EXDATE;TZID=Europe/Vilnius:20261207T100000\r\n");
    expect(ics).toContain("RECURRENCE-ID;TZID=Europe/Vilnius:20261130T100000\r\n");
    expect(starts(ics)).toEqual([
      "2026-11-23T10:00:00",
      "2026-11-30T11:00:00",
      "2026-12-14T10:00:00",
      "2026-12-21T10:00:00",
      "2026-12-28T10:00:00",
    ]);
  });

  test("all: a new title reaches an exception that had the series' title, not one renamed on its own", () => {
    const withCopy = editItem(
      series(),
      { location: "Room 2" },
      { now: NOW, scope: "this", recurrenceId: occurrence("2026-12-21T09:00:00") },
    ).ics;
    const { ics } = editItem(
      CalendarObject.parse(withCopy),
      { summary: "Daily sync" },
      { now: NOW, scope: "all", recurrenceId: occurrence("2026-11-23T09:00:00") },
    );
    const titles = Object.fromEntries(
      occurrencesBetween(CalendarObject.parse(ics), {
        from: "2026-11-01",
        to: "2027-01-01",
        timeZone,
      }).map((o) => [o.start.type === "zoned" ? o.start.local.slice(0, 10) : "", o.item.summary]),
    );
    expect(titles).toEqual({
      "2026-11-23": "Daily sync",
      "2026-11-30": "Standup (moved)",
      "2026-12-14": "Daily sync",
      "2026-12-21": "Daily sync",
      "2026-12-28": "Daily sync",
    });
  });

  test("all, across DST: the series keeps its wall clock, and so do the EXDATEs that move with it", () => {
    const ics = createItem(
      "event",
      {
        summary: "Swim",
        time: { start: vilnius("2026-10-19T07:00:00"), end: vilnius("2026-10-19T08:00:00") },
        repeat: { ...weekly, end: { type: "count", count: 4 } },
      },
      { now: NOW, uid: "swim" },
    );
    const excluded = deleteItem(CalendarObject.parse(ics), {
      now: NOW,
      scope: "this",
      recurrenceId: vilnius("2026-11-02T07:00:00"),
    })!;
    // Summer time ends on October 25: the UTC offsets differ, the wall clock does not.
    const moved = editItem(
      CalendarObject.parse(excluded),
      { time: { start: vilnius("2026-10-26T08:30:00"), end: vilnius("2026-10-26T09:30:00") } },
      { now: NOW, scope: "all", recurrenceId: vilnius("2026-10-26T07:00:00") },
    ).ics;
    expect(moved).toContain("EXDATE;TZID=Europe/Vilnius:20261102T083000\r\n");
    expect(starts(moved, "2026-10-01")).toEqual([
      "2026-10-19T08:30:00",
      "2026-10-26T08:30:00",
      "2026-11-09T08:30:00",
    ]);
  });

  test("all: a new rule drops the exceptions it no longer has an occurrence for", () => {
    const { ics } = editItem(
      series(),
      { repeat: { ...weekly, weekdays: ["TU"] } },
      { now: NOW, scope: "all", recurrenceId: occurrence("2026-11-23T09:00:00") },
    );
    expect(ics).not.toMatch(/RECURRENCE-ID|EXDATE/);
    expect(ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU\r\n");
  });

  test("a series of dates: the split's UNTIL is the day before, as a date", () => {
    const object = load("tasksorg-task-recurring.ics");
    const { ics, split } = editItem(
      object,
      { summary: "Water the plants, more" },
      { now: NOW, scope: "following", recurrenceId: date("2026-11-08"), newUid: "plants-2" },
    );
    expect(ics).toContain("RRULE:FREQ=DAILY;INTERVAL=3;UNTIL=20261107\r\n");
    expect(split).toContain("DUE;VALUE=DATE:20261108\r\n");
    expect(split).toContain("DTSTART;VALUE=DATE:20261108\r\n");
    expect(split).toContain("X-APPLE-SORT-ORDER:-2147483648\r\n");
  });

  test("a floating series: UNTIL is a wall clock too", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//test//EN",
      "BEGIN:VEVENT",
      "UID:floating",
      "DTSTAMP:20261001T000000Z",
      "DTSTART:20261102T070000",
      "DTEND:20261102T073000",
      "RRULE:FREQ=DAILY",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    const { ics: written } = editItem(
      CalendarObject.parse(ics),
      { summary: "x" },
      {
        now: NOW,
        scope: "following",
        recurrenceId: { type: "floating", local: "2026-11-05T07:00:00" },
        newUid: "y",
      },
    );
    expect(written).toContain("RRULE:FREQ=DAILY;UNTIL=20261105T065959\r\n");
  });

  test("Outlook's exceptions without a VTIMEZONE: this occurrence keeps the Windows TZID", () => {
    const object = load("outlook-event-recurring-exceptions-no-vtimezone.ics");
    const occurrences = occurrencesBetween(object, {
      from: "2026-10-01",
      to: "2026-11-30",
      timeZone,
    });
    const first = occurrences[0]!;
    const { ics } = editItem(
      object,
      { summary: "Weekly sync (one off)" },
      { now: NOW, scope: "this", recurrenceId: first.recurrenceId },
    );
    expect(ics).toContain("RECURRENCE-ID;TZID=W. Europe Standard Time:20261015T090000\r\n");
    expect(CalendarObject.parse(ics).exceptions).toHaveLength(2);
  });
});

describe("deleting with a scope (D11)", () => {
  const source = fixture("nextcloud-web-event-recurring.ics");
  const series = () => CalendarObject.parse(source);

  test("this occurrence: an EXDATE in the series' TZID; its exception, if any, goes", () => {
    const ics = deleteItem(series(), {
      now: NOW,
      scope: "this",
      recurrenceId: vilnius("2026-11-30T09:00:00"),
    })!;
    expect(ics).toContain(
      "EXDATE;TZID=Europe/Vilnius:20261207T090000\r\nEXDATE;TZID=Europe/Vilnius:20261130T090000\r\n",
    );
    expect(CalendarObject.parse(ics).exceptions).toHaveLength(0);
    expect(starts(ics)).toEqual([
      "2026-11-23T09:00:00",
      "2026-12-14T09:00:00",
      "2026-12-21T09:00:00",
      "2026-12-28T09:00:00",
    ]);
  });

  test("this occurrence of a series of dates: an EXDATE as a date", () => {
    const ics = deleteItem(load("tasksorg-task-recurring.ics"), {
      now: NOW,
      scope: "this",
      recurrenceId: date("2026-11-05"),
    })!;
    expect(ics).toContain("EXDATE;VALUE=DATE:20261105\r\n");
  });

  test("this and following: the series ends before it; from the first, all of it", () => {
    const ics = deleteItem(series(), {
      now: NOW,
      scope: "following",
      recurrenceId: vilnius("2026-12-14T09:00:00"),
    })!;
    expect(starts(ics)).toEqual(["2026-11-23T09:00:00", "2026-11-30T11:00:00"]);
    expect(
      deleteItem(series(), {
        now: NOW,
        scope: "following",
        recurrenceId: vilnius("2026-11-23T09:00:00"),
      }),
    ).toBeNull();
  });

  test("all occurrences, or an item that does not repeat: the object goes", () => {
    expect(
      deleteItem(series(), {
        now: NOW,
        scope: "all",
        recurrenceId: vilnius("2026-12-14T09:00:00"),
      }),
    ).toBeNull();
    expect(deleteItem(load("nextcloud-web-event-timed.ics"), { now: NOW })).toBeNull();
  });
});
