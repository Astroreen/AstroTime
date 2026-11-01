import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  ExpansionLimitError,
  MAX_REMINDERS,
  remindersOf,
  soonestReminders,
  type Reminder,
} from "../src/index.ts";
import { load } from "./support.ts";

const timeZone = "Europe/Vilnius";
const vcal = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${body}END:VCALENDAR\r\n`;
const valarm = (fields: string) => `BEGIN:VALARM\r\n${fields}END:VALARM\r\n`;
const display = (trigger: string, extra = "") =>
  valarm(`ACTION:DISPLAY\r\nTRIGGER${trigger}\r\n${extra}`);
const vevent = (uid: string, fields: string) =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261001T000000Z\r\nSUMMARY:${uid}\r\n${fields}END:VEVENT\r\n`;
const vtodo = (uid: string, fields: string) =>
  `BEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261001T000000Z\r\nSUMMARY:${uid}\r\n${fields}END:VTODO\r\n`;
const parse = (body: string) => CalendarObject.parse(vcal(body));

/** A week from Wednesday, November 4, 2026, as the reminders' window asks. */
const week = { from: "2026-11-04", to: "2026-11-12", timeZone };
const reminders = (object: CalendarObject, range: Parameters<typeof remindersOf>[2] = week) =>
  remindersOf(object, "obj", range);
const firesAt = (object: CalendarObject, range?: Parameters<typeof remindersOf>[2]) =>
  reminders(object, range).map((reminder) => new Date(reminder.fireAt).toISOString());

describe("a relative trigger counts from the occurrence (D100)", () => {
  test("before an event's start: the reminder names its occurrence, times and title", () => {
    const object = parse(
      vevent(
        "standup",
        `DTSTART;TZID=Europe/Vilnius:20261105T100000\r\nDTEND;TZID=Europe/Vilnius:20261105T103000\r\n${display(":-PT15M")}`,
      ),
    );
    expect(reminders(object)).toEqual([
      {
        id: "obj/-/0/#0",
        objectId: "obj",
        uid: "standup",
        kind: "event",
        recurrenceId: null,
        fireAt: Date.parse("2026-11-05T07:45:00Z"),
        title: "standup",
        start: {
          type: "zoned",
          local: "2026-11-05T10:00:00",
          timeZone,
          epochMs: Date.parse("2026-11-05T08:00:00Z"),
        },
        end: {
          type: "zoned",
          local: "2026-11-05T10:30:00",
          timeZone,
          epochMs: Date.parse("2026-11-05T08:30:00Z"),
        },
        due: null,
      } satisfies Reminder,
    ]);
  });

  test("RELATED=END counts from an event's end, DTSTART + DURATION included; a positive offset fires after", () => {
    const end = parse(
      vevent(
        "end",
        `DTSTART:20261105T080000Z\r\nDTEND:20261105T090000Z\r\n${display(";RELATED=END:-PT5M")}`,
      ),
    );
    expect(firesAt(end)).toEqual(["2026-11-05T08:55:00.000Z"]);
    const duration = parse(
      vevent(
        "duration",
        `DTSTART:20261105T080000Z\r\nDURATION:PT2H\r\n${display(";RELATED=END:PT10M")}`,
      ),
    );
    expect(firesAt(duration)).toEqual(["2026-11-05T10:10:00.000Z"]);
  });

  test("an offset's days are days of the zone's wall clock; its hours are exact (RFC 5545 §3.3.6)", () => {
    // October 25, 2026 ends summer time in Vilnius: 09:00 that day is 07:00Z, the day before 06:00Z.
    const range = { from: "2026-10-23", to: "2026-10-26", timeZone };
    const object = (trigger: string) =>
      parse(vevent("dst", `DTSTART;TZID=Europe/Vilnius:20261025T090000\r\n${display(trigger)}`));
    expect(firesAt(object(":-P1D"), range)).toEqual(["2026-10-24T06:00:00.000Z"]);
    expect(firesAt(object(":-PT24H"), range)).toEqual(["2026-10-24T07:00:00.000Z"]);
    expect(firesAt(object(":-P1DT1H"), range)).toEqual(["2026-10-24T05:00:00.000Z"]);
  });

  test("a week's lead finds an occurrence after the window; one that fires outside it is left out", () => {
    const early = parse(
      vevent("early", `DTSTART:20261116T080000Z\r\n${display(":-P1W")}${display(":-PT1H")}`),
    );
    expect(firesAt(early)).toEqual(["2026-11-09T08:00:00.000Z"]);
  });
});

