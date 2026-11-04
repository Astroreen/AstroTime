import { readFileSync } from "node:fs";

import {
  CalendarObject,
  occurrencesBetween,
  wallClockOf,
  type Event,
  type Task,
} from "@astrotime/core";
import { splitCalendars } from "@astrotime/core/split";
import { describe, expect, test } from "vite-plus/test";

import { readImport } from "../src/import/read.ts";
import { vcalendarToIcs } from "../src/import/vcs.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/import/${name}`, import.meta.url));

const read = (name: string, language = "en") =>
  readImport(
    { name, bytes: fixture(name) },
    {
      language,
      timeZone: "Europe/Vilnius",
      newUid: () => "new",
      pause: () => Promise.resolve(),
    },
  );

const lines = (...content: string[]) => `${content.join("\r\n")}\r\n`;

/** The items of a converted file, by UID. */
async function items(name: string) {
  const [source] = (await read(name)).sources;
  return {
    source: source!,
    byUid: new Map(
      source!.items.map((item) => [item.uid, CalendarObject.parse(item.ics)] as const),
    ),
  };
}

describe("Outlook's vCalendar (import D266, D272)", () => {
  test("quoted-printable text with soft breaks, UTC times, alarms before the start", async () => {
    const { source, byUid } = await items("outlook.vcs");
    expect(source.name).toBe("outlook");
    expect(source.items.map((item) => item.kind)).toEqual(["event", "event"]);
    const review = [...byUid.values()][0]!.master as Event;
    expect(review.summary).toBe("Budget review");
    expect(review.location).toBe("Room 4, second floor");
    expect(review.description).toBe("Agenda:\n- last quarter\n- next year's draft\n");
    expect(review.categories).toEqual(["Work", "Finance"]);
    expect(review.start).toMatchObject({ epochMs: Date.UTC(2026, 10, 5, 7) });
    // Low in 1.0 is 3; in iCalendar 9.
    expect(byUid.values().next().value!.serialize()).toContain("PRIORITY:9");
    // Both alarms ten minutes before, so each occurrence would have them.
    expect(review.alarms.map((alarm) => [alarm.action, alarm.trigger])).toEqual([
      ["AUDIO", expect.objectContaining({ type: "relative", offsetSeconds: -600 })],
      ["DISPLAY", expect.objectContaining({ type: "relative", offsetSeconds: -600 })],
    ]);
    expect(source.notImported).toEqual([]);
  });

  test("an all-day event from midnight to midnight is a day", async () => {
    const { byUid } = await items("outlook.vcs");
    const day = [...byUid.values()][1]!.master as Event;
    expect(day.summary).toBe("Day off");
    expect(day.start).toEqual({ type: "date", date: "2026-11-10" });
    expect(day.end).toEqual({ type: "date", date: "2026-11-11" });
    expect(day.transparent).toBe(true);
  });
});

