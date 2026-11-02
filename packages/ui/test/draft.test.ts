import { CalendarObject, occurrencesBetween } from "@astrotime/core";
import { describe, expect, test, vi } from "vite-plus/test";

import { DRAFT, draftOf, drawn, placementOf, withDraft } from "../src/calendar/draft.ts";
import { formOf, newForm, type Form, type Target } from "../src/calendar/editing.ts";
import { expand, type Entry } from "../src/calendar/query.ts";

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
    const shown = withDraft(stored, draftOf(null, form, "Reminder"), range);
    const draft = shown.filter((entry) => entry.objectId === DRAFT);
    expect(draft).toHaveLength(1);
    expect(draft[0]!.calendarId).toBe("work");
    expect(draft[0]!.occurrence.item.summary).toBe("Planning");
    expect(wall(draft[0]!)).toBe("2026-11-05T16:00");
    // The stored items stay.
    expect(shown.filter((entry) => entry.objectId === "lunch-id")).toHaveLength(1);
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
    const shown = withDraft(stored, draftOf(target, form, "Reminder"), range);
    expect(shown.filter((entry) => entry.objectId === "lunch-id")).toEqual([]);
    const draft = shown.find((entry) => entry.objectId === DRAFT);
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
    const shown = withDraft(entries, draftOf(occurrence, form, "Reminder"), range);
    expect(shown.filter((entry) => entry.objectId === "daily")).toHaveLength(entries.length - 1);
    const draft = shown.find((entry) => entry.objectId === DRAFT);
    expect(wall(draft!)).toBe("2026-11-05T18:00");
  });

  test("a form whose times no item can hold yet draws nothing", () => {
    const form = {
      ...newForm("event", { calendarId: "work", day: "2026-11-05", minutes: 0, timeZone }),
      startDate: "",
    };
    expect(draftOf(null, form, "Reminder")).toBeNull();
  });

  test("a fault other than an item that cannot be made yet is told, and nothing is drawn", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const form = {
        ...newForm("event", { calendarId: "work", day: "2026-11-05", minutes: 0, timeZone }),
        // A zone `Intl` does not know: no item, and no reason the form can say.
        zone: "Nowhere/Never",
      };
      expect(draftOf(null, form, "Reminder")).toBeNull();
      expect(errors).toHaveBeenCalledTimes(1);
    } finally {
      errors.mockRestore();
    }
  });

  test("a form with no date yet draws nothing, and tells nothing", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const form = {
        ...newForm("event", { calendarId: "work", day: "2026-11-05", minutes: 0, timeZone }),
        endDate: "",
      };
      expect(draftOf(null, form, "Reminder")).toBeNull();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  test("an edited task that is done is drawn done", () => {
    const task = CalendarObject.parse(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VTODO",
        "UID:paid",
        "SUMMARY:Pay the rent",
        "DTSTART;TZID=Europe/Vilnius:20261104T090000",
        "STATUS:COMPLETED",
        "END:VTODO",
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
    const done: Target = {
      objectId: "paid",
      calendarId: "personal",
      object: task,
      recurrenceId: null,
      item: task.master!,
    };
    const form = formOf(done, timeZone, "2026-11-04");
    const drawnIn = withDraft([], draftOf(done, form, "Reminder"), range);
    expect(drawnIn.map((entry) => entry.done)).toEqual([true]);
  });

  test("a new item outside the days asked for is drawn on none of them", () => {
    const form = newForm("event", { calendarId: "work", day: "2026-12-01", minutes: 0, timeZone });
    expect(withDraft(stored, draftOf(null, form, "Reminder"), range)).toEqual(stored);
  });

  test("a new title renames the draft without expanding it again; its times make it anew", () => {
    const form = newForm("event", { calendarId: "work", day: "2026-11-05", minutes: 0, timeZone });
    const expanded = new Map<string, readonly Entry[]>();
    const made = draftOf(null, form, "Reminder");
    const first = drawn(made, "Planning", expanded)!.apply([], range);
    const second = drawn(made, "Planning with Olga", expanded)!.apply([], range);
    expect(expanded.size).toBe(1);
    expect(first.map((entry) => entry.occurrence.item.summary)).toEqual(["Planning"]);
    expect(second.map((entry) => entry.occurrence.item.summary)).toEqual(["Planning with Olga"]);
    // The title and the description are not where it is; its start is.
    expect(placementOf({ ...form, summary: "x", description: "y" })).toBe(placementOf(form));
    expect(placementOf({ ...form, startTime: "16:00" })).not.toBe(placementOf(form));
  });
});
