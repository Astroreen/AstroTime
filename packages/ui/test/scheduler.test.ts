// When the UI syncs (docs/plans/foundation.md#D91), on a fake page whose
// events and timers the test fires itself.
import type { SyncAllReport } from "@astrotime/sync";
import { expect, test } from "vite-plus/test";

import {
  CHANGE_DEBOUNCE_MS,
  REFOCUS_GAP_MS,
  SYNC_EVERY_MS,
  SyncScheduler,
  type SyncEnvironment,
} from "../src/accounts/scheduler.ts";

function fakePage() {
  let now = 1_000_000;
  let visible = true;
  let online = true;
  const listeners = new Map<string, Set<() => void>>();
  const timers = new Set<{ ms: number; run: () => void; repeat: boolean }>();
  const env: SyncEnvironment = {
    now: () => now,
    visible: () => visible,
    online: () => online,
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener);
      listeners.set(event, set);
      return () => set.delete(listener);
    },
    every(ms, run) {
      const timer = { ms, run, repeat: true };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    after(ms, run) {
      const timer = { ms, run, repeat: false };
      timers.add(timer);
      return () => timers.delete(timer);
    },
  };
  const fire = (event: string) => {
    for (const listener of listeners.get(event) ?? []) listener();
  };
  return {
    env,
    /** Fires every timer of `ms` once (the time it stands for passes). */
    tick(ms: number) {
      now += ms;
      for (const timer of [...timers].filter((t) => t.ms === ms)) {
        if (!timer.repeat) timers.delete(timer);
        timer.run();
      }
    },
    timers: (ms: number) => [...timers].filter((t) => t.ms === ms).length,
    pass: (ms: number) => (now += ms),
    show() {
      visible = true;
      fire("visible");
    },
    hide() {
      visible = false;
      fire("hidden");
    },
    goOffline() {
      online = false;
      fire("offline");
    },
    goOnline() {
      online = true;
      fire("online");
    },
  };
}

function recorder() {
  const calls: boolean[] = [];
  const report: SyncAllReport = { accounts: [], finishedAt: 0 };
  return { calls, sync: async (fresh: boolean) => (calls.push(fresh), report) };
}

test("syncs on start, every few minutes while visible, and when the page is back after a while", () => {
  const page = fakePage();
  const { calls, sync } = recorder();
  const stop = new SyncScheduler(sync, page.env).start();
  expect(calls).toEqual([false]);
  page.tick(SYNC_EVERY_MS);
  expect(calls).toHaveLength(2);

  // Hidden: no timer runs; back soon after the last sync: none is needed.
  page.hide();
  expect(page.timers(SYNC_EVERY_MS)).toBe(0);
  page.show();
  expect(calls).toHaveLength(2);
  // Back after longer: it syncs, and the timer runs again.
  page.hide();
  page.pass(REFOCUS_GAP_MS);
  page.show();
  expect(calls).toHaveLength(3);
  expect(page.timers(SYNC_EVERY_MS)).toBe(1);

  stop();
  expect(page.timers(SYNC_EVERY_MS)).toBe(0);
});

test("offline, the timer skips; the network coming back syncs at once", () => {
  const page = fakePage();
  const { calls, sync } = recorder();
  const scheduler = new SyncScheduler(sync, page.env);
  scheduler.start();
  page.goOffline();
  expect(scheduler.status.offline).toBe(true);
  page.tick(SYNC_EVERY_MS);
  expect(calls).toHaveLength(1);
  page.goOnline();
  expect([scheduler.status.offline, calls.length]).toEqual([false, 2]);
});

test("local changes go up once per burst, in a sync that starts after them", () => {
  const page = fakePage();
  const { calls, sync } = recorder();
  const scheduler = new SyncScheduler(sync, page.env);
  scheduler.start();
  scheduler.changed();
  scheduler.changed();
  scheduler.changed();
  expect(page.timers(CHANGE_DEBOUNCE_MS)).toBe(1);
  page.tick(CHANGE_DEBOUNCE_MS);
  expect(calls).toEqual([false, true]);
});

test("the status says a sync runs, and each account's last result and time", async () => {
  const page = fakePage();
  let finish: (report: SyncAllReport) => void = () => {};
  const scheduler = new SyncScheduler(
    () => new Promise<SyncAllReport>((resolve) => (finish = resolve)),
    page.env,
  );
  const report = {
    uploaded: 0,
    downloaded: 1,
    removed: 0,
    conflicts: 0,
    skipped: [],
    errors: [],
    dropped: [],
  };
  const first = scheduler.syncNow();
  expect(scheduler.status.running).toBe(true);
  finish({ accounts: [{ accountId: "a", status: "synced", report }], finishedAt: 10 });
  await first;
  const second = scheduler.syncNow();
  finish({
    accounts: [{ accountId: "a", status: "offline", detail: "offline", report: null }],
    finishedAt: 20,
  });
  await second;
  expect(scheduler.status.running).toBe(false);
  expect(scheduler.status.accounts.get("a")).toEqual({
    last: { accountId: "a", status: "offline", detail: "offline", report: null },
    syncedAt: 10,
  });
});