describe("all-day and floating items, in the user's zone (D100)", () => {
  test("a date counts from the start of its day in the user's zone: -PT15H is 09:00 the day before, PT9H 09:00 on the day", () => {
    const object = parse(
      vevent(
        "allday",
        `DTSTART;VALUE=DATE:20261106\r\nDTEND;VALUE=DATE:20261107\r\n${display(":-PT15H")}${display(":PT9H")}${display(":-PT15M")}`,
      ),
    );
    expect(firesAt(object)).toEqual([
      "2026-11-05T07:00:00.000Z",
      "2026-11-05T21:45:00.000Z",
      "2026-11-06T07:00:00.000Z",
    ]);
    // The same day in New York starts there.
    expect(firesAt(object, { ...week, timeZone: "America/New_York" })[0]).toBe(
      "2026-11-05T14:00:00.000Z",
    );
    expect(reminders(object)[0]).toMatchObject({
      start: { type: "date", date: "2026-11-06" },
      end: { type: "date", date: "2026-11-07" },
    });
  });

  test("on a DST day an all-day reminder keeps its wall clock: 09:00, not 10:00", () => {
    // March 28, 2027 starts summer time in Vilnius at 03:00.
    const range = { from: "2027-03-27", to: "2027-03-30", timeZone };
    const object = parse(
      vevent(
        "spring",
        `DTSTART;VALUE=DATE:20270328\r\n${display(":PT9H")}${display(";RELATED=START:P1DT9H")}`,
      ),
    );
    expect(firesAt(object, range)).toEqual([
      "2027-03-28T06:00:00.000Z",
      "2027-03-29T06:00:00.000Z",
    ]);
  });

  test("a floating time is read in the user's zone at computation", () => {
    const object = parse(vevent("floating", `DTSTART:20261106T090000\r\n${display(":-PT10M")}`));
    expect(firesAt(object)).toEqual(["2026-11-06T06:50:00.000Z"]);
    expect(firesAt(object, { ...week, timeZone: "Asia/Tokyo" })).toEqual([
      "2026-11-05T23:50:00.000Z",
    ]);
  });
});

describe("absolute triggers (D100)", () => {
  test("fire at their time, about their item; a floating one is read in the user's zone", () => {
    const object = parse(
      vevent(
        "absolute",
        `DTSTART:20261110T080000Z\r\n${display(";VALUE=DATE-TIME:20261105T060000Z")}${display(";VALUE=DATE-TIME:20261105T090000")}`,
      ),
    );
    expect(reminders(object).map((r) => [new Date(r.fireAt).toISOString(), r.start])).toEqual([
      ["2026-11-05T06:00:00.000Z", expect.objectContaining({ local: "2026-11-10T08:00:00" })],
      ["2026-11-05T07:00:00.000Z", expect.objectContaining({ local: "2026-11-10T08:00:00" })],
    ]);
  });

  test("on a series it fires once, about the series as a whole", () => {
    const object = parse(
      vevent(
        "series",
        `DTSTART:20261001T080000Z\r\nRRULE:FREQ=DAILY\r\n${display(";VALUE=DATE-TIME:20261105T060000Z")}`,
      ),
    );
    expect(reminders(object)).toEqual([
      expect.objectContaining({
        id: "obj/-/0/#0",
        recurrenceId: null,
        start: null,
        end: null,
        fireAt: Date.parse("2026-11-05T06:00:00Z"),
      }),
    ]);
  });
});

