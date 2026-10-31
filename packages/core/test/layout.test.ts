import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  layoutDay,
  layoutSpans,
  occurrencesBetween,
  type Occurrence,
} from "../src/index.ts";

const timeZone = "UTC";
const vcal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
const event = (uid: string, start: string, end: string) =>
  vcal(
    `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${uid}\r\nDTSTART:${start}\r\nDTEND:${end}\r\nEND:VEVENT\r\n`,
  );
const allDay = (uid: string, start: string, end: string) =>
  vcal(
    `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${uid}\r\nDTSTART;VALUE=DATE:${start}\r\nDTEND;VALUE=DATE:${end}\r\nEND:VEVENT\r\n`,
  );
const task = (uid: string, fields: string) =>
  vcal(`BEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:${uid}\r\n${fields}END:VTODO\r\n`);

function on(day: string, to: string, ...objects: string[]): Occurrence[] {
  return objects.flatMap((ics) =>
    occurrencesBetween(CalendarObject.parse(ics), { from: day, to, timeZone }),
  );
}
const day = (...objects: string[]) =>
  layoutDay(on("2026-11-02", "2026-11-03", ...objects), "2026-11-02", { timeZone });
const brief = (placed: ReturnType<typeof day>["timed"]) =>
  placed.map((p) => ({
    uid: p.occurrence.item.uid,
    top: p.top,
    bottom: p.bottom,
    left: p.left,
    width: p.width,
    layer: p.layer,
  }));

describe("which items go to the all-day strip (D14, D16, D42)", () => {
  test("all-day events, tasks due on a date, and timed items a day long or more; not chips or short blocks", () => {
    const layout = day(
      allDay("holiday", "20261102", "20261103"),
      task("date-task", "DUE;VALUE=DATE:20261102\r\n"),
      event("conference", "20261101T090000Z", "20261104T170000Z"),
      event("meeting", "20261102T090000Z", "20261102T100000Z"),
      task("chip", "DUE:20261102T150000Z\r\n"),
    );
    expect(layout.allDay.map((o) => o.item.uid)).toEqual(["conference", "holiday", "date-task"]);
    expect(layout.timed.map((p) => [p.occurrence.item.uid, p.shape])).toEqual([
      ["meeting", "block"],
      ["chip", "chip"],
    ]);
  });
});

