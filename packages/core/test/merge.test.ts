import { describe, expect, test } from "vite-plus/test";

import {
  CalendarObject,
  differences,
  editItem,
  mergeObjects,
  sameObjects,
  zonedTime,
  type Event,
} from "../src/index.ts";
import { fixture } from "./support.ts";

const object = (fields: Record<string, string>, extra = "") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VEVENT\r\nUID:m\r\n${Object.entries(
    fields,
  )
    .map(([k, v]) => `${k}:${v}\r\n`)
    .join("")}END:VEVENT\r\n${extra}END:VCALENDAR\r\n`;

const base = {
  DTSTAMP: "20261101T080000Z",
  SEQUENCE: "1",
  DTSTART: "20261102T090000Z",
  DTEND: "20261102T100000Z",
  SUMMARY: "Planning",
  LOCATION: "Room 1",
};
const master = (ics: string) => CalendarObject.parse(ics).master as Event;

describe("mergeObjects (D6)", () => {
  test("changes to different fields on each side both land", () => {
    const local = object({
      ...base,
      DTSTAMP: "20261101T090000Z",
      SEQUENCE: "2",
      SUMMARY: "Planning (moved)",
    });
    const server = object({
      ...base,
      DTSTAMP: "20261101T085000Z",
      SEQUENCE: "2",
      LOCATION: "Room 7",
      "X-NC-GROUP-ID": "3",
    });
    const merged = mergeObjects(object(base), local, server);
    expect(merged.conflict).toBe(false);
    expect(master(merged.ics)).toMatchObject({
      summary: "Planning (moved)",
      location: "Room 7",
      sequence: 2,
    });
    expect(merged.ics).toContain("X-NC-GROUP-ID:3");
    expect(merged.ics).toContain("DTSTAMP:20261101T090000Z");
  });

  test("the same field changed on both sides differently keeps the server's and is a conflict", () => {
    const local = object({ ...base, SUMMARY: "Ours" });
    const server = object({ ...base, SUMMARY: "Theirs", LOCATION: "Room 2" });
    const merged = mergeObjects(object(base), local, server);
    expect(merged.conflict).toBe(true);
    expect(master(merged.ics)).toMatchObject({ summary: "Theirs", location: "Room 2" });
  });

  test("the same change on both sides is no conflict", () => {
    const changed = object({ ...base, SUMMARY: "Same" });
    expect(mergeObjects(object(base), changed, changed).conflict).toBe(false);
  });

  test("a field removed on one side is removed", () => {
    const { LOCATION: _, ...noLocation } = base;
    const merged = mergeObjects(
      object(base),
      object(noLocation),
      object({ ...base, SUMMARY: "Theirs" }),
    );
    expect(master(merged.ics)).toMatchObject({ summary: "Theirs", location: null });
    expect(merged.conflict).toBe(false);
  });

  test("alarms are one field", () => {
    const alarm = "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\n";
    const withAlarm = object(base).replace("END:VEVENT", `${alarm}END:VEVENT`);
    const merged = mergeObjects(object(base), withAlarm, object({ ...base, SUMMARY: "Theirs" }));
    expect(master(merged.ics).alarms).toHaveLength(1);
    expect(merged.conflict).toBe(false);
  });

  test("an exception added on our side joins the server's version", () => {
    const series = { ...base, RRULE: "FREQ=DAILY;COUNT=3" };
    const exception =
      "BEGIN:VEVENT\r\nUID:m\r\nRECURRENCE-ID:20261103T090000Z\r\nDTSTART:20261103T120000Z\r\nDTEND:20261103T130000Z\r\nSUMMARY:Moved\r\nEND:VEVENT\r\n";
    const merged = mergeObjects(
      object(series),
      object(series, exception),
      object({ ...series, LOCATION: "Room 3" }),
    );
    const result = CalendarObject.parse(merged.ics);
    expect(result.exceptions.map((e) => e.summary)).toEqual(["Moved"]);
    expect(result.master?.location).toBe("Room 3");
    expect(merged.conflict).toBe(false);
  });
});

describe("mergeObjects: sets and time zones (review of #4)", () => {
  const series = { ...base, RRULE: "FREQ=DAILY;COUNT=5" };

  test("EXDATEs added on both sides are combined, not a conflict", () => {
    const local = object({ ...series, EXDATE: "20261103T090000Z" });
    const server = object({ ...series, EXDATE: "20261105T090000Z" });
    const merged = mergeObjects(object(series), local, server);
    expect(merged.conflict).toBe(false);
    const exdates = merged.ics.split("\r\n").filter((line) => line.startsWith("EXDATE"));
    expect(exdates.toSorted()).toEqual(["EXDATE:20261103T090000Z", "EXDATE:20261105T090000Z"]);
  });

  test("a category removed here and one added there both apply", () => {
    const withTwo = object({ ...base, CATEGORIES: "Work" }).replace(
      "END:VEVENT",
      "CATEGORIES:Team\r\nEND:VEVENT",
    );
    const local = object({ ...base, CATEGORIES: "Work" });
    const server = withTwo.replace("END:VEVENT", "CATEGORIES:Q1\r\nEND:VEVENT");
    const merged = mergeObjects(withTwo, local, server);
    expect(merged.conflict).toBe(false);
    expect(master(merged.ics).categories.toSorted()).toEqual(["Q1", "Work"]);
  });

  test("a start moved into a zone the server's copy does not define brings its VTIMEZONE", () => {
    const vilnius =
      "BEGIN:VTIMEZONE\r\nTZID:Europe/Vilnius\r\nBEGIN:STANDARD\r\nDTSTART:19701025T040000\r\nTZOFFSETFROM:+0300\r\nTZOFFSETTO:+0200\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\nBEGIN:DAYLIGHT\r\nDTSTART:19700329T030000\r\nTZOFFSETFROM:+0200\r\nTZOFFSETTO:+0300\r\nRRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU\r\nEND:DAYLIGHT\r\nEND:VTIMEZONE\r\n";
    const { DTSTART: _s, DTEND: _e, ...rest } = base;
    const local = object(
      {
        ...rest,
        "DTSTART;TZID=Europe/Vilnius": "20261102T110000",
        "DTEND;TZID=Europe/Vilnius": "20261102T120000",
      },
      vilnius,
    );
    const merged = mergeObjects(object(base), local, object({ ...base, LOCATION: "Room 9" }));
    expect(merged.conflict).toBe(false);
    expect(master(merged.ics)).toMatchObject({
      location: "Room 9",
      start: {
        type: "zoned",
        timeZone: "Europe/Vilnius",
        epochMs: Date.parse("2026-11-02T09:00:00Z"),
      },
    });
    expect(merged.ics).toContain("BEGIN:VTIMEZONE");
  });

  test("an all-day change merges like any other", () => {
    const { DTSTART: _s, DTEND: _e, ...rest } = base;
    const local = object({
      ...rest,
      "DTSTART;VALUE=DATE": "20261102",
      "DTEND;VALUE=DATE": "20261103",
    });
    const merged = mergeObjects(object(base), local, object({ ...base, SUMMARY: "Theirs" }));
    expect(master(merged.ics)).toMatchObject({
      summary: "Theirs",
      start: { type: "date", date: "2026-11-02" },
    });
  });

  test("sameObjects ignores bookkeeping and order", () => {
    const a = object(base);
    const b = object({ ...base, DTSTAMP: "20261231T000000Z", SEQUENCE: "9" });
    expect(sameObjects(a, b)).toBe(true);
    expect(sameObjects(a, object({ ...base, SUMMARY: "Other" }))).toBe(false);
  });
});

test("attendees long enough to be folded merge as sets, not by their folded halves", () => {
  const attendee = (name: string) =>
    `ATTENDEE;CN="${name} with a name long enough to fold";CUTYPE=INDIVIDUAL;PARTSTAT=NEEDS-ACTION;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${name.toLowerCase()}@a-rather-long-domain.example.com`;
  const withOne = object(base).replace("END:VEVENT", `${attendee("Ada")}\r\nEND:VEVENT`);
  const local = withOne.replace("END:VEVENT", `${attendee("Bob")}\r\nEND:VEVENT`);
  const server = withOne.replace("END:VEVENT", `${attendee("Cy")}\r\nEND:VEVENT`);
  const merged = mergeObjects(withOne, local, server);
  expect(merged.conflict).toBe(false);
  expect(
    master(merged.ics)
      .attendees.map((a) => a.address)
      .toSorted(),
  ).toEqual([
    "mailto:ada@a-rather-long-domain.example.com",
    "mailto:bob@a-rather-long-domain.example.com",
    "mailto:cy@a-rather-long-domain.example.com",
  ]);
});

describe("mergeObjects: identities and time (fifth review of #4)", () => {
  const attendee = (who: string, partstat: string) =>
    `ATTENDEE;CN=${who};PARTSTAT=${partstat}:mailto:${who.toLowerCase()}@example.com`;
  const withAttendees = (...lines: string[]) =>
    object(base).replace("END:VEVENT", `${lines.join("\r\n")}\r\nEND:VEVENT`);

  test("one attendee's answer changed on one side replaces it, no duplicate", () => {
    const start = withAttendees(attendee("Ada", "NEEDS-ACTION"), attendee("Bob", "NEEDS-ACTION"));
    const local = withAttendees(attendee("Ada", "ACCEPTED"), attendee("Bob", "NEEDS-ACTION"));
    const server = withAttendees(attendee("Ada", "NEEDS-ACTION"), attendee("Bob", "DECLINED"));
    const merged = mergeObjects(start, local, server);
    expect(merged.conflict).toBe(false);
    expect(
      master(merged.ics)
        .attendees.map((a) => `${a.name}:${a.status}`)
        .toSorted(),
    ).toEqual(["Ada:ACCEPTED", "Bob:DECLINED"]);
  });

  test("the same attendee changed differently on both sides keeps the server's and is a conflict", () => {
    const start = withAttendees(attendee("Ada", "NEEDS-ACTION"));
    const merged = mergeObjects(
      start,
      withAttendees(attendee("Ada", "ACCEPTED")),
      withAttendees(attendee("Ada", "DECLINED")),
    );
    expect(merged.conflict).toBe(true);
    expect(master(merged.ics).attendees.map((a) => a.status)).toEqual(["DECLINED"]);
  });

  test("a start moved on one side and an end on the other is a conflict, not a time nobody chose", () => {
    const local = object({ ...base, DTSTART: "20261102T080000Z", DTEND: "20261102T090000Z" });
    const server = object({ ...base, DTEND: "20261102T110000Z" });
    const merged = mergeObjects(object(base), local, server);
    expect(merged.conflict).toBe(true);
    expect(master(merged.ics)).toMatchObject({
      start: { epochMs: Date.parse("2026-11-02T09:00:00Z") },
      end: { epochMs: Date.parse("2026-11-02T11:00:00Z") },
    });
  });

  test("a time moved on one side only moves as a whole", () => {
    const local = object({ ...base, DTSTART: "20261102T140000Z", DTEND: "20261102T150000Z" });
    const merged = mergeObjects(object(base), local, object({ ...base, SUMMARY: "Theirs" }));
    expect(merged.conflict).toBe(false);
    expect(master(merged.ics)).toMatchObject({
      summary: "Theirs",
      start: { epochMs: Date.parse("2026-11-02T14:00:00Z") },
      end: { epochMs: Date.parse("2026-11-02T15:00:00Z") },
    });
  });
});

test("values listed in one line merge one by one (EXDATE:a,b)", () => {
  const series = { ...base, RRULE: "FREQ=DAILY;COUNT=6" };
  const start = object({ ...series, EXDATE: "20261103T090000Z,20261104T090000Z" });
  const local = object({ ...series, EXDATE: "20261103T090000Z,20261104T090000Z,20261105T090000Z" });
  const server = object({ ...series, EXDATE: "20261104T090000Z" });
  const merged = mergeObjects(start, local, server);
  expect(merged.conflict).toBe(false);
  const exdates = merged.ics
    .split("\r\n")
    .filter((l) => l.startsWith("EXDATE"))
    .flatMap((l) => l.slice(7).split(","))
    .toSorted();
  // Theirs removed the 3rd, ours added the 5th; the 4th stays.
  expect(exdates).toEqual(["20261104T090000Z", "20261105T090000Z"]);
});

test("an exception spelled in another zone by the server is the same occurrence", () => {
  const series = { ...base, RRULE: "FREQ=DAILY;COUNT=3" };
  const vilnius =
    "BEGIN:VTIMEZONE\r\nTZID:Europe/Vilnius\r\nBEGIN:STANDARD\r\nDTSTART:19701025T040000\r\nTZOFFSETFROM:+0300\r\nTZOFFSETTO:+0200\r\nRRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n";
  const exception = (rid: string, summary: string) =>
    `BEGIN:VEVENT\r\nUID:m\r\n${rid}\r\nDTSTART:20261103T120000Z\r\nDTEND:20261103T130000Z\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\n`;
  const start = object(series, exception("RECURRENCE-ID:20261103T090000Z", "Moved"));
  const local = object(series, exception("RECURRENCE-ID:20261103T090000Z", "Moved (ours)"));
  // The server wrote the same instance in local time: 11:00 in Vilnius is 09:00 UTC.
  const server = object(
    series,
    exception("RECURRENCE-ID;TZID=Europe/Vilnius:20261103T110000", "Moved") + vilnius,
  );
  const merged = CalendarObject.parse(mergeObjects(start, local, server).ics);
  expect(merged.exceptions.map((e) => e.summary)).toEqual(["Moved (ours)"]);
});

describe("the fields two versions differ in, for the Conflicts list (D6)", () => {
  const now = Date.parse("2026-11-04T08:40:00Z");
  const vilnius = (local: string) => zonedTime(local, "Europe/Vilnius");

  test("the title, the time and the reminders by name; bookkeeping aside", () => {
    const source = fixture("nextcloud-web-event-timed.ics");
    const ours = editItem(
      CalendarObject.parse(source),
      {
        summary: "Planning v2",
        time: { start: vilnius("2026-11-16T12:00:00"), end: vilnius("2026-11-16T13:00:00") },
        alarms: { remove: [], add: [{ relatedTo: "start", offsetSeconds: -600 }] },
      },
      { now },
    ).ics;
    expect(differences(source, ours)).toEqual(["alarms", "summary", "time"]);
    expect(differences(source, CalendarObject.parse(source).serialize())).toEqual([]);
  });

  test("an exception added, changed or gone is a difference in the occurrences", () => {
    const source = fixture("nextcloud-web-event-recurring.ics");
    const ours = editItem(
      CalendarObject.parse(source),
      { summary: "Standup v2" },
      { now, scope: "this", recurrenceId: vilnius("2026-11-23T09:00:00") },
    ).ics;
    expect(differences(source, ours)).toEqual(["occurrences"]);
  });
});
