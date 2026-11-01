import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  completeTask,
  isDone,
  latestUndoneBefore,
  occurrencesBetween,
  starTask,
  type Task,
} from "../src/index.ts";
import { fixture } from "./support.ts";

const NOW = Date.parse("2026-11-04T08:40:00Z");
const STAMP = "20261104T084000Z";
const timeZone = "Europe/Vilnius";

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

describe("completing a task writes what Nextcloud Tasks writes, and nothing else (D52, D7)", () => {
  const source = fixture("nextcloud-task-subtask.ics");

  test("completed: STATUS, COMPLETED and PERCENT-COMPLETE; every other line byte for byte", () => {
    const written = completeTask(CalendarObject.parse(source), true, { now: NOW });
    expect(written).toBe(
      edit(source, [
        ["LAST-MODIFIED:20261030T083000Z", `LAST-MODIFIED:${STAMP}`],
        ["DTSTAMP:20261030T083000Z", `DTSTAMP:${STAMP}`],
        ["PERCENT-COMPLETE:40", "PERCENT-COMPLETE:100"],
        ["STATUS:IN-PROCESS", "STATUS:COMPLETED"],
        // A new property goes after the others, before the alarm.
        ["BEGIN:VALARM", `COMPLETED:${STAMP}\r\nBEGIN:VALARM`],
      ]),
    );
    expect(isDone(CalendarObject.parse(written).master!)).toBe(true);
  });

  test("not completed again: NEEDS-ACTION, no COMPLETED, PERCENT-COMPLETE:0", () => {
    const completed = completeTask(CalendarObject.parse(source), true, { now: NOW });
    const later = NOW + 60_000;
    const written = completeTask(CalendarObject.parse(completed), false, { now: later });
    expect(written).toBe(
      edit(completed, [
        [`LAST-MODIFIED:${STAMP}`, "LAST-MODIFIED:20261104T084100Z"],
        [`DTSTAMP:${STAMP}`, "DTSTAMP:20261104T084100Z"],
        ["PERCENT-COMPLETE:100", "PERCENT-COMPLETE:0"],
        ["STATUS:COMPLETED", "STATUS:NEEDS-ACTION"],
        [`COMPLETED:${STAMP}`, null],
      ]),
    );
    expect(isDone(CalendarObject.parse(written).master!)).toBe(false);
  });

  test("unknown properties and parameters, alarms and the parent survive untouched", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Example Corp.//Some Client 1.0//EN",
      "BEGIN:VTODO",
      "UID:unknowns",
      "DTSTAMP:20261001T000000Z",
      "SUMMARY;X-LANG-HINT=ru:Купить подарок",
      "DUE;VALUE=DATE:20261104",
      "PRIORITY:2",
      "RELATED-TO;RELTYPE=PARENT:the-parent",
      'X-OTHER-CLIENT;X-PARAM="a;b":keep me',
      "X-APPLE-SORT-ORDER:12",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER;VALUE=DATE-TIME:20261104T070000Z",
      "X-WR-ALARMUID:alarm-1",
      "END:VALARM",
      "END:VTODO",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    // The source is written as ical.js writes it, so equal text is no accident.
    expect(CalendarObject.parse(ics).serialize()).toBe(ics);
    const completed = completeTask(CalendarObject.parse(ics), true, { now: NOW });
    const starred = starTask(CalendarObject.parse(completed), true, NOW);
    expect(starred).toBe(
      edit(ics, [
        ["DTSTAMP:20261001T000000Z", `DTSTAMP:${STAMP}`],
        [
          "X-APPLE-SORT-ORDER:12",
          `X-APPLE-SORT-ORDER:12\r\nSTATUS:COMPLETED\r\nCOMPLETED:${STAMP}\r\nPERCENT-COMPLETE:100\r\nLAST-MODIFIED:${STAMP}\r\nX-ASTROTIME-STARRED:TRUE`,
        ],
      ]),
    );
  });
});

describe("starring (D52)", () => {
  test("stars with X-ASTROTIME-STARRED, unstars by removing it; PRIORITY stays", () => {
    const source = fixture("nextcloud-task-subtask.ics");
    const starred = starTask(CalendarObject.parse(source), true, NOW);
    const task = CalendarObject.parse(starred).master as Task;
    expect(task).toMatchObject({ starred: true, priority: 1 });
    const unstarred = starTask(CalendarObject.parse(starred), false, NOW);
    expect(unstarred).not.toContain("X-ASTROTIME-STARRED");
    expect((CalendarObject.parse(unstarred).master as Task).starred).toBe(false);
    expect(unstarred).toBe(
      edit(source, [
        ["LAST-MODIFIED:20261030T083000Z", `LAST-MODIFIED:${STAMP}`],
        ["DTSTAMP:20261030T083000Z", `DTSTAMP:${STAMP}`],
      ]),
    );
  });
});