describe("the time grid (D14, D16)", () => {
  test("a block sits at its minutes; a task with only a due time is a chip of 30 minutes at the due", () => {
    expect(
      brief(
        day(
          event("m", "20261102T091500Z", "20261102T104500Z"),
          task("t", "DUE:20261102T150000Z\r\n"),
        ).timed,
      ),
    ).toEqual([
      { uid: "m", top: 555, bottom: 645, left: 0, width: 1, layer: 0 },
      { uid: "t", top: 900, bottom: 930, left: 0, width: 1, layer: 0 },
    ]);
  });

  test("a task with a start and a due time is a block from one to the other", () => {
    const [placed] = day(
      task("work", "DTSTART:20261102T130000Z\r\nDUE:20261102T170000Z\r\n"),
    ).timed;
    expect(placed).toMatchObject({ shape: "block", top: 780, bottom: 1020 });
  });

  test("an item over midnight is clipped to the day and says it goes on", () => {
    const [placed] = day(event("night", "20261102T220000Z", "20261103T020000Z")).timed;
    expect(placed).toMatchObject({
      top: 1320,
      bottom: 1440,
      continuesBefore: false,
      continuesAfter: true,
    });
    const [morning] = layoutDay(
      on("2026-11-03", "2026-11-04", event("night", "20261102T220000Z", "20261103T020000Z")),
      "2026-11-03",
      { timeZone },
    ).timed;
    expect(morning).toMatchObject({
      top: 0,
      bottom: 120,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  test("an item ending exactly at midnight does not go on", () => {
    const [placed] = day(event("late", "20261102T230000Z", "20261103T000000Z")).timed;
    expect(placed).toMatchObject({ top: 1380, bottom: 1440, continuesAfter: false });
  });

  test("a very short block is drawn at least 15 minutes; a chip at the end of the day is lifted to fit", () => {
    expect(
      brief(day(event("blink", "20261102T100000Z", "20261102T100500Z")).timed)[0],
    ).toMatchObject({ top: 600, bottom: 615 });
    expect(brief(day(task("late", "DUE:20261102T235000Z\r\n")).timed)[0]).toMatchObject({
      top: 1410,
      bottom: 1440,
    });
  });

  test("the grid follows the user's zone", () => {
    const occurrences = on(
      "2026-11-02",
      "2026-11-03",
      event("m", "20261102T090000Z", "20261102T100000Z"),
    );
    const [placed] = layoutDay(
      occurrencesBetween(CalendarObject.parse(event("m", "20261102T090000Z", "20261102T100000Z")), {
        from: "2026-11-02",
        to: "2026-11-03",
        timeZone: "Europe/Vilnius",
      }),
      "2026-11-02",
      { timeZone: "Europe/Vilnius" },
    ).timed;
    expect(occurrences).toHaveLength(1);
    expect(placed).toMatchObject({ top: 660, bottom: 720 });
  });
});

describe("overlaps (D15)", () => {
  test("a later item over an earlier one is drawn on top, shifted right and narrower", () => {
    expect(
      brief(
        day(
          event("long", "20261102T090000Z", "20261102T120000Z"),
          event("inside", "20261102T100000Z", "20261102T110000Z"),
        ).timed,
      ),
    ).toEqual([
      { uid: "long", top: 540, bottom: 720, left: 0, width: 1, layer: 0 },
      { uid: "inside", top: 600, bottom: 660, left: 0.15, width: 0.85, layer: 1 },
    ]);
  });

  test("starting together, the shorter one goes on top", () => {
    const timed = brief(
      day(
        event("short", "20261102T090000Z", "20261102T093000Z"),
        event("long", "20261102T090000Z", "20261102T110000Z"),
      ).timed,
    );
    expect(timed.map((t) => [t.uid, t.layer, t.left])).toEqual([
      ["long", 0, 0],
      ["short", 1, 0.15],
    ]);
  });

  test("a cascade steps once per item under it, and items that do not overlap stay apart", () => {
    const timed = brief(
      day(
        event("a", "20261102T090000Z", "20261102T120000Z"),
        event("b", "20261102T093000Z", "20261102T113000Z"),
        event("c", "20261102T100000Z", "20261102T110000Z"),
        event("later", "20261102T130000Z", "20261102T140000Z"),
      ).timed,
    );
    expect(timed.map((t) => [t.uid, t.left])).toEqual([
      ["a", 0],
      ["b", 0.15],
      ["c", 0.3],
      ["later", 0],
    ]);
  });

  test("past three at once, the cluster switches to equal columns", () => {
    const timed = brief(
      day(
        event("a", "20261102T090000Z", "20261102T110000Z"),
        event("b", "20261102T090000Z", "20261102T110000Z"),
        event("c", "20261102T093000Z", "20261102T103000Z"),
        event("d", "20261102T100000Z", "20261102T120000Z"),
      ).timed,
    );
    expect(timed.every((t) => t.width === 0.25)).toBe(true);
    expect(new Set(timed.map((t) => t.left)).size).toBe(4);
  });

  test("an item freeing a column lets the next one take it", () => {
    const timed = brief(
      day(
        event("a", "20261102T090000Z", "20261102T100000Z"),
        event("b", "20261102T090000Z", "20261102T120000Z"),
        event("c", "20261102T090000Z", "20261102T120000Z"),
        event("d", "20261102T090000Z", "20261102T120000Z"),
        event("e", "20261102T100000Z", "20261102T110000Z"),
      ).timed,
    );
    const a = timed.find((t) => t.uid === "a")!;
    const e = timed.find((t) => t.uid === "e")!;
    expect(e.left).toBe(a.left);
  });
});

describe("the all-day strip across a week (D14, D42)", () => {
  const week = [
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ];
  const spans = (...objects: string[]) =>
    layoutSpans(on("2026-11-02", "2026-11-09", ...objects), week, timeZone).map((s) => ({
      uid: s.occurrence.item.uid,
      firstDay: s.firstDay,
      lastDay: s.lastDay,
      row: s.row,
      before: s.continuesBefore,
      after: s.continuesAfter,
    }));

  test("a span is one bar over its days; another takes the first row free on all of its days", () => {
    expect(
      spans(
        allDay("trip", "20261103", "20261106"),
        allDay("holiday", "20261104", "20261105"),
        allDay("free", "20261107", "20261108"),
      ),
    ).toEqual([
      { uid: "trip", firstDay: 1, lastDay: 3, row: 0, before: false, after: false },
      { uid: "free", firstDay: 5, lastDay: 5, row: 0, before: false, after: false },
      { uid: "holiday", firstDay: 2, lastDay: 2, row: 1, before: false, after: false },
    ]);
  });

  test("a span from last week into the next is cut at the edges and says so", () => {
    expect(spans(allDay("long", "20261030", "20261112"))).toEqual([
      { uid: "long", firstDay: 0, lastDay: 6, row: 0, before: true, after: true },
    ]);
  });

  test("a timed item a day or longer becomes a bar over the days it touches", () => {
    expect(spans(event("conference", "20261103T090000Z", "20261105T170000Z"))).toEqual([
      { uid: "conference", firstDay: 1, lastDay: 3, row: 0, before: false, after: false },
    ]);
  });
});