describe("which alarms notify (D100)", () => {
  test("DISPLAY and AUDIO notify, a missing ACTION reads as DISPLAY; EMAIL, NONE and others do not", () => {
    const at = (minutes: number) => `TRIGGER:-PT${minutes}M\r\n`;
    const object = parse(
      vevent(
        "actions",
        `DTSTART:20261105T080000Z\r\n${[
          valarm(`ACTION:DISPLAY\r\n${at(10)}`),
          valarm(`ACTION:AUDIO\r\n${at(20)}`),
          valarm(at(30)),
          valarm(`ACTION:EMAIL\r\n${at(40)}ATTENDEE:mailto:a@example.com\r\n`),
          valarm(`ACTION:NONE\r\n${at(50)}`),
          valarm(`ACTION:PROCEDURE\r\n${at(60)}`),
          valarm(`ACTION:X-SPEAK\r\n${at(70)}`),
        ].join("")}`,
      ),
    );
    expect(firesAt(object)).toEqual([
      "2026-11-05T07:30:00.000Z",
      "2026-11-05T07:40:00.000Z",
      "2026-11-05T07:50:00.000Z",
    ]);
  });

  test("REPEAT with DURATION fires again, each with its own id; REPEAT alone fires once", () => {
    const object = parse(
      vevent(
        "repeat",
        `DTSTART:20261105T080000Z\r\n${display(":-PT10M", "REPEAT:2\r\nDURATION:PT5M\r\n")}${display(":-PT1H", "REPEAT:3\r\n")}`,
      ),
    );
    expect(reminders(object).map((r) => [r.id, new Date(r.fireAt).toISOString()])).toEqual([
      ["obj/-/0/#1", "2026-11-05T07:00:00.000Z"],
      ["obj/-/0/#0", "2026-11-05T07:50:00.000Z"],
      ["obj/-/1/#0", "2026-11-05T07:55:00.000Z"],
      ["obj/-/2/#0", "2026-11-05T08:00:00.000Z"],
    ]);
  });

  test("two alarms of one occurrence at the same instant are one reminder", () => {
    const object = parse(
      vevent(
        "twice",
        `DTSTART:20261105T080000Z\r\n${display(":-PT15M")}${valarm("ACTION:AUDIO\r\nTRIGGER:-PT15M\r\n")}`,
      ),
    );
    expect(reminders(object).map((r) => r.id)).toEqual(["obj/-/0/#0"]);
    // Whatever their order, the same one stands for both.
    const swapped = parse(
      vevent(
        "twice",
        `DTSTART:20261105T080000Z\r\n${display(":-PT15M", "UID:z-last\r\n")}${display(":-PT15M", "UID:a-first\r\n")}`,
      ),
    );
    expect(reminders(swapped).map((r) => r.id)).toEqual(["obj/-/0/a-first"]);
  });

  test("an alarm's UID names it in the id, so reordering the alarms keeps the ids", () => {
    const object = parse(
      vevent("uid", `DTSTART:20261105T080000Z\r\n${display(":-PT15M", "UID:alarm-1\r\n")}`),
    );
    expect(reminders(object).map((r) => r.id)).toEqual(["obj/-/0/alarm-1"]);
  });
});

describe("acknowledged alarms (D100)", () => {
  test("Apple's ACKNOWLEDGED at the time it fires: it does not fire again", () => {
    // The fixture's alarm fires at 18:45Z and was acknowledged then.
    const apple = load("apple-event-attendees.ics");
    expect(reminders(apple, { from: "2026-11-05", to: "2026-11-07", timeZone })).toEqual([]);
  });

  test("on a series, the occurrences after the acknowledgement still fire; Thunderbird's X-MOZ-LASTACK counts as one", () => {
    const apple = parse(
      vevent(
        "daily",
        `DTSTART:20261104T080000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\n${display(":-PT15M", "ACKNOWLEDGED:20261105T080000Z\r\n")}`,
      ),
    );
    expect(firesAt(apple)).toEqual(["2026-11-06T07:45:00.000Z"]);
    const thunderbird = parse(
      vevent(
        "daily",
        `DTSTART:20261104T080000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nX-MOZ-LASTACK:20261104T074500Z\r\n${display(":-PT15M")}`,
      ),
    );
    expect(firesAt(thunderbird)).toEqual(["2026-11-05T07:45:00.000Z", "2026-11-06T07:45:00.000Z"]);
  });
});

