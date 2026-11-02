import { CalendarObject, occurrencesBetween } from "@astrotime/core";
import { describe, expect, test } from "vite-plus/test";

import { DRAFT, draftOf, withDraft } from "../src/calendar/draft.ts";
import { formOf, newForm, type Form, type Target } from "../src/calendar/editing.ts";
import { expand } from "../src/calendar/query.ts";

const timeZone = "Europe/Vilnius";
const range = { from: "2026-11-02", to: "2026-11-09", timeZone };
const lunch = CalendarObject.parse(
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:lunch",
    "SUMMARY:Lunch",
    "DTSTART;TZID=Europe/Vilnius:20261104T130000",
    "DTEND;TZID=Europe/Vilnius:20261104T140000",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n"),
);
const stored = expand(lunch, { id: "lunch-id", calendarId: "personal" }, range);
const target: Target = {
  objectId: "lunch-id",
  calendarId: "personal",
  object: lunch,
  recurrenceId: null,
  item: lunch.master!,
};
const wall = (entry: { occurrence: { start: unknown } }) =>
  JSON.stringify(entry.occurrence.start).match(/\d{4}-\d\d-\d\dT\d\d:\d\d/)?.[0];

describe("the edit dialog's item drawn behind it (design D155)", () => {
  test("a new event is drawn where the form puts it, under its title, in its calendar", () => {
    const form = {
      ...newForm("event", {
        calendarId: "work",
        day: "2026-11-05",
        minutes: 0,
        at: 16 * 60,
        timeZone,
      }),
      summary: "Planning",
    };
    const drawn = withDraft(stored, draftOf(null, form, "Reminder"), range);
    const draft = drawn.filter((entry) => entry.objectId === DRAFT);
    expect(draft).toHaveLength(1);
    expect(draft[0]!.calendarId).toBe("work");
    expect(draft[0]!.occurrence.item.summary).toBe("Planning");
    expect(wall(draft[0]!)).toBe("2026-11-05T16:00");
    // The stored items stay.
    expect(drawn.filter((entry) => entry.objectId === "lunch-id")).toHaveLength(1);
  });

  test("a new event that repeats is drawn on each of its days", () => {
    const form: Form = {
      ...newForm("event", {
        calendarId: "work",
        day: "2026-11-02",
        minutes: 0,
        at: 9 * 60,
        timeZone,
      }),
      repeat: {
        frequency: "DAILY",
        interval: 1,
        weekdays: [],
        monthlyWeekday: null,
        end: { type: "never" },
      },
    };
    const draft = draftOf(null, form, "Reminder");
    expect(withDraft([], draft, range)).toHaveLength(7);
  });

  test("an edited event is drawn at its new place instead of its old one", () => {
    const form = {
      ...formOf(target, timeZone, "2026-11-04"),
      startTime: "16:30",
      endTime: "17:30",
    };
    const drawn = withDraft(stored, draftOf(target, form, "Reminder"), range);
    expect(drawn.filter((entry) => entry.objectId === "lunch-id")).toEqual([]);
    const draft = drawn.find((entry) => entry.objectId === DRAFT);
    expect(wall(draft!)).toBe("2026-11-04T16:30");
    expect(draft!.occurrence.item.summary).toBe("Lunch");
  });

  test("an edited occurrence of a series leaves only its own place", () => {
    const daily = CalendarObject.parse(
      lunch.serialize().replace("SUMMARY:Lunch", "SUMMARY:Lunch\r\nRRULE:FREQ=DAILY"),
    );
    const entries = expand(daily, { id: "daily", calendarId: "personal" }, range);
    const thursday = occurrencesBetween(daily, {
      from: "2026-11-05",
      to: "2026-11-06",
      timeZone,
    })[0]!;
    const occurrence: Target = {
      objectId: "daily",
      calendarId: "personal",
      object: daily,
      recurrenceId: thursday.recurrenceId,
      item: thursday.item,
    };
    const form = {
      ...formOf(occurrence, timeZone, "2026-11-04"),
      startTime: "18:00",
      endTime: "19:00",
    };
    const drawn = withDraft(entries, draftOf(occurrence, form, "Reminder"), range);
    expect(drawn.filter((entry) => entry.objectId === "daily")).toHaveLength(entries.length - 1);
    const draft = drawn.find((entry) => entry.objectId === DRAFT);
    expect(wall(draft!)).toBe("2026-11-05T18:00");
  });

  test("a form whose times no item can hold yet draws nothing", () => {
    const form = {
      ...newForm("event", { calendarId: "work", day: "2026-11-05", minutes: 0, timeZone }),
      startDate: "",
    };
    expect(draftOf(null, form, "Reminder")).toBeNull();
  });
});
