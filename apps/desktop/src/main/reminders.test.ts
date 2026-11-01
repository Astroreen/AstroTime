// The main process's reminders (docs/plans/desktop.md#D76) on a fake clock:
// each shows at its time, the window closed or not; one missed while the
// machine slept shows on waking, up to an hour late, saying when it was due.
import type { ScheduledReminder } from "@astrotime/core";
import { expect, test } from "vite-plus/test";

import { backgroundTriggers, SYNC_EVERY_MS, type PowerEvent } from "./background.ts";
import { mainReminders, type Clock } from "./reminders.ts";

const NOW = Date.parse("2026-11-04T10:40:00+02:00");
const MINUTE = 60_000;

/**
 * Node's timers as the machine sees them: they run when the clock reaches
 * them, and stand still while it sleeps (`sleep` moves the clock, not them).
 */
function fakeClock() {
  let now = NOW;
  const timers = new Set<{ at: number; run: () => void }>();
  const clock: Clock = {
    now: () => now,
    after(ms, run) {
      const timer = { at: now + ms, run };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  };
  return {
    clock,
    /** Runs every timer due by `ms` from now, in order. */
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const timer = [...timers].filter((t) => t.at <= until).toSorted((a, b) => a.at - b.at)[0];
        if (!timer) break;
        timers.delete(timer);
        now = timer.at;
        timer.run();
      }
      now = until;
    },
    /** The machine sleeps: time passes, the timers' waits do not. */
    sleep(ms: number) {
      now += ms;
      for (const timer of timers) timer.at += ms;
    },
  };
}

const reminder = (id: string, fireAt: number, title = id): ScheduledReminder => ({
  id,
  objectId: id,
  uid: id,
  kind: "event",
  recurrenceId: null,
  fireAt,
  title,
  start: null,
  end: null,
  due: null,
  notification: { title, body: `${title} · in 15 minutes`, late: `${title} · reminder due at` },
});

function setup() {
  const time = fakeClock();
  const notifications: { title: string; body: string; click: () => void }[] = [];
  const opened: string[] = [];
  const reminders = mainReminders({
    clock: time.clock,
    show: (notification, click) => notifications.push({ ...notification, click }),
    open: (shown) => opened.push(shown.id),
  });
  const shown = () => notifications.map(({ title, body }) => [title, body]);
  return { time, reminders, notifications, shown, opened };
}

test("each reminder shows at its time, and only once however often the set comes again", () => {
  const { time, reminders, shown } = setup();
  const set = [reminder("call", NOW + 5 * MINUTE), reminder("review", NOW + 20 * MINUTE)];
  reminders.schedule(set);
  expect(shown()).toEqual([]);
  time.advance(5 * MINUTE);
  expect(shown()).toEqual([["call", "call · in 15 minutes"]]);
  // A sync's writes hand the same set over again.
  reminders.schedule(set);
  time.advance(15 * MINUTE);
  expect(shown()).toEqual([
    ["call", "call · in 15 minutes"],
    ["review", "review · in 15 minutes"],
  ]);
});

test("a new set replaces the old: a reminder gone does not show, one moved later shows then", () => {
  const { time, reminders, shown } = setup();
  reminders.schedule([reminder("gone", NOW + MINUTE), reminder("moved", NOW + 2 * MINUTE)]);
  reminders.schedule([reminder("moved", NOW + 10 * MINUTE)]);
  time.advance(9 * MINUTE);
  expect(shown()).toEqual([]);
  time.advance(MINUTE);
  expect(shown()).toEqual([["moved", "moved · in 15 minutes"]]);
});

test("one missed while the machine slept shows on waking, saying when it was due; one older than an hour does not", () => {
  const { time, reminders, shown } = setup();
  reminders.schedule([
    reminder("long ago", NOW + 5 * MINUTE),
    reminder("missed", NOW + 50 * MINUTE),
    reminder("ahead", NOW + 3 * 60 * MINUTE),
  ]);
  // Asleep for 100 minutes: the timers stood still.
  time.sleep(100 * MINUTE);
  expect(shown()).toEqual([]);
  reminders.wake();
  expect(shown()).toEqual([["missed", "missed · reminder due at"]]);
  // The next is armed again from now.
  time.advance(80 * MINUTE);
  expect(shown()).toEqual([
    ["missed", "missed · reminder due at"],
    ["ahead", "ahead · in 15 minutes"],
  ]);
});

test("a set handed over on waking, an hour back, shows what was missed, once", () => {
  const { reminders, shown } = setup();
  // The page computes its set after the machine woke: the hour back is in it.
  const set = [reminder("missed", NOW - 30 * MINUTE), reminder("too old", NOW - 61 * MINUTE)];
  reminders.schedule(set);
  reminders.wake();
  reminders.schedule(set);
  expect(shown()).toEqual([["missed", "missed · reminder due at"]]);
});

test("a click opens the window on the reminder", () => {
  const { time, reminders, notifications, opened } = setup();
  reminders.schedule([reminder("call", NOW + MINUTE)]);
  time.advance(MINUTE);
  notifications[0]!.click();
  expect(opened).toEqual(["call"]);
});

test("with the window closed, the main process asks for a sync every 15 minutes and on resume, and checks the reminders on waking", () => {
  const time = fakeClock();
  const listeners = new Map<PowerEvent, () => void>();
  const asked: string[] = [];
  // As index.ts arms it: an interval on the same clock.
  const every = (ms: number, run: () => void) => {
    const tick = () => {
      run();
      time.clock.after(ms, tick);
    };
    time.clock.after(ms, tick);
  };
  backgroundTriggers({
    every,
    power: { on: (event, listener) => listeners.set(event, listener) },
    sync: () => asked.push(`sync at ${(time.clock.now() - NOW) / MINUTE}`),
    wake: () => asked.push(`wake at ${(time.clock.now() - NOW) / MINUTE}`),
  });
  time.advance(SYNC_EVERY_MS - 1);
  expect(asked).toEqual([]);
  time.advance(1 + SYNC_EVERY_MS);
  expect(asked).toEqual(["sync at 15", "sync at 30"]);
  // A night's sleep, then the machine resumes and the screen unlocks.
  time.sleep(8 * 60 * MINUTE);
  listeners.get("resume")!();
  listeners.get("unlock-screen")!();
  expect(asked.slice(2)).toEqual(["wake at 510", "sync at 510", "wake at 510"]);
});
