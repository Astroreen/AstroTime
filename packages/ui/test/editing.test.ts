// The edit dialog's logic without React (docs/plans/foundation.md#D9–D11, D6):
// the form an item opens with, the changes a form makes (only what the user
// changed), the scopes offered, the writes to the local store, the words of
// rules and reminders, and the Conflicts list's two ways out.
import { CalendarObject, occurrencesBetween, starTask, type Event } from "@astrotime/core";
import { CommitInDoubtError, HandOverError, Store, type LocalChange } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import { applyMine, conflictViews, keepServer } from "../src/calendar/conflicts.ts";
import {
  calendarsFor,
  changesOf,
  deleteScopes,
  deleteTarget,
  followed,
  formOf,
  GoneError,
  InDoubtError,
  newForm,
  noticeOf,
  problemOf,
  rewriteTarget,
  saveForm,
  scopesFor,
  switchKind,
  timesOfForm,
  withStartDate,
  withStartTime,
  type Form,
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
    expect(changesOf(initial, initial, "Reminder")).toEqual({});
    expect(changesOf(initial, { ...initial, summary: "  Review  " }, "Reminder")).toEqual({
      summary: "Review",
    });
    // The clock of an all-day item is no change.
    const allDay = { ...initial, allDay: true };
    expect(changesOf(allDay, { ...allDay, startTime: "13:00" }, "Reminder")).toEqual({});
    const removed = changesOf(initial, { ...initial, alarms: [] }, "Reminder");
    expect(removed).toEqual({ alarms: { remove: [0], add: [], untitled: "Reminder" } });
    const moved = changesOf(
      initial,
      { ...initial, startTime: "12:00", endTime: "13:00" },
      "Reminder",
    );
    expect(Object.keys(moved)).toEqual(["time"]);
  });

  test("a new start date carries the end, and the rule moves with the day (D105)", () => {
    const repeat = {
      frequency: "WEEKLY" as const,
      interval: 1,
      weekdays: ["WE" as const],
      monthlyWeekday: null,
      end: { type: "never" as const },
    };
    const form: Form = {
      ...newForm("event", { calendarId: "c", day: "2026-11-04", minutes: 600, timeZone }),
      endDate: "2026-11-05",
      repeat,
    };
    const moved = followed(form, withStartDate(form, "2026-11-06"));
    expect(moved).toMatchObject({ startDate: "2026-11-06", endDate: "2026-11-07" });
    expect(moved.repeat).toMatchObject({ weekdays: ["FR"] });
    // Several weekdays shift together; the nth weekday of a month names the new day's.
    const several = { ...form, repeat: { ...repeat, weekdays: ["MO" as const, "WE" as const] } };
    expect(followed(several, withStartDate(several, "2026-11-05")).repeat).toMatchObject({
      weekdays: ["TU", "TH"],
    });
    const monthly: Form = {
      ...form,
      startDate: "2026-11-10",
      endDate: "2026-11-10",
      repeat: {
        ...repeat,
        frequency: "MONTHLY",
        weekdays: [],
        monthlyWeekday: { nth: 2, weekday: "TU" },
      },
    };
    expect(followed(monthly, withStartDate(monthly, "2026-11-18")).repeat).toMatchObject({
      monthlyWeekday: { nth: 3, weekday: "WE" },
    });
    // A task without a start moves with its due; a rule the user picks stays theirs.
    const task: Form = { ...form, kind: "task", startDate: "", endDate: "2026-11-04" };
    expect(followed(task, { ...task, endDate: "2026-11-05" }).repeat).toMatchObject({
      weekdays: ["TH"],
    });
    const picked = { ...repeat, weekdays: ["SA" as const] };
    expect(followed(form, { ...withStartDate(form, "2026-11-06"), repeat: picked }).repeat).toBe(
      picked,
    );
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

describe("the form's corners", () => {
  const event = (lines: string) => {
    const object = CalendarObject.parse(
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VEVENT\r\nUID:e\r\nDTSTAMP:20261101T000000Z\r\n${lines}SUMMARY:Ping\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
    );
    return { objectId: "o", calendarId: "c", object, recurrenceId: null, item: object.master! };
  };

  test("an event without a length (no DTEND) saves while its times are as they were", () => {
    const initial = formOf(event("DTSTART;TZID=Europe/Vilnius:20261105T090000\r\n"), timeZone);
    expect(problemOf({ ...initial, summary: "Ping 2" }, initial)).toBeNull();
    // Given a time, it lasts.
    // A new start moves its end with it, and it keeps no length.
    const later = withStartTime(initial, "10:00");
    expect(later).toMatchObject({ startTime: "10:00", endDate: "2026-11-05", endTime: "10:00" });
    expect(problemOf(later, initial)).toBeNull();
    // An end before the start is refused still; one that had a length may not lose it.
    expect(problemOf({ ...initial, endTime: "08:00" }, initial)).toBe("endBeforeStart");
    const hour = { ...initial, endTime: "10:00" };
    expect(problemOf({ ...hour, endTime: "09:00" }, hour)).toBe("endBeforeStart");
  });

  test("a new start keeps the event's length over midnight", () => {
    const night = formOf(
      event(
        "DTSTART;TZID=Europe/Vilnius:20261105T220000\r\nDTEND;TZID=Europe/Vilnius:20261106T020000\r\n",
      ),
      timeZone,
    );
    expect(withStartTime(night, "23:00")).toMatchObject({
      startDate: "2026-11-05",
      startTime: "23:00",
      endDate: "2026-11-06",
      endTime: "03:00",
    });
    const late = formOf(
      event(
        "DTSTART;TZID=Europe/Vilnius:20261105T220000\r\nDTEND;TZID=Europe/Vilnius:20261105T230000\r\n",
      ),
      timeZone,
    );
    expect(withStartTime(late, "23:30")).toMatchObject({ endDate: "2026-11-06", endTime: "00:30" });
    expect(withStartTime(late, "09:00")).toMatchObject({ endDate: "2026-11-05", endTime: "10:00" });
  });

  test("an event over midnight made a task and back keeps its length", () => {
    const form = newForm("event", {
      calendarId: "c",
      day: "2026-11-05",
      minutes: 0,
      at: 23 * 60 + 30,
      timeZone,
    });
    expect(form).toMatchObject({ endDate: "2026-11-06", endTime: "00:30" });
    const back = switchKind(switchKind(form, "task"), "event");
    expect(back).toMatchObject({
      startDate: "2026-11-05",
      startTime: "23:30",
      endDate: "2026-11-06",
      endTime: "00:30",
    });
    expect(problemOf(back)).toBeNull();
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
    const nextDay = followed(initial, {
      ...initial,
      startDate: "2026-11-06",
      endDate: "2026-11-06",
    });
    expect(scopesFor(target, initial, nextDay)).toEqual(["this", "following"]);
    expect(scopesFor(target, initial, { ...initial, repeat: null })).toEqual(["following", "all"]);
    // The rule moved with the day is no new rule; a new rule on a new day is "following".
    expect(nextDay.repeat).not.toEqual(initial.repeat);
    expect(changesOf(initial, nextDay, "Reminder")).not.toHaveProperty("repeat");
    expect(scopesFor(target, initial, { ...nextDay, repeat: null })).toEqual(["following"]);
    const single = await targetOn(store, await rowOf("Work", "demo-review"), "2026-11-04");
    const form = formOf(single, timeZone);
    expect(scopesFor(single, form, { ...form, summary: "x" })).toEqual([]);
    // Saved with nothing changed, a series asks nothing (it writes nothing).
    expect(scopesFor(target, initial, { ...initial })).toEqual([]);
  });
});

describe("what a calendar's rights offer (D37)", () => {
  const rights = (create: boolean, edit: boolean, del: boolean) => ({ create, edit, delete: del });

  test("a calendar that takes no new items offers no split: a new rule on a new day cannot be saved there", async () => {
    const { store, rowOf } = await demo();
    const target = await targetOn(store, await rowOf("Work", "demo-standup"), "2026-11-05");
    const initial = formOf(target, timeZone);
    const editOnly = rights(false, true, true);
    expect(scopesFor(target, initial, { ...initial, summary: "x" }, editOnly)).toEqual([
      "this",
      "all",
    ]);
    const nextDay = followed(initial, {
      ...initial,
      startDate: "2026-11-06",
      endDate: "2026-11-06",
    });
    expect(scopesFor(target, initial, nextDay, editOnly)).toEqual(["this"]);
    expect(scopesFor(target, initial, { ...nextDay, repeat: null }, editOnly)).toBeNull();
  });

  test("deleting: one occurrence or the following ones are edits, all of them or a single item a deletion", async () => {
    const { store, rowOf } = await demo();
    const series = await targetOn(store, await rowOf("Work", "demo-standup"), "2026-11-05");
    const single = await targetOn(store, await rowOf("Work", "demo-review"), "2026-11-04");
    expect(deleteScopes(series, rights(true, true, true))).toEqual(["this", "following", "all"]);
    expect(deleteScopes(series, rights(true, true, false))).toEqual(["this", "following"]);
    expect(deleteScopes(series, rights(false, false, true))).toEqual(["all"]);
    expect(deleteScopes(single, rights(true, true, false))).toEqual([]);
    expect(deleteScopes(single, rights(false, false, true))).toEqual(["all"]);
    // From the series' first occurrence "this and following" deletes it all.
    const first = await targetOn(store, await rowOf("Work", "demo-standup"), "2026-10-21");
    expect(deleteScopes(first, rights(true, true, false))).toEqual(["this"]);
    expect(deleteScopes(first, rights(true, true, true))).toEqual(["this", "following", "all"]);
  });

  test("a series held without its master: one exception of several is an edit, the last a deletion (D105)", async () => {
    const { store, byName } = await demo();
    const exception = (day: string) =>
      `BEGIN:VEVENT\r\nUID:orphans\r\nDTSTAMP:20261101T000000Z\r\nRECURRENCE-ID;TZID=Europe/Vilnius:${day}T090000\r\nDTSTART;TZID=Europe/Vilnius:${day}T090000\r\nDTEND;TZID=Europe/Vilnius:${day}T100000\r\nSUMMARY:${day}\r\nEND:VEVENT\r\n`;
    const held = async (href: string, ...days: string[]) =>
      targetOn(
        store,
        await store.saveFromServer(byName("Work").id, {
          href,
          etag: '"1"',
          ics: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\n${days.map(exception).join("")}END:VCALENDAR\r\n`,
        }),
        `${days[0]!.slice(0, 4)}-${days[0]!.slice(4, 6)}-${days[0]!.slice(6)}`,
      );
    const two = await held("two.ics", "20261105", "20261106");
    expect(deleteScopes(two, rights(false, true, false))).toEqual(["this"]);
    expect(deleteScopes(two, rights(false, false, true))).toEqual([]);
    const last = await held("last.ics", "20261105");
    expect(deleteScopes(last, rights(false, true, false))).toEqual([]);
    expect(deleteScopes(last, rights(false, false, true))).toEqual(["this"]);
  });

  test("a new item goes where new items may; an existing one stays, and moves out only where its calendar lets it go", async () => {
    const { byName } = await demo();
    const at = (name: string, r: ReturnType<typeof rights>) => ({ ...byName(name), rights: r });
    const own = at("Work", rights(false, true, false));
    const other = at("Personal", rights(true, true, true));
    const holidays = byName("Holidays");
    const calendars = [own, other, holidays];
    const names = (list: readonly { name: string }[]) => list.map((c) => c.name);
    expect(names(calendarsFor(calendars, "event"))).toEqual(["Personal"]);
    expect(names(calendarsFor(calendars, "event", own))).toEqual(["Work"]);
    expect(
      names(calendarsFor(calendars, "event", { ...own, rights: rights(false, true, true) })),
    ).toEqual(["Work", "Personal"]);
    expect(names(calendarsFor(calendars, "event", holidays))).toEqual([]);
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
      { target: null, initial: null, form, scope: "all", untitled: "Reminder" },
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
      {
        target,
        initial,
        form: { ...initial, summary: "Daily sync" },
        scope: "following",
        untitled: "Reminder",
      },
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
      {
        target,
        initial,
        form: { ...initial, calendarId: work.id },
        scope: "all",
        untitled: "Reminder",
      },
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
        untitled: "Reminder",
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
      {
        target: second,
        initial,
        form: { ...initial, summary: "Renamed" },
        scope: "all",
        untitled: "Reminder",
      },
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

  test("an edit applies to the object as the store holds it at saving: a change made meanwhile stays", async () => {
    const { store, byName, rowOf } = await demo();
    const row = await rowOf("Work", "demo-review");
    const target = await targetOn(store, row, "2026-11-04");
    const initial = formOf(target, timeZone);
    // The dialog is open; a sync brings the server's newer version: a new
    // place, another client's property, a reminder before the one there was.
    const theirs = row.ics
      .replace("LOCATION:Room 4\\, second floor", "LOCATION:Room 7")
      .replace(
        "BEGIN:VALARM",
        "X-OTHER-CLIENT:kept\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Theirs\r\nTRIGGER:-PT1H\r\nEND:VALARM\r\nBEGIN:VALARM",
      );
    expect(theirs).not.toBe(row.ics);
    await store.saveFromServer(byName("Work").id, { href: row.href, etag: '"2"', ics: theirs });
    // The user renamed it and took the 10-minute reminder away.
    await saveForm(
      store,
      {
        target,
        initial,
        form: { ...initial, summary: "Design review, v2", alarms: [] },
        scope: "all",
        untitled: "Reminder",
      },
      { now: NOW, uid: uids },
    );
    const saved = CalendarObject.parse((await rowOf("Work", "demo-review")).ics);
    expect(saved.master).toMatchObject({ summary: "Design review, v2", location: "Room 7" });
    expect(saved.master!.alarms.map((alarm) => alarm.description)).toEqual(["Theirs"]);
    expect(saved.serialize()).toContain("X-OTHER-CLIENT:kept\r\n");
  });

  test("an item or an occurrence gone meanwhile: nothing is saved, and the user is told", async () => {
    const { store, rowOf } = await demo();
    const standup = await targetOn(store, await rowOf("Work", "demo-standup"), "2026-11-05");
    const initial = formOf(standup, timeZone);
    // Another tab deleted this occurrence while the dialog was open.
    await deleteTarget(store, standup, "this", NOW);
    const before = (await rowOf("Work", "demo-standup")).ics;
    const request = {
      target: standup,
      initial,
      form: { ...initial, summary: "x" },
      scope: "this",
      untitled: "Reminder",
    } as const;
    await expect(saveForm(store, request, { now: NOW, uid: uids })).rejects.toThrow(GoneError);
    expect((await rowOf("Work", "demo-standup")).ics).toBe(before);
    // And deleting it again changes nothing.
    await deleteTarget(store, standup, "this", NOW + 1000);
    expect((await rowOf("Work", "demo-standup")).ics).toBe(before);

    const review = await targetOn(store, await rowOf("Work", "demo-review"), "2026-11-04");
    const reviewForm = formOf(review, timeZone);
    await store.deleteLocal(review.objectId);
    await expect(
      saveForm(
        store,
        {
          target: review,
          initial: reviewForm,
          form: { ...reviewForm, summary: "x" },
          scope: "all",
          untitled: "Reminder",
        },
        { now: NOW, uid: uids },
      ),
    ).rejects.toThrow(GoneError);
  });

  test("the store's leader gone: tried once more; a commit in doubt read again (D99)", async () => {
    const { store, rowOf } = await demo();
    const target = await targetOn(store, await rowOf("Work", "demo-review"), "2026-11-04");
    const initial = formOf(target, timeZone);
    const save = (on: Store, summary: string) =>
      saveForm(
        on,
        { target, initial, form: { ...initial, summary }, scope: "all", untitled: "Reminder" },
        { now: NOW, uid: uids },
      );
    /** The store, with `changeLocal` as given. */
    const withChange = (
      changeLocal: (change: (local: LocalChange) => Promise<void>) => Promise<void>,
    ) => Object.assign(Object.create(store) as Store, { changeLocal });
    const summary = async () =>
      CalendarObject.parse((await rowOf("Work", "demo-review")).ics).master!.summary;

    // A statement that went with the leader ran nothing: the change runs again.
    let calls = 0;
    await save(
      withChange(async (change) => {
        if (calls++ === 0) throw new HandOverError("The leader went.");
        await store.changeLocal(change);
      }),
      "Handed over",
    );
    expect(calls).toBe(2);
    expect(await summary()).toBe("Handed over");

    // A COMMIT whose answer went with the leader: the store is read again.
    await save(
      withChange(async (change) => {
        await store.changeLocal(change);
        throw new CommitInDoubtError("The answer went with the leader.");
      }),
      "Committed",
    );
    expect(await summary()).toBe("Committed");
    await expect(
      save(
        withChange(async (change) => {
          await store
            .changeLocal(async (local) => {
              await change(local);
              throw new Error("Rolled back with the leader.");
            })
            .catch(() => {});
          throw new CommitInDoubtError("The answer went with the leader.");
        }),
        "Lost",
      ),
    ).rejects.toThrow(InDoubtError);
    expect(await summary()).toBe("Committed");
  });

  test("a completion or a star onto what the store holds; gone meanwhile, the user is told (D99, D103)", async () => {
    const { store, rowOf } = await demo();
    const standup = await targetOn(store, await rowOf("Work", "demo-standup"), "2026-11-05");
    const star = (object: CalendarObject) => starTask(object, true, NOW);
    // A sync changed the series meanwhile: the star goes onto that.
    const changed = (await rowOf("Work", "demo-standup")).ics.replace(
      "END:VEVENT",
      "X-OTHER-CLIENT:kept\r\nEND:VEVENT",
    );
    await store.saveFromServer(standup.calendarId, {
      href: "demo-standup.ics",
      etag: '"2"',
      ics: changed,
    });
    await rewriteTarget(store, standup, star);
    expect((await rowOf("Work", "demo-standup")).ics).toContain("X-OTHER-CLIENT:kept\r\n");
    // The occurrence deleted in another tab, then the whole item.
    await deleteTarget(store, standup, "this", NOW);
    const error = await rewriteTarget(store, standup, star).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoneError);
    expect(noticeOf(error, "change")).toBe("gone");
    // Deleting an occurrence that has left its series: done, nothing to say.
    expect(noticeOf(error, "delete")).toBeNull();
    await deleteTarget(store, standup, "all", NOW);
    const all = { ...standup, recurrenceId: null };
    await expect(rewriteTarget(store, all, star)).rejects.toThrow(GoneError);
    // A deletion of what is gone already is done; one in doubt or failed says so.
    await expect(deleteTarget(store, all, "all", NOW)).resolves.toBeUndefined();
    expect(noticeOf(new InDoubtError("?"), "delete")).toBe("deleteInDoubt");
    expect(noticeOf(new InDoubtError("?"), "change")).toBe("inDoubt");
    expect(noticeOf(new Error("disk full"), "delete")).toBe("deleteFailed");
    expect(noticeOf(new Error("disk full"), "change")).toBe("failed");
  });

  test("this and following on another day: the new series' rule names the new days", async () => {
    const { store, byName, rowOf } = await demo();
    const target = await targetOn(store, await rowOf("Work", "demo-standup"), "2026-11-05");
    const initial = formOf(target, timeZone);
    const form = followed(initial, withStartDate(initial, "2026-11-06"));
    await saveForm(
      store,
      { target, initial, form, scope: "following", untitled: "Reminder" },
      { now: NOW, uid: () => "standup-later" },
    );
    const rest = (await store.objectAt(byName("Work").id, "standup-later.ics"))!;
    expect(rest.ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=TU,WE,TH,FR,SA\r\n");
    expect(CalendarObject.parse(rest.ics).master).toMatchObject({
      start: { local: "2026-11-06T09:00:00" },
    });
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
