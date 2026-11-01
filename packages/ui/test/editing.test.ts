// The edit dialog's logic without React (docs/plans/foundation.md#D9–D11, D6):
// the form an item opens with, the changes a form makes (only what the user
// changed), the scopes offered, the writes to the local store, the words of
// rules and reminders, and the Conflicts list's two ways out.
import { CalendarObject, occurrencesBetween, type Event } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import { applyMine, conflictViews, keepServer } from "../src/calendar/conflicts.ts";
import {
  changesOf,
  deleteTarget,
  formOf,
  newForm,
  problemOf,
  saveForm,
  scopesFor,
  timesOfForm,
  withStartDate,
  type Target,
} from "../src/calendar/editing.ts";
import { Formats } from "../src/calendar/format.ts";
import { alarmWords, repeatWords } from "../src/calendar/words.ts";
import { loadDemo } from "../src/demo/index.ts";
import { createI18n } from "../src/i18n/index.ts";

const timeZone = "Europe/Vilnius";
const NOW = Date.parse("2026-11-04T10:40:00+02:00");

async function demo() {
  const store = await Store.open(nodeDriver());
  await loadDemo(store, { languages: ["en-US"], timeZone, now: NOW });
  const calendars = await store.calendars();
  const byName = (name: string) => calendars.find((c) => c.name === name)!;
  const rowOf = async (calendar: string, uid: string) =>
    (await store.objectAt(byName(calendar).id, `${uid}.ics`))!;
  return { store, byName, rowOf };
}

/** The target a tap on the occurrence on `day` opens. */
async function targetOn(
  store: Store,
  row: { id: string; calendarId: string; ics: string },
  day: string,
) {
  const object = CalendarObject.parse(row.ics);
  const occurrence = occurrencesBetween(object, {
    from: day,
    to: `${day.slice(0, 8)}${String(Number(day.slice(8)) + 1).padStart(2, "0")}`,
    timeZone,
  })[0]!;
  void store;
  return {
    objectId: row.id,
    calendarId: row.calendarId,
    object,
    recurrenceId: occurrence.recurrenceId,
    item: occurrence.item,
  } satisfies Target;
}

const uids = (() => {
  let n = 0;
  return () => `uid-${++n}`;
})();

