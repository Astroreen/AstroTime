import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  isDone,
  isUndoneBefore,
  latestUndoneBefore,
  occurrencesBetween,
} from "../src/index.ts";

const timeZone = "Europe/Vilnius";
const today = "2026-11-04";
const vcal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
const vtodo = (uid: string, fields: string) =>
  `BEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:${uid}\r\n${fields}END:VTODO\r\n`;
const task = (uid: string, fields: string) => CalendarObject.parse(vcal(vtodo(uid, fields)));
const latest = (object: CalendarObject) => latestUndoneBefore(object, today, timeZone);

describe("done tasks (D51)", () => {
  test("completed or cancelled is done; an event never is", () => {
    expect(isDone(task("a", "STATUS:COMPLETED\r\n").master!)).toBe(true);
    expect(isDone(task("b", "COMPLETED:20261101T100000Z\r\n").master!)).toBe(true);
    expect(isDone(task("c", "STATUS:CANCELLED\r\n").master!)).toBe(true);
    expect(isDone(task("d", "STATUS:NEEDS-ACTION\r\n").master!)).toBe(false);
    const event = CalendarObject.parse(
      vcal(
        "BEGIN:VEVENT\r\nUID:e\r\nDTSTART:20261101T100000Z\r\nSTATUS:COMPLETED\r\nEND:VEVENT\r\n",
      ),
    );
    expect(isDone(event.master!)).toBe(false);
  });
});

describe("undone tasks due before today roll over (D16, D51)", () => {
  test("a due date, a due time, the end of a start–due block, a start with no due: each before today counts", () => {
    expect(latest(task("date", "DUE;VALUE=DATE:20261103\r\n"))?.item.uid).toBe("date");
    expect(latest(task("time", "DUE:20261103T213000Z\r\n"))?.item.uid).toBe("time");
    expect(
      latest(task("block", "DTSTART:20261103T080000Z\r\nDUE:20261103T090000Z\r\n"))?.item.uid,
    ).toBe("block");
    expect(latest(task("start", "DTSTART:20261102T080000Z\r\n"))?.item.uid).toBe("start");
  });

  test("today's start in the user's zone is the line: due today, or a block ending today, does not count", () => {
    // 22:30 UTC on the 3rd is 00:30 on the 4th in Vilnius.
    expect(latest(task("late", "DUE:20261103T223000Z\r\n"))).toBeNull();
    expect(latest(task("today", "DUE;VALUE=DATE:20261104\r\n"))).toBeNull();
    expect(latest(task("over", "DTSTART:20261103T200000Z\r\nDUE:20261104T080000Z\r\n"))).toBeNull();
  });

  test("done tasks and tasks with no date do not count", () => {
    expect(latest(task("done", "DUE;VALUE=DATE:20261101\r\nSTATUS:COMPLETED\r\n"))).toBeNull();
    expect(latest(task("undated", ""))).toBeNull();
  });

  test("a recurring task counts once, by its latest undone occurrence; a completed exception is done", () => {
    const series = vtodo("daily", "DUE;VALUE=DATE:20261101\r\nRRULE:FREQ=DAILY\r\n");
    expect(latest(CalendarObject.parse(vcal(series)))?.recurrenceId).toEqual({
      type: "date",
      date: "2026-11-03",
    });
    const doneYesterday = vcal(
      series +
        vtodo(
          "daily",
          "RECURRENCE-ID;VALUE=DATE:20261103\r\nDUE;VALUE=DATE:20261103\r\nSTATUS:COMPLETED\r\n",
        ),
    );
    expect(latest(CalendarObject.parse(doneYesterday))?.recurrenceId).toEqual({
      type: "date",
      date: "2026-11-02",
    });
    const completedSeries = vtodo(
      "done-series",
      "DUE;VALUE=DATE:20261101\r\nRRULE:FREQ=DAILY\r\nSTATUS:COMPLETED\r\n",
    );
    expect(latest(CalendarObject.parse(vcal(completedSeries)))).toBeNull();
  });

  test("each occurrence is checked on its own, for the days that no longer show it", () => {
    const object = CalendarObject.parse(
      vcal(vtodo("weekly", "DUE;VALUE=DATE:20261028\r\nRRULE:FREQ=WEEKLY\r\n")),
    );
    const occurrences = occurrencesBetween(object, {
      from: "2026-10-26",
      to: "2026-11-09",
      timeZone,
    });
    expect(
      occurrences.map((occurrence) => isUndoneBefore(object, occurrence, today, timeZone)),
    ).toEqual([true, false]);
  });
});