describe("a phone's vCalendar (import D266, D272)", () => {
  test("local times through TZ and DAYLIGHT; Windows-1251 and UTF-8 text", async () => {
    const { byUid } = await items("nokia.vcs");
    const meeting = byUid.get("nokia-1")!.master as Event;
    expect(meeting.summary).toBe("Встреча с Анной");
    // 21 October is in summer time (+03): 10:00 there is 07:00 UTC.
    expect(meeting.start).toMatchObject({ epochMs: Date.UTC(2026, 9, 21, 7) });
    expect(byUid.get("nokia-2")!.master!.summary).toBe("День рождения");
    // 1 November is past summer time (+02): 09:00 there is 07:00 UTC.
    expect(byUid.get("nokia-3")!.master).toMatchObject({
      start: expect.objectContaining({ epochMs: Date.UTC(2026, 10, 1, 7) }),
    });
  });

  test("1.0's rules as iCalendar's, its alarm before the start with its snoozes", async () => {
    const { byUid } = await items("nokia.vcs");
    // The item's own rule, not its zone's.
    const rule = (uid: string) =>
      /^RRULE:(.*)$/m.exec(byUid.get(uid)!.serialize().split("BEGIN:VEVENT")[1]!)?.[1];
    expect(rule("nokia-1")).toBe("FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4");
    expect(rule("nokia-2")).toBe("FREQ=YEARLY;BYMONTH=12");
    expect(rule("nokia-3")).toBe("FREQ=MONTHLY;BYMONTHDAY=1,-1;COUNT=6");
    // Its end in UTC, as a zoned start asks (RFC 5545 §3.3.10).
    expect(rule("nokia-4")).toBe("FREQ=MONTHLY;BYDAY=1TH;UNTIL=20270629T210000Z");
    const meeting = byUid.get("nokia-1")!;
    expect(meeting.serialize()).toContain("EXDATE;TZID=Europe/Vilnius:20261026T100000");
    expect(meeting.master!.alarms).toEqual([
      expect.objectContaining({
        action: "AUDIO",
        trigger: expect.objectContaining({ offsetSeconds: -900 }),
        repeat: 2,
        repeatEverySeconds: 300,
      }),
    ]);
    expect(meeting.master!.classification).toBe("PRIVATE");
    expect(meeting.serialize()).toContain("X-EPOCAGENDAENTRYTYPE:APPOINTMENT");
  });

  test("the organizer and a guest, a task's due date, status and priority", async () => {
    const { byUid } = await items("nokia.vcs");
    const club = byUid.get("nokia-4")!.master as Event;
    expect(club.organizer).toMatchObject({ address: "mailto:anna@example.com", name: "Anna Berg" });
    expect(club.attendees).toEqual([
      expect.objectContaining({
        address: "mailto:marta@example.com",
        role: "REQ-PARTICIPANT",
        status: "NEEDS-ACTION",
      }),
    ]);
    const task = byUid.get("nokia-5")!.master as Task;
    expect(task.kind).toBe("task");
    expect(task.status).toBe("NEEDS-ACTION");
    expect(task.due).toMatchObject({ epochMs: Date.UTC(2026, 10, 20, 10) });
    expect(byUid.get("nokia-5")!.serialize()).toContain("PRIORITY:1");
  });

  test("what iCalendar has no home for is named, not written as something else", async () => {
    const { source } = await items("nokia.vcs");
    // A procedure alarm runs a program on the phone.
    expect(source.notImported).toEqual(["PALARM"]);
  });
});

