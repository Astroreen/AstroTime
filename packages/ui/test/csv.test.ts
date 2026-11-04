import { readFileSync } from "node:fs";

import { CalendarObject, type Event, type Task } from "@astrotime/core";
import { describe, expect, test } from "vite-plus/test";

import { splitCalendars } from "@astrotime/core/split";

import { csvToIcs, parseCsv } from "../src/import/csv.ts";
import { readImport } from "../src/import/read.ts";

const fixture = (name: string) => readFileSync(new URL(`fixtures/import/${name}`, import.meta.url));

async function items(name: string, language = "en") {
  const file = await readImport(
    { name, bytes: fixture(name) },
    { language, timeZone: "Europe/Vilnius", newUid: () => "x", pause: () => Promise.resolve() },
  );
  const [source] = file.sources;
  return {
    file,
    source: source!,
    objects: source!.items.map((item) => CalendarObject.parse(item.ics)),
  };
}

const vilnius = (y: number, m: number, d: number, h: number, mi = 0) =>
  // Vilnius is UTC+2 from the last Sunday of October.
  Date.UTC(y, m - 1, d, h - 2, mi);

describe("Google Calendar's CSV columns (import D266)", () => {
  test("timed and all-day events at the user's wall clock, the last day inclusive", async () => {
    const { source, objects } = await items("google.csv");
    expect(source.name).toBe("google");
    const [planning, offsite, dentist] = objects.map((object) => object.master as Event);
    expect(planning).toMatchObject({
      summary: "Planning",
      description: "Agenda: budget, hiring",
      location: "Room 4, second floor",
      start: expect.objectContaining({
        timeZone: "Europe/Vilnius",
        epochMs: vilnius(2026, 11, 5, 10),
      }),
      end: expect.objectContaining({ epochMs: vilnius(2026, 11, 5, 11, 30) }),
    });
    // Its last day is the 19th: it ends at the start of the 20th.
    expect(offsite).toMatchObject({
      start: { type: "date", date: "2026-11-18" },
      end: { type: "date", date: "2026-11-20" },
      location: "Riga",
    });
    expect(dentist!.classification).toBe("PRIVATE");
    // Each object defines the zone it names.
    expect(objects[0]!.serialize()).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/Vilnius");
    // The 18th tells month first.
    expect(source.dates).toEqual({ order: "mdy", guessed: false });
  });

  test("the same file twice gives the same UIDs, so a second import finds its items there", async () => {
    const first = await items("google.csv");
    const again = await items("google.csv");
    expect(again.source.items.map((item) => item.uid)).toEqual(
      first.source.items.map((item) => item.uid),
    );
    expect(new Set(first.source.items.map((item) => item.uid)).size).toBe(3);
  });
});