describe("one occurrence of a series is completed in its exception", () => {
  const series = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    "BEGIN:VTODO",
    "UID:weekly",
    "DTSTAMP:20261001T000000Z",
    "SUMMARY:Take out the recycling",
    "DTSTART;TZID=Europe/Vilnius:20261020T090000",
    "DUE;TZID=Europe/Vilnius:20261020T100000",
    "RRULE:FREQ=WEEKLY",
    "X-OTHER-CLIENT:kept",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT15M",
    "END:VALARM",
    "END:VTODO",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const range = { from: "2026-10-19", to: "2026-11-10", timeZone };
  const occurrenceOn = (object: CalendarObject, day: string) =>
    occurrencesBetween(object, range).find(
      (o) => o.recurrenceId!.type === "zoned" && o.recurrenceId!.local.startsWith(day),
    )!;

  test("the occurrence gets an exception at its own time; the series is untouched", () => {
    const object = CalendarObject.parse(series);
    const second = occurrenceOn(object, "2026-10-27");
    const written = completeTask(object, true, { now: NOW, recurrenceId: second.recurrenceId });
    // The master's lines come first, unchanged.
    expect(written.startsWith(series.slice(0, series.indexOf("END:VCALENDAR")))).toBe(true);
    const exception = written.slice(written.lastIndexOf("BEGIN:VTODO"));
    expect(exception).toContain("DTSTART;TZID=Europe/Vilnius:20261027T090000\r\n");
    expect(exception).toContain("DUE;TZID=Europe/Vilnius:20261027T100000\r\n");
    expect(exception).toContain("RECURRENCE-ID;TZID=Europe/Vilnius:20261027T090000\r\n");
    expect(exception).toContain("X-OTHER-CLIENT:kept\r\n");
    expect(exception).toContain("TRIGGER:-PT15M\r\n");
    expect(exception).not.toContain("RRULE");

    const after = CalendarObject.parse(written);
    expect(after.exceptions).toHaveLength(1);
    const done = occurrencesBetween(after, range).map((o) => [
      o.recurrenceId!.type === "zoned" ? o.recurrenceId!.local : "",
      isDone(o.item),
    ]);
    expect(done).toEqual([
      ["2026-10-20T09:00:00", false],
      ["2026-10-27T09:00:00", true],
      ["2026-11-03T09:00:00", false],
    ]);
  });

  test("completing it again, or not, changes the same exception", () => {
    const object = CalendarObject.parse(series);
    const id = occurrenceOn(object, "2026-11-03").recurrenceId;
    const completed = CalendarObject.parse(
      completeTask(object, true, { now: NOW, recurrenceId: id }),
    );
    expect(latestUndoneBefore(completed, "2026-11-04", timeZone)?.recurrenceId).toMatchObject({
      local: "2026-10-27T09:00:00",
    });
    const reopened = CalendarObject.parse(
      completeTask(completed, false, { now: NOW, recurrenceId: id }),
    );
    expect(reopened.exceptions).toHaveLength(1);
    expect(reopened.exceptions[0]).toMatchObject({ status: "NEEDS-ACTION", completed: null });
    expect(latestUndoneBefore(reopened, "2026-11-04", timeZone)?.recurrenceId).toMatchObject({
      local: "2026-11-03T09:00:00",
    });
  });

  test("a series due on dates, as Tasks.org writes it: the exception is a date too", () => {
    const object = CalendarObject.parse(fixture("tasksorg-task-recurring.ics"));
    const occurrence = occurrencesBetween(object, {
      from: "2026-11-05",
      to: "2026-11-06",
      timeZone,
    })[0]!;
    const written = completeTask(object, true, { now: NOW, recurrenceId: occurrence.recurrenceId });
    const exception = written.slice(written.lastIndexOf("BEGIN:VTODO"));
    expect(exception).toContain("DUE;VALUE=DATE:20261105\r\n");
    expect(exception).toContain("DTSTART;VALUE=DATE:20261105\r\n");
    expect(exception).toContain("RECURRENCE-ID;VALUE=DATE:20261105\r\n");
  });
});
