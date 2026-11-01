// A shell's headless run (docs/plans/android.md#D67) hands the platform the
// same reminder set the open app's planner does, in the language and with
// the settings the user chose, and nothing when reminders are off.
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { expect, test } from "vite-plus/test";

import { scheduleReminders } from "../src/background.ts";
import { Formats } from "../src/calendar/format.ts";
import { localeSettings } from "../src/calendar/locale.ts";
import { loadDemo } from "../src/demo/index.ts";
import { createI18n } from "../src/i18n/index.ts";
import { KEYS, type Preferences } from "../src/preferences.ts";
import { reminderSet } from "../src/reminders/planner.ts";
import { reminderNotification } from "../src/reminders/words.ts";
import { fakeReminders } from "./fakes.ts";

const timeZone = "Europe/Vilnius";
const NOW = Date.parse("2026-11-04T10:40:00+02:00");

function preferences(settings?: object): Preferences {
  return {
    get: (key) => (key === KEYS.settings && settings ? JSON.stringify(settings) : null),
    set: () => {},
  };
}

async function demoStore() {
  const store = await Store.open(nodeDriver());
  await loadDemo(store, { languages: ["en-US"], timeZone, now: NOW });
  return store;
}

test("the open app's set, with the open app's words", async () => {
  const store = await demoStore();
  const platform = fakeReminders();
  const languages = ["en-US"];
  const set = await scheduleReminders({
    store,
    scheduler: platform.scheduler,
    preferences: preferences(),
    languages,
    timeZone,
    now: NOW,
  });
  const settings = localeSettings(languages);
  const words = {
    t: createI18n(settings.language).t,
    formats: new Formats(settings),
    locale: settings.locale,
    timeZone,
  };
  const planned = await reminderSet(store, NOW, timeZone, (r) => reminderNotification(r, words));
  expect(platform.last).toEqual(planned.set);
  expect(set).toEqual(planned.set);
  expect(set!.length).toBeGreaterThan(0);
});

test("in the language chosen in the settings", async () => {
  const platform = fakeReminders();
  await scheduleReminders({
    store: await demoStore(),
    scheduler: platform.scheduler,
    preferences: preferences({ language: "ru", clock: 24 }),
    languages: ["en-US"],
    timeZone,
    now: NOW,
  });
  const call = platform.last.find((r) => r.title === "Call with Anna")!;
  expect(call.notification.body).toBe("11:15–11:45 · через 15 минут");
});

test("reminders turned off: nothing is handed over", async () => {
  const platform = fakeReminders();
  const set = await scheduleReminders({
    store: await demoStore(),
    scheduler: platform.scheduler,
    preferences: preferences({ reminders: false }),
    languages: ["en-US"],
    timeZone,
    now: NOW,
  });
  expect(set).toBeNull();
  expect(platform.sets).toEqual([]);
});