describe("Outlook's CSV export (import D266, D272)", () => {
  test("its columns: a reminder before the start, a guest by address, priority, the all-day flag", async () => {
    const { source, objects } = await items("outlook-calendar.csv");
    const review = objects[0]!.master as Event;
    expect(review).toMatchObject({
      summary: "Design review",
      description: "Bring the mock-ups.\nAnd the numbers.",
      categories: ["Work", "Design"],
      start: expect.objectContaining({ epochMs: vilnius(2026, 11, 4, 10) }),
    });
    expect(review.alarms[0]!.trigger).toMatchObject({ type: "relative", offsetSeconds: -900 });
    expect(review.attendees.map((a) => a.address)).toEqual(["mailto:marta@example.com"]);
    expect(objects[0]!.serialize()).toContain("PRIORITY:1");
    expect(objects[0]!.serialize()).toContain("RESOURCES:Room 4");
    const day = objects[1]!.master as Event;
    // Outlook's end is the day after: one day.
    expect(day).toMatchObject({
      start: { type: "date", date: "2026-11-10" },
      end: { type: "date", date: "2026-11-11" },
      transparent: true,
      classification: "PRIVATE",
    });
    // A guest by name alone, the organizer by name, the mileage: no place in iCalendar.
    expect(source.notImported.toSorted()).toEqual([
      "Meeting Organizer",
      "Mileage",
      "Required Attendees",
    ]);
  });

  test("in Russian: its column names, ';' between them, Windows-1251, day first", async () => {
    const { file, source, objects } = await items("outlook-calendar-ru.csv", "ru");
    expect(file.guessed).toBe("windows-1251");
    expect(source.dates).toEqual({ order: "dmy", guessed: false });
    const [meeting, holiday] = objects.map((object) => object.master as Event);
    expect(meeting).toMatchObject({
      summary: "Планёрка",
      location: "Переговорная 4",
      categories: ["Работа"],
      start: expect.objectContaining({ epochMs: vilnius(2026, 11, 5, 9) }),
    });
    expect(meeting!.alarms[0]!.trigger).toMatchObject({ offsetSeconds: -900 });
    expect(holiday).toMatchObject({
      summary: "Отпуск",
      description: "Без ноутбука",
      start: { type: "date", date: "2026-11-09" },
      end: { type: "date", date: "2026-11-14" },
      classification: "PRIVATE",
    });
    expect(objects[1]!.serialize()).toContain("PRIORITY:9");
  });

  test("its tasks: due, done, how far along, status", async () => {
    const { source, objects } = await items("outlook-tasks.csv");
    expect(source.items.map((item) => item.kind)).toEqual(["task", "task", "task"]);
    const [passport, report, flights] = objects.map((object) => object.master as Task);
    expect(passport).toMatchObject({
      summary: "Renew the passport",
      description: "Bring two photos.",
      due: { type: "date", date: "2026-11-20" },
      start: { type: "date", date: "2026-11-02" },
      status: "NEEDS-ACTION",
    });
    expect(passport!.alarms).toHaveLength(1);
    expect(report).toMatchObject({ status: "COMPLETED" });
    expect(report!.completed).not.toBeNull();
    expect(flights).toMatchObject({ status: "IN-PROCESS" });
    expect(objects[2]!.serialize()).toContain("PERCENT-COMPLETE:50");
    expect(source.notImported.toSorted()).toEqual(["Companies", "Total Work"]);
  });
});

describe("Thunderbird's CSV export", () => {
  test("Outlook's columns, read the same way", async () => {
    const { objects } = await items("thunderbird.csv");
    const [conference, call] = objects.map((object) => object.master as Event);
    expect(conference).toMatchObject({
      start: { type: "date", date: "2026-11-11" },
      end: { type: "date", date: "2026-11-14" },
      categories: ["Travel"],
    });
    expect(call).toMatchObject({
      start: expect.objectContaining({ epochMs: vilnius(2026, 11, 5, 15) }),
    });
    expect(call!.alarms[0]!.trigger).toMatchObject({ offsetSeconds: -600 });
  });
});

describe("a CSV's corners", () => {
  test("quotes, doubled quotes, line breaks in a cell, the delimiter it uses", () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\r\n1,2,3,4')).toEqual([
      ["a", "b, c", 'say "hi"', "two\nlines"],
      ["1", "2", "3", "4"],
    ]);
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("a day past 12 tells the order; a year first is ISO", () => {
    const of = (date: string) =>
      csvToIcs(`Subject,Start Date\nA,${date}\n`, { language: "en", timeZone: "UTC" }).dates;
    expect(of("25/12/2026")).toEqual({ order: "dmy", guessed: false });
    expect(of("12/25/2026")).toEqual({ order: "mdy", guessed: false });
    expect(of("2026-12-25")).toEqual({ order: "ymd", guessed: false });
  });

  test("a CSV of no calendar is said so", async () => {
    await expect(
      readImport(
        { name: "contacts.csv", bytes: new TextEncoder().encode("Name,Phone\nAnna,123\n") },
        { language: "en", timeZone: "UTC", newUid: () => "x", pause: () => Promise.resolve() },
      ),
    ).rejects.toThrow("is no calendar");
  });
});