describe("the form", () => {
  test("a new event from the next half hour, an hour long; a tapped slot from there", () => {
    const options = { calendarId: "c", day: "2026-11-04", minutes: 10 * 60 + 40, timeZone };
    expect(newForm("event", options)).toMatchObject({
      startDate: "2026-11-04",
      startTime: "11:00",
      endDate: "2026-11-04",
      endTime: "12:00",
      allDay: false,
      zone: timeZone,
    });
    expect(newForm("event", { ...options, minutes: 23 * 60 + 40 })).toMatchObject({
      startDate: "2026-11-05",
      startTime: "00:00",
    });
    expect(newForm("event", { ...options, at: 14 * 60 + 30 })).toMatchObject({
      startTime: "14:30",
      endTime: "15:30",
    });
    expect(newForm("task", { ...options, day: null })).toMatchObject({
      startDate: "",
      endDate: "",
      allDay: true,
    });
  });

  test("an item opens with its own times in its zone; a UTC time in the user's, kept UTC", async () => {
    const { store, rowOf } = await demo();
    const review = await rowOf("Work", "demo-review");
    const form = formOf(await targetOn(store, review, "2026-11-04"), timeZone);
    expect(form).toMatchObject({
      summary: "Design review",
      startTime: "10:00",
      endTime: "11:30",
      zone: timeZone,
      utc: false,
      location: "Room 4, second floor",
    });
    expect(form.alarms).toHaveLength(1);

    const object = CalendarObject.parse(
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VTODO\r\nUID:utc\r\nDTSTAMP:20261101T000000Z\r\nDUE:20261120T080000Z\r\nEND:VTODO\r\nEND:VCALENDAR\r\n",
    );
    const utc = formOf(
      { objectId: "x", calendarId: "c", object, recurrenceId: null, item: object.master! },
      timeZone,
    );
    expect(utc).toMatchObject({ endDate: "2026-11-20", endTime: "10:00", utc: true });
    expect(timesOfForm({ ...utc, endTime: "11:00" }).end).toMatchObject({
      type: "zoned",
      timeZone: "UTC",
      local: "2026-11-20T09:00:00",
    });
  });

  test("an all-day event's last day is the day before its DTEND", async () => {
    const { store, rowOf } = await demo();
    const conference = await rowOf("Work", "demo-conference");
    const form = formOf(await targetOn(store, conference, "2026-11-05"), timeZone);
    expect(form).toMatchObject({ allDay: true, startDate: "2026-11-05", endDate: "2026-11-07" });
    expect(timesOfForm(form)).toEqual({
      start: { type: "date", date: "2026-11-05" },
      end: { type: "date", date: "2026-11-08" },
    });
  });

  test("changes hold only what the user changed", async () => {
    const { store, rowOf } = await demo();
    const target = await targetOn(store, await rowOf("Work", "demo-review"), "2026-11-04");
    const initial = formOf(target, timeZone);
    expect(changesOf(initial, initial)).toEqual({});
    expect(changesOf(initial, { ...initial, summary: "  Review  " })).toEqual({
      summary: "Review",
    });
    // The clock of an all-day item is no change.
    const allDay = { ...initial, allDay: true };
    expect(changesOf(allDay, { ...allDay, startTime: "13:00" })).toEqual({});
    const removed = changesOf(initial, { ...initial, alarms: [] });
    expect(removed).toEqual({ alarms: { remove: [0], add: [] } });
    const moved = changesOf(initial, { ...initial, startTime: "12:00", endTime: "13:00" });
    expect(Object.keys(moved)).toEqual(["time"]);
  });

  test("a new start date carries the end and a weekly rule on the old weekday", () => {
    const form = {
      ...newForm("event", { calendarId: "c", day: "2026-11-04", minutes: 600, timeZone }),
      endDate: "2026-11-05",
      repeat: {
        frequency: "WEEKLY" as const,
        interval: 1,
        weekdays: ["WE" as const],
        monthlyWeekday: null,
        end: { type: "never" as const },
      },
    };
    const moved = withStartDate(form, "2026-11-06");
    expect(moved).toMatchObject({ startDate: "2026-11-06", endDate: "2026-11-07" });
    expect(moved.repeat).toMatchObject({ weekdays: ["FR"] });
  });

  test("problems: an end before the start, a due before the start, an end of the rule before it", () => {
    const form = newForm("event", { calendarId: "c", day: "2026-11-04", minutes: 600, timeZone });
    expect(problemOf(form)).toBeNull();
    expect(problemOf({ ...form, endTime: "10:30" })).toBe("endBeforeStart");
    expect(problemOf({ ...form, allDay: true, endDate: "2026-11-03" })).toBe("endBeforeStart");
    const task = { ...form, kind: "task" as const, endDate: "2026-11-03" };
    expect(problemOf(task)).toBe("dueBeforeStart");
    expect(
      problemOf({
        ...form,
        repeat: {
          frequency: "DAILY",
          interval: 1,
          weekdays: [],
          monthlyWeekday: null,
          end: { type: "until", until: "2026-11-01" },
        },
      }),
    ).toBe("untilBeforeStart");
  });
});

describe("the scopes offered (D11)", () => {
  test("all three; a new day not for all; a new rule not for one; none for an item that does not repeat", async () => {
    const { store, rowOf } = await demo();
    const target = await targetOn(store, await rowOf("Work", "demo-standup"), "2026-11-05");
    const initial = formOf(target, timeZone);
    expect(scopesFor(target, initial, { ...initial, summary: "x" })).toEqual([
      "this",
      "following",
      "all",
    ]);
    expect(
      scopesFor(target, initial, { ...initial, startDate: "2026-11-06", endDate: "2026-11-06" }),
    ).toEqual(["this", "following"]);
    expect(scopesFor(target, initial, { ...initial, repeat: null })).toEqual(["following", "all"]);
    const single = await targetOn(store, await rowOf("Work", "demo-review"), "2026-11-04");
    const form = formOf(single, timeZone);
    expect(scopesFor(single, form, { ...form, summary: "x" })).toEqual([]);
  });
});

