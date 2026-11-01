// The UI's reminders (docs/plans/foundation.md#D101, D102) on the demo data
// in a real store: the set handed to the platform and when it is handed
// over again, and the words of each notification, in English and Russian.
import { MAX_REMINDERS, type Reminder } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import { Formats } from "../src/calendar/format.ts";
import { localeSettings } from "../src/calendar/locale.ts";
import { loadDemo } from "../src/demo/index.ts";
import { createI18n } from "../src/i18n/index.ts";
import { ReminderPlanner, type PlannerClock } from "../src/reminders/planner.ts";
import { reminderNotification } from "../src/reminders/words.ts";
import { fakeReminders } from "./fakes.ts";

const timeZone = "Europe/Vilnius";
const NOW = Date.parse("2026-11-04T10:40:00+02:00");
const MINUTE = 60_000;

function fakeClock() {
  let now = NOW;
  const timers = new Set<{ at: number; run: () => void }>();
  const clock: PlannerClock = {
    now: () => now,
    after(ms, run) {
      const timer = { at: now + ms, run };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  };
  return {
    clock,
    /** When the planner will look again, if it will. */
    get next() {
      return [...timers].map((timer) => timer.at).toSorted()[0] ?? null;
    },
    /** Jumps to the next timer and runs it. */
    runNext() {
      const timer = [...timers].toSorted((a, b) => a.at - b.at)[0]!;
      timers.delete(timer);
      now = timer.at;
      timer.run();
    },
  };
}

function wordsIn(languages: string[]) {
  const settings = localeSettings(languages);
  return {
    t: createI18n(settings.language).t,
    formats: new Formats(settings),
    locale: settings.locale,
    timeZone,
  };
}

async function setup() {
  const store = await Store.open(nodeDriver());
  await loadDemo(store, { languages: ["en-US"], timeZone, now: NOW });
  const platform = fakeReminders();
  const time = fakeClock();
  const planner = new ReminderPlanner({
    store,
    scheduler: platform.scheduler,
    timeZone,
    clock: time.clock,
  });
  const words = wordsIn(["en-US"]);
  return {
    store,
    platform,
    time,
    planner,
    start: () => planner.update((reminder) => reminderNotification(reminder, words)),
  };
}

/** `Intl` puts narrow and thin spaces around AM/PM and a range's dash. */
const plain = (text: string) => text.replaceAll(/[\u202f\u2009]/g, " ");

const summary = (
  set: readonly { fireAt: number; notification: { title: string; body: string } }[],
) =>
  set.map((r) => [
    new Date(r.fireAt).toISOString(),
    r.notification.title,
    plain(r.notification.body),
  ]);

describe("the set the platform is handed (D101)", () => {
  test("the demo's reminders from now on, the soonest first, with their words", async () => {
    const { platform, start } = await setup();
    const handed = platform.next();
    start();
    await handed;
    expect(summary(platform.last)).toEqual([
      ["2026-11-04T09:00:00.000Z", "Call with Anna", "11:15 – 11:45 AM · in 15 minutes"],

      ["2026-11-05T09:00:00.000Z", "Write the proposal", "Due 12:00 PM · in 1 hour"],
      ["2026-11-05T12:00:00.000Z", "Dentist", "3:00 – 4:00 PM · in 1 hour"],
      ["2026-11-07T07:00:00.000Z", "Trip to Tallinn", "Tomorrow, all day"],
    ]);
  });

  test("a write to the store hands over a new set; turning reminders off hands over none", async () => {
    const { store, platform, planner, start } = await setup();
    let handed = platform.next();
    start();
    await handed;
    const [calendar] = await store.calendars();
    handed = platform.next();
    await store.saveLocal(
      calendar!.id,
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:new\r\nSUMMARY:New\r\nDTSTART:20261104T100000Z\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
    );
    await handed;
    expect(platform.last.map((r) => r.title)).toContain("New");
    planner.update(null);
    expect(platform.last).toEqual([]);
  });

  test("at midnight it looks again: the passed reminders are gone, the next day's horizon in", async () => {
    const { platform, time, start } = await setup();
    let handed = platform.next();
    start();
    await handed;
    expect(time.next).toBe(Date.parse("2026-11-05T00:00:00+02:00"));
    handed = platform.next();
    time.runNext();
    await handed;
    expect(platform.last.map((r) => r.title)).toEqual([
      "Write the proposal",
      "Dentist",
      "Trip to Tallinn",
    ]);
  });

  test("a full set looks again once its last reminder has fired", async () => {
    const { store, platform, time, start } = await setup();
    const [calendar] = await store.calendars();
    const alarms = Array.from(
      { length: MAX_REMINDERS + 5 },
      (_, i) =>
        `BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT${i + 1}M\r\nUID:a${i}\r\nEND:VALARM\r\n`,
    ).join("");
    await store.saveLocal(
      calendar!.id,
      `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:busy\r\nSUMMARY:Busy\r\nDTSTART:20261104T190000Z\r\n${alarms}END:VEVENT\r\nEND:VCALENDAR\r\n`,
    );
    const handed = platform.next();
    start();
    await handed;
    expect(platform.last).toHaveLength(MAX_REMINDERS);
    expect(time.next).toBe(platform.last.at(-1)!.fireAt + 1);
  });
});

describe("what a notification says (D102)", () => {
  const at = (iso: string) => Date.parse(iso);
  const zoned = (local: string) => ({
    type: "zoned" as const,
    local,
    timeZone,
    epochMs: Date.parse(`${local}+02:00`),
  });
  const base: Reminder = {
    id: "x",
    objectId: "o",
    uid: "u",
    kind: "event",
    recurrenceId: null,
    fireAt: at("2026-11-04T10:45:00+02:00"),
    title: "Meeting",
    start: zoned("2026-11-04T11:00:00"),
    end: zoned("2026-11-04T12:00:00"),
    due: null,
  };
  const both = (reminder: Partial<Reminder>) =>
    [wordsIn(["en-US"]), wordsIn(["ru-RU"])].map((words) =>
      plain(reminderNotification({ ...base, ...reminder }, words).body),
    );

  test("how soon: minutes, then hours", () => {
    const lead = (minutes: number) =>
      both({
        fireAt: base.start!.type === "zoned" ? base.start!.epochMs - minutes * MINUTE : 0,
      })[0];
    expect([5, 60, 90, 120, 200].map(lead)).toEqual([
      "11:00 AM – 12:00 PM · in 5 minutes",
      "11:00 AM – 12:00 PM · in 1 hour",
      "11:00 AM – 12:00 PM · in 90 minutes",
      "11:00 AM – 12:00 PM · in 2 hours",
      "11:00 AM – 12:00 PM · in 3 hours",
    ]);
  });

  test("an event: its time, and how soon, or that it is now", () => {
    expect(both({})).toEqual([
      "11:00 AM – 12:00 PM · in 15 minutes",
      "11:00–12:00 · через 15 минут",
    ]);
    expect(both({ fireAt: at("2026-11-04T11:00:00+02:00") })).toEqual([
      "11:00 AM – 12:00 PM · now",
      "11:00–12:00 · сейчас",
    ]);
    // Fired after the start: its time only.
    expect(both({ fireAt: at("2026-11-04T11:10:00+02:00") })).toEqual([
      "11:00 AM – 12:00 PM",
      "11:00–12:00",
    ]);
  });

  test("another day says which; an all-day item says it is all day", () => {
    expect(both({ fireAt: at("2026-11-03T11:00:00+02:00") })).toEqual([
      "Tomorrow, 11:00 AM – 12:00 PM",
      "Завтра, 11:00–12:00",
    ]);
    expect(
      both({
        fireAt: at("2026-11-01T09:00:00+02:00"),
        start: { type: "date", date: "2026-11-04" },
        end: { type: "date", date: "2026-11-05" },
      }),
    ).toEqual(["Wed, Nov 4, all day", "Ср, 4 нояб., весь день"]);
  });

  test("a task: its due, or its start; a date says the day", () => {
    const task = { kind: "task" as const, start: null, end: null };
    expect(
      both({ ...task, due: zoned("2026-11-04T15:00:00"), fireAt: at("2026-11-04T14:30:00+02:00") }),
    ).toEqual(["Due 3:00 PM · in 30 minutes", "Срок: 15:00 · через 30 минут"]);
    expect(both({ ...task, due: { type: "date", date: "2026-11-04" } })).toEqual([
      "Due today",
      "Срок: сегодня",
    ]);
    expect(both({ ...task, start: zoned("2026-11-05T09:00:00") })).toEqual([
      "Starts tomorrow, 9:00 AM · in 22 hours",
      "Начало: завтра, 9:00 · через 22 часа",
    ]);
    expect(both({ ...task })).toEqual(["Task", "Задача"]);
  });

  test("an item without a title says so", () => {
    expect(reminderNotification({ ...base, title: null }, wordsIn(["ru-RU"])).title).toBe(
      "(Без названия)",
    );
  });
});