describe("#153's review", () => {
  const convert = (text: string, timeZone = "Europe/Vilnius", language = "en") =>
    csvToIcs(text, { language, timeZone, now: Date.UTC(2026, 10, 4) });
  const objects = (text: string, timeZone = "Europe/Vilnius") =>
    splitCalendars(convert(text, timeZone).text, { newUid: () => "x" })[0]!.objects.map((o) =>
      CalendarObject.parse(o.ics),
    );
  const header = "Subject,Start Date,Start Time,End Date,End Time,All Day Event";

  test("a timed event's end: its end day kept with no end time; past midnight the next day", () => {
    const [long, night] = objects(
      [
        header,
        "Trip,11/05/2026,9:00 AM,11/07/2026,,False",
        "Party,11/05/2026,10:00 PM,,1:00 AM,False",
      ].join("\n"),
    ).map((object) => object.master as Event);
    expect(long!.end).toMatchObject({ epochMs: Date.UTC(2026, 10, 7, 7) });
    expect(night!.end).toMatchObject({ epochMs: Date.UTC(2026, 10, 5, 23) });
  });

  test("a start or end time that cannot be read is named; the day is kept", () => {
    const { notImported } = convert(
      [
        header,
        "Lunch,11/05/2026,noon,11/05/2026,,False",
        "Call,11/05/2026,9:00 AM,,later,False",
      ].join("\n"),
    );
    expect(notImported.toSorted()).toEqual(["End Time", "Start Time"]);
  });

  test("an all-day event's end: by the data first, then by columns only Outlook writes", () => {
    const day = (text: string) => (objects(text)[0]!.master as Event).end;
    // Ends the day it starts: the end date is its last day (Google's), even with Outlook's columns.
    expect(
      day(
        "Subject,Start Date,End Date,All day event,Reminder on/off\nA,11/05/2026,11/05/2026,True,False\nB,11/09/2026,11/10/2026,True,False",
      ),
    ).toEqual({ type: "date", date: "2026-11-06" });
    // Outlook's layout with its reminder columns left out of the export: Show time as is Outlook's alone.
    expect(
      day("Subject,Start Date,End Date,All day event,Show time as\nB,11/09/2026,11/10/2026,True,0"),
    ).toEqual({ type: "date", date: "2026-11-10" });
    // Google's columns, a two-day event: its last day named.
    expect(day("Subject,Start Date,End Date,All Day Event\nB,11/09/2026,11/10/2026,True")).toEqual({
      type: "date",
      date: "2026-11-11",
    });
  });

  test("a row given again is another item, its UID the same on every import", () => {
    const text = [
      header,
      "Stand-up,11/05/2026,9:00 AM,,9:15 AM,False",
      "Stand-up,11/05/2026,9:00 AM,,9:15 AM,False",
    ].join("\n");
    const uids = () => objects(text).map((object) => object.uid);
    expect(new Set(uids()).size).toBe(2);
    expect(uids()).toEqual(uids());
  });

  test("a lone CR in a cell stays a line break inside its value; DTSTAMP is the import's time", () => {
    const { text } = convert(`Subject,Start Date,Description\nA,11/05/2026,"one\rtwo"`);
    expect(text).toContain("DESCRIPTION:one\\ntwo\r\n");
    expect(text).toContain("DTSTAMP:20261104T000000Z");
  });

  test("a reminder before a change of offset is that many real hours before", () => {
    // Summer time begins in Vilnius at 03:00 on 28 March 2027: 22:00 the evening before is 11 real hours before 10:00.
    const [event] = objects(
      "Subject,Start Date,Start Time,End Date,End Time,Reminder on/off,Reminder Date,Reminder Time\nRun,3/28/2027,10:00 AM,3/28/2027,11:00 AM,True,3/27/2027,10:00 PM",
    );
    expect(event!.serialize()).toContain("TRIGGER:-PT11H");
  });

  test("the date order is read from the date's own token; a date it cannot read is named", () => {
    expect(convert("Subject,Start Date\nA,25/11/2026 10:00\n").dates).toEqual({
      order: "dmy",
      guessed: false,
    });
    const { notImported } = convert("Subject,Start Date\nA,5 Nov 2026\nB,11/05/2026\n");
    expect(notImported).toEqual(["Start Date"]);
  });
});