describe("saving writes pending changes through the store (D5)", () => {
  test("a new item under <uid>.ics in its calendar, pending creation", async () => {
    const { store, byName } = await demo();
    const personal = byName("Personal");
    const form = {
      ...newForm("event", { calendarId: personal.id, day: "2026-11-04", minutes: 600, timeZone }),
      summary: "Haircut",
    };
    await saveForm(
      store,
      { target: null, initial: null, form, scope: "all" },
      { now: NOW, uid: () => "new-one" },
    );
    const row = await store.objectAt(personal.id, "new-one.ics");
    expect(row).toMatchObject({ pending: "create", uid: "new-one" });
    expect((CalendarObject.parse(row!.ics).master as Event).summary).toBe("Haircut");
  });

  test("this and following: the old series updated, the rest a new pending creation", async () => {
    const { store, byName, rowOf } = await demo();
    const work = byName("Work");
    const target = await targetOn(store, await rowOf("Work", "demo-standup"), "2026-11-05");
    const initial = formOf(target, timeZone);
    await saveForm(
      store,
      { target, initial, form: { ...initial, summary: "Daily sync" }, scope: "following" },
      { now: NOW, uid: () => "sync-series" },
    );
    expect(await rowOf("Work", "demo-standup")).toMatchObject({ pending: "update" });
    expect(await store.objectAt(work.id, "sync-series.ics")).toMatchObject({ pending: "create" });
  });

  test("a move to another calendar: created there, deleted here", async () => {
    const { store, byName, rowOf } = await demo();
    const target = await targetOn(store, await rowOf("Personal", "demo-lunch"), "2026-11-04");
    const initial = formOf(target, timeZone);
    const work = byName("Work");
    await saveForm(
      store,
      { target, initial, form: { ...initial, calendarId: work.id }, scope: "all" },
      {
        now: NOW,
        uid: uids,
      },
    );
    expect(await store.objectAt(work.id, "demo-lunch.ics")).toMatchObject({ pending: "create" });
    expect(await rowOf("Personal", "demo-lunch")).toMatchObject({ pending: "delete" });
  });

  test("a series moved to another calendar with a new time moves as the occurrence did", async () => {
    const { store, byName, rowOf } = await demo();
    const target = await targetOn(store, await rowOf("Work", "demo-standup"), "2026-11-05");
    const initial = formOf(target, timeZone);
    const personal = byName("Personal");
    await saveForm(
      store,
      {
        target,
        initial,
        form: { ...initial, calendarId: personal.id, startTime: "09:15", endTime: "09:45" },
        scope: "all",
      },
      { now: NOW, uid: uids },
    );
    const moved = (await store.objectAt(personal.id, "demo-standup.ics"))!;
    // The series still starts two weeks before, now at 9:15.
    expect(moved.ics).toContain("DTSTART;TZID=Europe/Vilnius:20261021T091500");
  });

  test("a series held without its master: one exception edited and deleted on its own", async () => {
    const { store, byName } = await demo();
    const work = byName("Work");
    const exception = (day: string, summary: string) =>
      `BEGIN:VEVENT\r\nUID:orphans\r\nDTSTAMP:20261101T000000Z\r\nRECURRENCE-ID;TZID=Europe/Vilnius:${day}T090000\r\nDTSTART;TZID=Europe/Vilnius:${day}T090000\r\nDTEND;TZID=Europe/Vilnius:${day}T100000\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\n`;
    const row = await store.saveFromServer(work.id, {
      href: "orphans.ics",
      etag: '"1"',
      ics: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\n${exception("20261105", "First")}${exception("20261106", "Second")}END:VCALENDAR\r\n`,
    });
    const second = await targetOn(store, row, "2026-11-06");
    const initial = formOf(second, timeZone);
    await saveForm(
      store,
      { target: second, initial, form: { ...initial, summary: "Renamed" }, scope: "all" },
      {
        now: NOW,
        uid: uids,
      },
    );
    const edited = (await store.object(row.id))!;
    expect(edited.ics).toContain("SUMMARY:First");
    expect(edited.ics).toContain("SUMMARY:Renamed");
    await deleteTarget(store, await targetOn(store, edited, "2026-11-05"), "all", NOW);
    const left = (await store.object(row.id))!;
    expect(left.ics).not.toContain("SUMMARY:First");
    expect(left.ics).toContain("SUMMARY:Renamed");
  });

  test("deleting one occurrence is an update; deleting all a pending deletion", async () => {
    const { store, rowOf } = await demo();
    const target = await targetOn(store, await rowOf("Work", "demo-standup"), "2026-11-05");
    await deleteTarget(store, target, "this", NOW);
    const updated = await rowOf("Work", "demo-standup");
    expect(updated.pending).toBe("update");
    expect(updated.ics).toContain("EXDATE;TZID=Europe/Vilnius:20261105T090000");
    await deleteTarget(store, await targetOn(store, updated, "2026-11-06"), "all", NOW);
    expect(await rowOf("Work", "demo-standup")).toMatchObject({ pending: "delete" });
  });
});

describe("the Conflicts list (D6)", () => {
  test("the demo's conflict differs in its title and time", async () => {
    const { store } = await demo();
    const [view] = await conflictViews(store);
    expect(view!.fields).toEqual(["summary", "time"]);
    expect(view!.calendar?.name).toBe("Personal");
  });

  test("keeping the server's drops ours; nothing is written", async () => {
    const { store, rowOf } = await demo();
    const [view] = await conflictViews(store);
    await keepServer(store, view!);
    expect(await store.conflicts()).toHaveLength(0);
    expect(await rowOf("Personal", "demo-dentist")).toMatchObject({ pending: "none" });
  });

  test("applying ours again is a pending update over the server's version", async () => {
    const { store, rowOf } = await demo();
    const [view] = await conflictViews(store);
    await applyMine(store, view!);
    expect(await store.conflicts()).toHaveLength(0);
    const row = await rowOf("Personal", "demo-dentist");
    expect(row).toMatchObject({ pending: "update", ics: view!.conflict.localIcs });
    // The server's version stays the base the upload goes against.
    expect(row.baseIcs).toBe(view!.stored.ics);
  });

  test("a creation whose place the server gave another item goes to a place of its own", async () => {
    const { store, byName, rowOf } = await demo();
    const theirs = await rowOf("Personal", "demo-cinema");
    const ours = theirs.ics.replaceAll("demo-cinema", "our-new-item");
    const conflict = await store.addConflict(theirs.id, ours);
    const view = (await conflictViews(store)).find((v) => v.conflict.id === conflict.id)!;
    await applyMine(store, view, () => "a1");
    expect(await store.objectAt(byName("Personal").id, "our-new-item-a1.ics")).toMatchObject({
      pending: "create",
    });
  });
});

describe("in words", () => {
  const formats = new Formats({ locale: "en-US", hour12: true, weekStart: 7, language: "en" });
  const ruFormats = new Formats({ locale: "ru-RU", hour12: false, weekStart: 1, language: "ru" });
  const en = createI18n("en").t;
  const ru = createI18n("ru").t;
  const start = { type: "date" as const, date: "2026-11-04" };
  const weekly = {
    frequency: "WEEKLY" as const,
    interval: 2,
    weekdays: ["MO" as const, "WE" as const],
    monthlyWeekday: null,
    end: { type: "never" as const },
  };

  test("a rule: every 2 weeks on Monday, Wednesday; with its end", () => {
    expect(repeatWords(weekly, start, en, formats)).toBe("Every 2 weeks on Monday, Wednesday");
    expect(repeatWords(weekly, start, ru, ruFormats)).toBe("Каждые 2 недели в понедельник, среду");
    expect(repeatWords({ ...weekly, weekdays: ["TU"], interval: 1 }, start, ru, ruFormats)).toBe(
      "Каждую неделю во вторник",
    );
    expect(repeatWords({ ...weekly, end: { type: "count", count: 6 } }, start, en, formats)).toBe(
      "Every 2 weeks on Monday, Wednesday, 6 times",
    );
    expect(
      repeatWords({ ...weekly, end: { type: "until", until: "2026-12-31" } }, start, en, formats),
    ).toBe("Every 2 weeks on Monday, Wednesday, until Dec 31, 2026");
    const monthly = { ...weekly, frequency: "MONTHLY" as const, interval: 1, weekdays: [] };
    expect(
      repeatWords({ ...monthly, monthlyWeekday: { nth: 1, weekday: "WE" } }, start, ru, ruFormats),
    ).toBe("Каждый месяц в первую среду");
    expect(
      repeatWords({ ...monthly, monthlyWeekday: { nth: -1, weekday: "FR" } }, start, en, formats),
    ).toBe("Every month on the last Friday");
    expect(repeatWords({ ...monthly, frequency: "YEARLY" }, start, ru, ruFormats)).toBe(
      "Каждый год, 4 ноября",
    );
    expect(repeatWords({ ...monthly, frequency: "DAILY", interval: 5 }, start, ru, ruFormats)).toBe(
      "Каждые 5 дней",
    );
  });

  test("a reminder: before a timed item, or on and before an all-day one", () => {
    const relative = (offsetSeconds: number) => ({
      trigger: { type: "relative" as const, relatedTo: "start" as const, offsetSeconds },
    });
    const timed = { allDay: false, task: false };
    expect(alarmWords(relative(-900), timed, en, formats, timeZone)).toBe("15 minutes before");
    expect(alarmWords(relative(-900), timed, ru, ruFormats, timeZone)).toBe("За 15 минут");
    expect(alarmWords(relative(-3600), timed, ru, ruFormats, timeZone)).toBe("За 1 час");
    expect(alarmWords(relative(0), timed, en, formats, timeZone)).toBe("At the start");
    const allDay = { allDay: true, task: false };
    expect(alarmWords(relative(-15 * 3600), allDay, en, formats, timeZone)).toBe(
      "1 day before at 9:00 AM",
    );
    expect(alarmWords(relative(9 * 3600), allDay, ru, ruFormats, timeZone)).toBe(
      "В тот же день в 9:00",
    );
  });
});