describe("a series with exceptions (D35, D100)", () => {
  test("Nextcloud's weekly stand-up: an EXDATE has none, a moved exception without alarms has none", () => {
    const object = load("nextcloud-event-recurring.ics");
    const range = { from: "2026-10-19", to: "2026-11-16", timeZone };
    expect(reminders(object, range).map((r) => [new Date(r.fireAt).toISOString(), r.id])).toEqual([
      // 09:50 in summer time, then in winter time.
      ["2026-10-20T06:50:00.000Z", `obj/${Date.parse("2026-10-20T07:00:00Z")}/0/#0`],
      ["2026-11-10T07:50:00.000Z", `obj/${Date.parse("2026-11-10T08:00:00Z")}/0/#0`],
    ]);
  });

  test("an exception reminds by its own alarms, where it moved; a cancelled one not at all", () => {
    const object = parse(
      [
        vevent(
          "weekly",
          `DTSTART:20261104T080000Z\r\nDTEND:20261104T090000Z\r\nRRULE:FREQ=DAILY;COUNT=4\r\n${display(":-PT10M")}`,
        ),
        vevent(
          "weekly",
          `RECURRENCE-ID:20261105T080000Z\r\nDTSTART:20261105T120000Z\r\nDTEND:20261105T130000Z\r\n${display(":-PT30M")}`,
        ),
        vevent(
          "weekly",
          `RECURRENCE-ID:20261106T080000Z\r\nDTSTART:20261106T080000Z\r\nSTATUS:CANCELLED\r\n${display(":-PT10M")}`,
        ),
      ].join(""),
    );
    expect(
      reminders(object).map((r) => [new Date(r.fireAt).toISOString(), r.recurrenceId, r.start]),
    ).toEqual([
      [
        "2026-11-04T07:50:00.000Z",
        expect.objectContaining({ epochMs: Date.parse("2026-11-04T08:00:00Z") }),
        expect.objectContaining({ epochMs: Date.parse("2026-11-04T08:00:00Z") }),
      ],
      [
        "2026-11-05T11:30:00.000Z",
        expect.objectContaining({ epochMs: Date.parse("2026-11-05T08:00:00Z") }),
        expect.objectContaining({ epochMs: Date.parse("2026-11-05T12:00:00Z") }),
      ],
      [
        "2026-11-07T07:50:00.000Z",
        expect.objectContaining({ epochMs: Date.parse("2026-11-07T08:00:00Z") }),
        expect.objectContaining({ epochMs: Date.parse("2026-11-07T08:00:00Z") }),
      ],
    ]);
  });

  test("a cancelled event and a series too dense to expand", () => {
    const cancelled = parse(
      vevent("off", `DTSTART:20261105T080000Z\r\nSTATUS:CANCELLED\r\n${display(":-PT15M")}`),
    );
    expect(reminders(cancelled)).toEqual([]);
    const dense = parse(
      vevent("dense", `DTSTART:19900101T000000Z\r\nRRULE:FREQ=MINUTELY\r\n${display(":-PT1M")}`),
    );
    expect(() => reminders(dense)).toThrow(ExpansionLimitError);
  });
});

