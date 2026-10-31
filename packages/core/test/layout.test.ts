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
    const [placed] = layoutDay(
      occurrencesBetween(CalendarObject.parse(event("m", "20261102T090000Z", "20261102T100000Z")), {
        from: "2026-11-02",
        to: "2026-11-03",
        timeZone: "Europe/Vilnius",
      }),
      "2026-11-02",
      { timeZone: "Europe/Vilnius" },
    ).timed;
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

describe("from the review of #6", () => {
  test("a task with a date start and a timed due is a chip at the due, on that day only", () => {
    const ics = task("report", "DTSTART;VALUE=DATE:20261102\r\nDUE:20261104T150000Z\r\n");
    const monday = layoutDay(on("2026-11-02", "2026-11-03", ics), "2026-11-02", { timeZone });
    const wednesday = layoutDay(on("2026-11-04", "2026-11-05", ics), "2026-11-04", { timeZone });
    expect([monday.allDay.length, monday.timed.length]).toEqual([0, 0]);
    expect(wednesday.timed.map((p) => [p.shape, p.top])).toEqual([["chip", 900]]);
  });

  test("a task with only a timed start is a chip at the start (D42)", () => {
    expect(
      day(task("call", "DTSTART:20261102T110000Z\r\n")).timed.map((p) => [
        p.shape,
        p.top,
        p.bottom,
      ]),
    ).toEqual([["chip", 660, 690]]);
  });

  test("an occurrence that does not show on the day is left out", () => {
    const yesterday = on(
      "2026-11-01",
      "2026-11-02",
      event("y", "20261101T090000Z", "20261101T100000Z"),
    );
    const endedAtMidnight = on(
      "2026-11-01",
      "2026-11-02",
      event("z", "20261101T230000Z", "20261102T000000Z"),
    );
    expect(layoutDay([...yesterday, ...endedAtMidnight], "2026-11-02", { timeZone }).timed).toEqual(
      [],
    );
  });

  test("a zero-length event is drawn as the shortest block", () => {
    expect(
      brief(day(event("instant", "20261102T120000Z", "20261102T120000Z")).timed)[0],
    ).toMatchObject({ top: 720, bottom: 735 });
  });

  test("on a DST day the grid is the wall clock: 10:00 sits at 10:00", () => {
    // Vilnius leaves summer time at 04:00 on 25 Oct 2026; the day has 25 hours.
    const ics = vcal(
      "BEGIN:VEVENT\r\nUID:d\r\nDTSTART;TZID=Europe/Vilnius:20261025T100000\r\nDTEND;TZID=Europe/Vilnius:20261025T110000\r\nEND:VEVENT\r\n",
    );
    const options = { from: "2026-10-25", to: "2026-10-26", timeZone: "Europe/Vilnius" };
    const [placed] = layoutDay(
      occurrencesBetween(CalendarObject.parse(ics), options),
      "2026-10-25",
      { timeZone: "Europe/Vilnius" },
    ).timed;
    expect(placed).toMatchObject({ top: 600, bottom: 660 });
  });

  test("in the strip, events come before tasks of the same length, then by title", () => {
    const layout = day(
      task("b-task", "DUE;VALUE=DATE:20261102\r\n"),
      allDay("z-event", "20261102", "20261103"),
      allDay("a-event", "20261102", "20261103"),
    );
    expect(layout.allDay.map((o) => o.item.uid)).toEqual(["a-event", "z-event", "b-task"]);
  });

  test("the week's strip takes only all-day items, whatever it is given", () => {
    const week = ["2026-11-02", "2026-11-03"];
    const spans = layoutSpans(
      on(
        "2026-11-02",
        "2026-11-04",
        event("meeting", "20261102T090000Z", "20261102T100000Z"),
        allDay("off", "20261103", "20261104"),
      ),
      week,
      timeZone,
    );
    expect(spans.map((s) => s.occurrence.item.uid)).toEqual(["off"]);
  });
});

describe("from the second review of #6", () => {
  const vilnius = "Europe/Vilnius";
  const zoned = (uid: string, start: string, end: string) =>
    vcal(
      `BEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${uid}\r\nDTSTART;TZID=Europe/Vilnius:${start}\r\nDTEND;TZID=Europe/Vilnius:${end}\r\nEND:VEVENT\r\n`,
    );
  const strip = (ics: string, from: string, to: string) =>
    layoutDay(
      occurrencesBetween(CalendarObject.parse(ics), { from, to, timeZone: vilnius }),
      from,
      { timeZone: vilnius },
    ).allDay.length;

  test("the strip of a day holds only what covers that day", () => {
    const occurrences = on(
      "2026-11-01",
      "2026-11-05",
      allDay("before", "20261101", "20261102"),
      allDay("on", "20261102", "20261103"),
    );
    expect(
      layoutDay(occurrences, "2026-11-02", { timeZone }).allDay.map((o) => o.item.uid),
    ).toEqual(["on"]);
  });

  test("a day long across DST: midnight to midnight is all-day at 23 or 25 hours; 23 hours that are not a whole day are not", () => {
    expect(
      strip(zoned("autumn", "20261025T000000", "20261026T000000"), "2026-10-25", "2026-10-26"),
    ).toBe(1);
    expect(
      strip(zoned("spring", "20260329T000000", "20260330T000000"), "2026-03-29", "2026-03-30"),
    ).toBe(1);
    expect(
      strip(zoned("short", "20260329T100000", "20260330T090000"), "2026-03-29", "2026-03-30"),
    ).toBe(0);
  });

  test("a task's due date is its last day: Jun 1 to Jun 3 covers all three", () => {
    const ics = task("move", "DTSTART;VALUE=DATE:20270601\r\nDUE;VALUE=DATE:20270603\r\n");
    const days = ["2027-06-01", "2027-06-02", "2027-06-03", "2027-06-04"];
    const [span] = layoutSpans(on("2027-06-01", "2027-06-05", ics), days, timeZone);
    expect(span).toMatchObject({ firstDay: 0, lastDay: 2 });
    expect(on("2027-06-03", "2027-06-04", ics)).toHaveLength(1);
    expect(on("2027-06-04", "2027-06-05", ics)).toHaveLength(0);
  });

  test("the cascade is transitive: an item over one that is itself cascaded steps once more", () => {
    const timed = brief(
      day(
        event("a", "20261102T090000Z", "20261102T120000Z"),
        event("b", "20261102T093000Z", "20261102T103000Z"),
        event("c", "20261102T101500Z", "20261102T110000Z"),
        event("d", "20261102T104500Z", "20261102T113000Z"),
      ).timed,
    );
    // c sits on b (and a); d overlaps a and c but not b, and still goes one step past c.
    expect(timed.map((t) => [t.uid, t.left])).toEqual([
      ["a", 0],
      ["b", 0.15],
      ["c", 0.3],
      ["d", 0.45],
    ]);
  });
});
