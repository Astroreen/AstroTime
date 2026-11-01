// The web's reminders (docs/plans/foundation.md#D101) on a fake page: its
// clock, timers, wake-ups, lock and notifications are the test's own, so
// time passes only when the test says.
import type { ScheduledReminder } from "@astrotime/core";
import { expect, test } from "vite-plus/test";

import { LATE_MS, webReminders, type ReminderPage, type Shown } from "./reminders.ts";

const NOW = Date.parse("2026-11-04T08:40:00Z");
const MINUTE = 60_000;

function fakePage(options: { lead?: boolean; permission?: NotificationPermission } = {}) {
  let now = NOW;
  let permission: NotificationPermission = options.permission ?? "granted";
  let grant: (() => void) | null = null;
  const timers = new Set<{ at: number; run: () => void }>();
  const wakes = new Set<() => void>();
  const shown: {
    title: string;
    body: string;
    tag: string;
    notification: Shown & { click(): void; readonly listening: boolean };
  }[] = [];
  let focused = 0;
  const page: ReminderPage = {
    now: () => now,
    after(ms, run) {
      const timer = { at: now + ms, run };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    onWake(listener) {
      wakes.add(listener);
      return () => wakes.delete(listener);
    },
    lead(granted) {
      if (options.lead === false) grant = granted;
      else granted();
    },
    notifications: {
      get permission() {
        return permission;
      },
      requestPermission: async () => {
        permission = "granted";
        return permission;
      },
      show(title, { body, tag }) {
        const clicks = new Set<() => void>();
        const notification = {
          addEventListener: (_type: "click", listener: () => void) => void clicks.add(listener),
          close: () => clicks.clear(),
          click: () => {
            for (const listener of clicks) listener();
          },
          get listening() {
            return clicks.size > 0;
          },
        } satisfies Shown & Record<string, unknown>;
        shown.push({ title, body, tag, notification });
        return notification;
      },
    },
    focus: () => void focused++,
  };
  return {
    page,
    shown,
    get focused() {
      return focused;
    },
    get timers() {
      return timers.size;
    },
    /** Time passes: every timer due by then runs, in order, as a running page would. */
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = [...timers].toSorted((a, b) => a.at - b.at)[0];
        if (!next || next.at > until) break;
        timers.delete(next);
        now = Math.max(now, next.at);
        next.run();
      }
      now = until;
    },
    /** Time passes with the page asleep (a laptop's lid closed), then it wakes. */
    sleep(ms: number) {
      now += ms;
      for (const wake of wakes) wake();
    },
    /** The tab that held the lock closed: this one leads now. */
    takeLead: () => grant?.(),
  };
}

const reminder = (id: string, minutes: number): ScheduledReminder => ({
  id,
  objectId: "obj",
  uid: id,
  kind: "event",
  recurrenceId: null,
  fireAt: NOW + minutes * MINUTE,
  title: id,
  start: null,
  end: null,
  due: null,
  notification: { title: `Title ${id}`, body: `Body ${id}` },
});

test("each reminder shows at its time, with its words, tagged with its id, once", () => {
  const fake = fakePage();
  const reminders = webReminders(fake.page);
  reminders.schedule([reminder("b", 20), reminder("a", 10)]);
  fake.advance(10 * MINUTE - 1);
  expect(fake.shown).toEqual([]);
  fake.advance(1);
  expect(fake.shown.map(({ title, body, tag }) => ({ title, body, tag }))).toEqual([
    { title: "Title a", body: "Body a", tag: "a" },
  ]);
  // The same set again, as the next computation hands it over: nothing twice.
  reminders.schedule([reminder("a", 10), reminder("b", 20)]);
  fake.advance(10 * MINUTE);
  expect(fake.shown.map((s) => s.tag)).toEqual(["a", "b"]);
  expect(fake.timers).toBe(0);
});

test("a new set replaces the one before: a reminder no longer in it does not show", () => {
  const fake = fakePage();
  const reminders = webReminders(fake.page);
  reminders.schedule([reminder("a", 10), reminder("b", 20)]);
  reminders.schedule([reminder("b", 25)]);
  fake.advance(30 * MINUTE);
  expect(fake.shown.map((s) => s.tag)).toEqual(["b"]);
  reminders.schedule([]);
  expect(fake.timers).toBe(0);
});

test("after a sleep a reminder missed by a few minutes shows on waking; an older one is dropped", () => {
  const fake = fakePage();
  const reminders = webReminders(fake.page);
  reminders.schedule([reminder("old", 10), reminder("recent", 30), reminder("next", 60)]);
  fake.sleep(30 * MINUTE + LATE_MS);
  expect(fake.shown.map((s) => s.tag)).toEqual(["recent"]);
  fake.advance(30 * MINUTE);
  expect(fake.shown.map((s) => s.tag)).toEqual(["recent", "next"]);
});

test("only the tab holding the lock shows them; another takes over when it closes", () => {
  const fake = fakePage({ lead: false });
  const reminders = webReminders(fake.page);
  reminders.schedule([reminder("a", 10), reminder("b", 20)]);
  fake.advance(15 * MINUTE);
  expect(fake.shown).toEqual([]);
  fake.takeLead();
  // "a" is five minutes late: still shown, then "b" at its time.
  expect(fake.shown.map((s) => s.tag)).toEqual(["a"]);
  fake.advance(5 * MINUTE);
  expect(fake.shown.map((s) => s.tag)).toEqual(["a", "b"]);
});

test("a tap brings the tab forward, closes the notification and opens the reminder", () => {
  const fake = fakePage();
  const reminders = webReminders(fake.page);
  const opened: string[] = [];
  const stop = reminders.onOpen((tapped) => opened.push(tapped.id));
  reminders.schedule([reminder("a", 1)]);
  fake.advance(MINUTE);
  fake.shown[0]!.notification.click();
  expect(opened).toEqual(["a"]);
  expect(fake.focused).toBe(1);
  expect(fake.shown[0]!.notification.listening).toBe(false);
  stop();
});

test("without the permission nothing shows; it is asked only when the UI asks", async () => {
  const fake = fakePage({ permission: "default" });
  const reminders = webReminders(fake.page);
  expect(reminders.permission()).toBe("default");
  reminders.schedule([reminder("a", 1)]);
  fake.advance(MINUTE);
  expect(fake.shown).toEqual([]);
  expect(await reminders.requestPermission()).toBe("granted");
  expect(reminders.whileOpenOnly).toBe(true);
});

test("a browser without notifications says so", () => {
  const fake = fakePage();
  const reminders = webReminders({ ...fake.page, notifications: null });
  expect(reminders.permission()).toBe("unsupported");
  reminders.schedule([reminder("a", 1)]);
  fake.advance(MINUTE);
  expect(fake.shown).toEqual([]);
});