describe("tasks (D100)", () => {
  const due = "DUE;TZID=Europe/Vilnius:20261105T150000\r\n";

  test("with only a due, START relates to the due, as END does", () => {
    const object = parse(
      vtodo("due", `${due}${display(":-PT15M")}${display(";RELATED=END:-PT1H")}`),
    );
    expect(
      reminders(object).map((r) => [new Date(r.fireAt).toISOString(), r.start, r.due]),
    ).toEqual([
      ["2026-11-05T12:00:00.000Z", null, expect.objectContaining({ local: "2026-11-05T15:00:00" })],
      ["2026-11-05T12:45:00.000Z", null, expect.objectContaining({ local: "2026-11-05T15:00:00" })],
    ]);
    expect(reminders(object)[0]).toMatchObject({ kind: "task", end: null });
  });

  test("with a start and a due, START is the start and END the due; with only a start, both are the start", () => {
    const both = parse(
      vtodo(
        "both",
        `DTSTART;TZID=Europe/Vilnius:20261105T100000\r\n${due}${display(":-PT15M")}${display(";RELATED=END:-PT15M")}`,
      ),
    );
    expect(firesAt(both)).toEqual(["2026-11-05T07:45:00.000Z", "2026-11-05T12:45:00.000Z"]);
    const start = parse(
      vtodo(
        "start",
        `DTSTART;TZID=Europe/Vilnius:20261105T100000\r\n${display(";RELATED=END:-PT5M")}`,
      ),
    );
    expect(firesAt(start)).toEqual(["2026-11-05T07:55:00.000Z"]);
  });

  test("a due date is the task's own day: -PT15H is 09:00 the day before", () => {
    const object = parse(
      vtodo(
        "date",
        `DTSTART;VALUE=DATE:20261104\r\nDUE;VALUE=DATE:20261106\r\n${display(";RELATED=END:-PT15H")}`,
      ),
    );
    expect(reminders(object)).toEqual([
      expect.objectContaining({
        fireAt: Date.parse("2026-11-05T07:00:00Z"),
        start: { type: "date", date: "2026-11-04" },
        due: { type: "date", date: "2026-11-06" },
      }),
    ]);
  });

  test("completed and cancelled tasks do not remind, nor a completed occurrence of a series", () => {
    for (const status of [
      "STATUS:COMPLETED\r\n",
      "COMPLETED:20261101T000000Z\r\n",
      "STATUS:CANCELLED\r\n",
    ]) {
      expect(reminders(parse(vtodo("done", `${due}${status}${display(":-PT15M")}`)))).toEqual([]);
    }
    const series = parse(
      [
        vtodo("daily", `DUE:20261104T150000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\n${display(":-PT15M")}`),
        vtodo(
          "daily",
          `RECURRENCE-ID:20261105T150000Z\r\nDUE:20261105T150000Z\r\nSTATUS:COMPLETED\r\n${display(":-PT15M")}`,
        ),
      ].join(""),
    );
    expect(firesAt(series)).toEqual(["2026-11-04T14:45:00.000Z", "2026-11-06T14:45:00.000Z"]);
  });

  test("an undated task reminds by an absolute trigger only, about no time", () => {
    const object = parse(
      vtodo("undated", `${display(";VALUE=DATE-TIME:20261105T060000Z")}${display(":-PT15M")}`),
    );
    expect(reminders(object)).toEqual([
      expect.objectContaining({
        fireAt: Date.parse("2026-11-05T06:00:00Z"),
        start: null,
        due: null,
      }),
    ]);
  });

  test("Nextcloud Tasks: an hour before the due", () => {
    const object = load("nextcloud-task-subtask.ics");
    expect(firesAt(object, { from: "2026-11-05", to: "2026-11-08", timeZone })).toEqual([
      "2026-11-06T15:00:00.000Z",
    ]);
  });
});

describe("the set a platform is handed (android D60)", () => {
  const at = (id: string, fireAt: number) => ({ id, fireAt }) as Reminder;

  test("from now on, within the horizon, the soonest first and ties by id, at most 100", () => {
    const now = Date.parse("2026-11-04T08:40:00Z");
    const set = soonestReminders(
      [
        at("b", now + 60_000),
        at("passed", now - 1),
        at("a", now + 60_000),
        at("now", now),
        at("week", now + 7 * 86_400_000),
      ],
      now,
    );
    expect(set.map((reminder) => reminder.id)).toEqual(["now", "a", "b"]);
    const many = Array.from({ length: 150 }, (_, i) =>
      at(`r${String(i).padStart(3, "0")}`, now + i),
    );
    const capped = soonestReminders(many.toReversed(), now);
    expect(capped).toHaveLength(MAX_REMINDERS);
    expect(capped.at(-1)?.id).toBe("r099");
  });

  test("the ids are the same however the window is cut", () => {
    const object = load("nextcloud-web-event-reminder.ics");
    const a = reminders(object, { from: "2026-11-12", to: "2026-11-20", timeZone });
    const b = reminders(object, { from: "2026-11-19", to: "2026-11-20", timeZone });
    expect(a).toEqual(b);
    expect(a.map((r) => [r.id, new Date(r.fireAt).toISOString()])).toEqual([
      ["obj/-/0/#0", "2026-11-19T13:45:00.000Z"],
    ]);
  });
});