describe("1.0's corners", () => {
  test("no TZ: local times stay floating", () => {
    const { text } = vcalendarToIcs(
      lines(
        "BEGIN:VCALENDAR",
        "VERSION:1.0",
        "BEGIN:VEVENT",
        "UID:a",
        "DTSTART:20261105T090000",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      { timeZone: "UTC" },
    );
    expect(text).toContain("DTSTART:20261105T090000\r\n");
  });

  test("a rule of several parts, or one it does not know, is named and left out", () => {
    const { text, notImported } = vcalendarToIcs(
      lines(
        "BEGIN:VCALENDAR",
        "VERSION:1.0",
        "BEGIN:VEVENT",
        "UID:a",
        "DTSTART:20261105T090000Z",
        "RRULE:W1 MO #2 D1 #5",
        "RNUM:2",
        "X-FOO;ENCODING=QUOTED-PRINTABLE:a=3Db",
        "SPECIAL:value",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      { timeZone: "UTC" },
    );
    expect(text).not.toContain("RRULE");
    expect(text).toContain("X-FOO:a=b");
    expect(notImported).toEqual(["RRULE", "SPECIAL"]);
  });

  test("a rule with no end repeats twice, as 1.0 says", () => {
    const { text } = vcalendarToIcs(
      lines(
        "BEGIN:VCALENDAR",
        "VERSION:1.0",
        "BEGIN:VEVENT",
        "UID:a",
        "DTSTART:20261105T090000Z",
        "RRULE:D2",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      { timeZone: "UTC" },
    );
    expect(text).toContain("RRULE:FREQ=DAILY;INTERVAL=2;COUNT=2");
  });

  test("text with iCalendar's special characters is escaped, 1.0's \\; unescaped", () => {
    const { text } = vcalendarToIcs(
      lines(
        "BEGIN:VCALENDAR",
        "VERSION:1.0",
        "BEGIN:VEVENT",
        "UID:a",
        "DTSTART:20261105T090000Z",
        "SUMMARY:Lunch\\; then, coffee",
        "END:VEVENT",
        "END:VCALENDAR",
      ),
      { timeZone: "UTC" },
    );
    expect(text).toContain("SUMMARY:Lunch\\; then\\, coffee");
  });

  test("a vCalendar 1.0 file in Russian Windows-1251 with no charset named reads as guessed", async () => {
    const bytes = new Uint8Array([
      ...new TextEncoder().encode(
        "BEGIN:VCALENDAR\r\nVERSION:1.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261105T090000Z\r\nSUMMARY:",
      ),
      // "Обед" in Windows-1251.
      0xce,
      0xe1,
      0xe5,
      0xe4,
      ...new TextEncoder().encode("\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n"),
    ]);
    const file = await readImport(
      { name: "a.vcs", bytes },
      { language: "ru", timeZone: "UTC", newUid: () => "x", pause: () => Promise.resolve() },
    );
    expect(file.guessed).toBe("windows-1251");
    expect(CalendarObject.parse(file.sources[0]!.items[0]!.ics).master?.summary).toBe("Обед");
  });
});

describe("#151's review", () => {
  const vcal = (...content: string[]) =>
    lines("BEGIN:VCALENDAR", "VERSION:1.0", ...content, "END:VCALENDAR");

  test("a weekly series keeps its wall clock across a change of offset, in the user's zone", () => {
    const { text } = vcalendarToIcs(
      vcal(
        "TZ:+02",
        "DAYLIGHT:TRUE;+03;20260329T030000;20261025T040000;EET;EEST",
        "BEGIN:VEVENT",
        "UID:w",
        "DTSTART:20261019T100000",
        "RRULE:W1 MO #3",
        "END:VEVENT",
      ),
      { timeZone: "Europe/Vilnius" },
    );
    const object = CalendarObject.parse(
      splitCalendars(text, { newUid: () => "x" })[0]!.objects[0]!.ics,
    );
    const starts = occurrencesBetween(object, {
      from: "2026-10-01",
      to: "2026-11-30",
      timeZone: "Europe/Vilnius",
    }).map((occurrence) => wallClockOf(occurrence.start!, "Europe/Vilnius"));
    // 19 October is summer time, the 26th and 2 November not: 10:00 all three.
    expect(starts).toEqual(["2026-10-19T10:00:00", "2026-10-26T10:00:00", "2026-11-02T10:00:00"]);
  });

  test("a zone the user's is not: the file's TZ and DAYLIGHT as a VTIMEZONE of its own", () => {
    const { text } = vcalendarToIcs(
      vcal(
        "TZ:+02",
        "DAYLIGHT:TRUE;+03;20260329T030000;20261025T040000;EET;EEST",
        "BEGIN:VEVENT",
        "UID:w",
        "DTSTART:20261019T100000",
        "END:VEVENT",
      ),
      { timeZone: "America/New_York" },
    );
    expect(text).toContain("DTSTART;TZID=vCalendar +0200/+0300:20261019T100000");
    const object = CalendarObject.parse(
      splitCalendars(text, { newUid: () => "x" })[0]!.objects[0]!.ics,
    );
    expect(object.master!.start).toMatchObject({ epochMs: Date.UTC(2026, 9, 19, 7) });
  });

  test("a quoted-printable soft break before a line that starts with a space", () => {
    const { text } = vcalendarToIcs(
      vcal(
        "BEGIN:VEVENT",
        "UID:q",
        "DTSTART:20261105T090000Z",
        "SUMMARY;ENCODING=QUOTED-PRINTABLE:Lunch with=  ",
        " Anna",
        "END:VEVENT",
      ),
      { timeZone: "UTC" },
    );
    expect(text).toContain("SUMMARY:Lunch with Anna\r\n");
  });

  test("an all-day event written in UTC is the user's day, its exceptions and end dates too", () => {
    const { text } = vcalendarToIcs(
      vcal(
        "TZ:+03",
        "BEGIN:VEVENT",
        "UID:d",
        "DTSTART:20261109T210000Z",
        "DTEND:20261110T210000Z",
        "RRULE:D1 20261115T210000Z",
        "EXDATE:20261111T210000Z",
        "X-MICROSOFT-CDO-ALLDAYEVENT:TRUE",
        "END:VEVENT",
      ),
      { timeZone: "Europe/Moscow" },
    );
    expect(text).toContain("DTSTART;VALUE=DATE:20261110");
    expect(text).toContain("DTEND;VALUE=DATE:20261111");
    expect(text).toContain("EXDATE;VALUE=DATE:20261112");
    expect(text).toContain("RRULE:FREQ=DAILY;UNTIL=20261116");
  });

  test("an alarm with no start: a task's before its due time; else in UTC, or named", () => {
    const { text, notImported } = vcalendarToIcs(
      vcal(
        "BEGIN:VTODO",
        "UID:t",
        "DUE:20261120T120000Z",
        "DALARM:20261120T110000Z;;;Soon",
        "END:VTODO",
        "BEGIN:VEVENT",
        "UID:u",
        "DALARM:20261120T110000Z;;;Utc",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:f",
        "DALARM:20261120T110000;;;Floating",
        "END:VEVENT",
      ),
      { timeZone: "UTC" },
    );
    expect(text).toContain("TRIGGER;RELATED=END:-PT1H");
    expect(text).toContain("TRIGGER;VALUE=DATE-TIME:20261120T110000Z");
    expect(notImported).toEqual(["DALARM"]);
  });

  test("a component whose END never came is kept as far as it went, and named", () => {
    const { text, notImported } = vcalendarToIcs(
      vcal(
        "BEGIN:VEVENT",
        "UID:a",
        "DTSTART:20261105T090000Z",
        "BEGIN:VEVENT",
        "UID:b",
        "DTSTART:20261106T090000Z",
      ),
      { timeZone: "UTC" },
    );
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(text.match(/END:VEVENT/g)).toHaveLength(2);
    expect(notImported).toEqual(["VEVENT without END"]);
  });

  test("an escaped ; stays inside its value; a character past the BMP survives quoted-printable", () => {
    const { text } = vcalendarToIcs(
      vcal(
        "BEGIN:VEVENT",
        "UID:e",
        "DTSTART:20261105T090000Z",
        "CATEGORIES:A\\;B;C",
        "SUMMARY;ENCODING=QUOTED-PRINTABLE;CHARSET=UTF-8:Party \u{1F389}=20tonight",
        "DALARM:20261105T085000Z;;;Bring\\; chairs",
        "END:VEVENT",
      ),
      { timeZone: "UTC" },
    );
    expect(text).toContain("CATEGORIES:A\\;B,C\r\n");
    expect(text).toContain("SUMMARY:Party \u{1F389} tonight\r\n");
    expect(text).toContain("DESCRIPTION:Bring\\; chairs\r\n");
  });

  test("a component AstroTime does not read keeps its lines to itself, named once", () => {
    const { text, notImported } = vcalendarToIcs(
      vcal(
        "BEGIN:VJOURNAL",
        "UID:j",
        "SUMMARY:A note",
        "X-FOO:bar",
        "END:VJOURNAL",
        "BEGIN:VEVENT",
        "UID:e",
        "DTSTART:20261105T090000Z",
        "END:VEVENT",
      ),
      { timeZone: "UTC" },
    );
    expect(notImported).toEqual(["VJOURNAL"]);
    expect(text).not.toContain("X-FOO");
    expect(text.match(/END:VCALENDAR/g)).toHaveLength(1);
  });

  test("a file of a 2.0 calendar and a 1.0 one: each read by its own rules", async () => {
    const file = lines(
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "X-WR-CALNAME:Two",
      "BEGIN:VEVENT",
      "UID:two",
      "DTSTAMP:20261101T080000Z",
      "DTSTART;TZID=Europe/Vilnius:20261105T090000",
      "SUMMARY:Escaped\\, comma",
      "END:VEVENT",
      "END:VCALENDAR",
      "BEGIN:VCALENDAR",
      "VERSION:1.0",
      "BEGIN:VEVENT",
      "UID:one",
      "DTSTART:20261106T090000Z",
      "SUMMARY:Old phone",
      "END:VEVENT",
      "END:VCALENDAR",
    );
    const mixed = await readImport(
      { name: "mixed.ics", bytes: new TextEncoder().encode(file) },
      {
        language: "en",
        timeZone: "Europe/Vilnius",
        newUid: () => "x",
        pause: () => Promise.resolve(),
      },
    );
    const [two, one] = mixed.sources.map((source) => CalendarObject.parse(source.items[0]!.ics));
    expect(two!.master).toMatchObject({
      summary: "Escaped, comma",
      start: expect.objectContaining({ timeZone: "Europe/Vilnius" }),
    });
    expect(one!.master?.summary).toBe("Old phone");
    expect(mixed.sources[0]!.name).toBe("Two");
  });

  test("a month counted from the year's end has no place in iCalendar: the rule is named, the event kept", () => {
    const { text, notImported } = vcalendarToIcs(
      vcal("BEGIN:VEVENT", "UID:y", "DTSTART:20261105T090000Z", "RRULE:YM1 6- #2", "END:VEVENT"),
      { timeZone: "UTC" },
    );
    expect(text).not.toContain("RRULE");
    expect(text).toContain("UID:y");
    expect(notImported).toEqual(["RRULE"]);
    // A day of the month from its end is.
    expect(
      vcalendarToIcs(
        vcal("BEGIN:VEVENT", "UID:m", "DTSTART:20261105T090000Z", "RRULE:MD1 2- #2", "END:VEVENT"),
        { timeZone: "UTC" },
      ).text,
    ).toContain("RRULE:FREQ=MONTHLY;BYMONTHDAY=-2;COUNT=2");
  });
});
