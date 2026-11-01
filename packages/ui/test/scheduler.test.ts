// When the UI syncs (docs/plans/foundation.md#D91), on a fake page whose
// events and timers the test fires itself.
import { ServerBusyError } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { saveAccount, syncAll, type Connect, type SyncAllReport } from "@astrotime/sync";
import { expect, test } from "vite-plus/test";

import { memoryServer } from "../../sync/test/memory-provider.ts";

import {
  CHANGE_DEBOUNCE_MS,
  REFOCUS_GAP_MS,
  SYNC_EVERY_MS,
  SyncScheduler,
  type SyncEnvironment,
  type SyncRequest,
} from "../src/accounts/scheduler.ts";
import { memorySecrets } from "./fakes.ts";

const todo = (summary: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VTODO\r\nUID:t\r\nDTSTAMP:20261101T080000Z\r\nSUMMARY:${summary}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;

function fakePage() {
  let now = 1_000_000;
  let visible = true;
  let online = true;
  const listeners = new Map<string, Set<() => void>>();
  const timers = new Set<{ ms: number; run: () => void; repeat: boolean; at: number }>();
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
      const timer = { ms, run, repeat: true, at: Number.POSITIVE_INFINITY };
      timers.add(timer);
      return () => timers.delete(timer);
    },
    after(ms, run) {
      const timer = { ms, run, repeat: false, at: now + ms };
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
    /** Fires every timer of `ms` once, now: it was set that long ago. */
    ring(ms: number) {
      for (const timer of [...timers].filter((t) => t.ms === ms)) {
        if (!timer.repeat) timers.delete(timer);
        timer.run();
      }
    },
    /** Lets `ms` pass: every one-off timer due by then fires. */
    elapse(ms: number) {
      now += ms;
      for (const timer of [...timers].filter((t) => !t.repeat && t.at <= now)) {
        timers.delete(timer);
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
  const requests: SyncRequest[] = [];
  let report: SyncAllReport = { accounts: [], finishedAt: 0, retryAt: null };
  return {
    calls,
    requests,
    /** What the next syncs report. */
    report: (next: SyncAllReport) => (report = next),
    sync: async (request: SyncRequest) => (
      calls.push(request.fresh),
      requests.push(request),
      report
    ),
  };
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

test("offline, the timer skips; the network coming back syncs at once", async () => {
  const page = fakePage();
  const { calls, sync, report } = recorder();
  report({
    accounts: [{ accountId: "a", status: "offline", detail: "offline", report: null }],
    finishedAt: 0,
    retryAt: null,
  });
  const scheduler = new SyncScheduler(sync, page.env);
  scheduler.start();
  page.goOffline();
  expect(scheduler.status.offline).toBe(true);
  page.tick(SYNC_EVERY_MS);
  expect(calls).toHaveLength(1);
  // The start's sync found the server offline: the network's return is due at once.
  await Promise.resolve();
  page.goOnline();
  expect([scheduler.status.offline, calls.length]).toEqual([false, 2]);
});

test("triggers together make one sync: focus, visibility, the timer and the network within a minute (D129)", async () => {
  const page = fakePage();
  const { calls, sync } = recorder();
  const scheduler = new SyncScheduler(sync, page.env);
  scheduler.start();
  await Promise.resolve();
  page.hide();
  page.pass(REFOCUS_GAP_MS);
  // The tab shown and the window focused: two events, one sync.
  page.show();
  page.show();
  expect(calls).toHaveLength(2);
  // The network flickers right after it: nothing new to ask.
  page.goOffline();
  page.goOnline();
  expect(calls).toHaveLength(2);
  // The timer's tick a moment after a local change's sync is left out too.
  page.pass(SYNC_EVERY_MS - CHANGE_DEBOUNCE_MS - 1_000);
  scheduler.changed();
  page.tick(CHANGE_DEBOUNCE_MS);
  expect(calls).toHaveLength(3);
  page.pass(1_000);
  page.ring(SYNC_EVERY_MS);
  expect(calls).toHaveLength(3);
});

test("a hidden tab does not sync when the network comes back; its next visit does", () => {
  const page = fakePage();
  const { calls, sync } = recorder();
  new SyncScheduler(sync, page.env).start();
  page.hide();
  page.goOffline();
  page.pass(REFOCUS_GAP_MS);
  page.goOnline();
  expect(calls).toHaveLength(1);
  page.show();
  expect(calls).toHaveLength(2);
});

test("only the user's Sync now retries accounts a server turned away; a shell's timer does not (D128)", async () => {
  const page = fakePage();
  const { requests, sync } = recorder();
  const scheduler = new SyncScheduler(sync, page.env);
  scheduler.start();
  await scheduler.syncNow();
  await scheduler.requested();
  scheduler.changed();
  page.tick(CHANGE_DEBOUNCE_MS);
  expect(requests).toEqual([
    { fresh: false, retry: false },
    { fresh: true, retry: true },
    { fresh: true, retry: false },
    { fresh: true, retry: false },
  ]);
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
  finish({
    accounts: [{ accountId: "a", status: "synced", report }],
    finishedAt: 10,
    retryAt: null,
  });
  await first;
  const second = scheduler.syncNow();
  finish({
    accounts: [{ accountId: "a", status: "offline", detail: "offline", report: null }],
    finishedAt: 20,
    retryAt: null,
  });
  await second;
  expect(scheduler.status.running).toBe(false);
  expect(scheduler.status.accounts.get("a")).toEqual({
    last: { accountId: "a", status: "offline", detail: "offline", report: null },
    syncedAt: 10,
  });
  // An account removed meanwhile is not in the next report, and leaves the status.
  const third = scheduler.syncNow();
  finish({ accounts: [], finishedAt: 30, retryAt: null });
  await third;
  expect(scheduler.status.accounts.has("a")).toBe(false);
});

test("a change made while a busy server is held goes up once the hold ends, with no one asking (D128)", async () => {
  const page = fakePage();
  const store = await Store.open(nodeDriver());
  const secrets = memorySecrets();
  const server = memoryServer("https://a.example/cal/");
  server.objects.set("https://a.example/cal/t.ics", { etag: '"1"', ics: todo("before") });
  let busy = false;
  const connect: Connect = async () => ({
    ...server,
    calendars: async () => {
      if (busy) throw new ServerBusyError("429", 60_000);
      return server.calendars();
    },
  });
  const context = { store, secrets, connect, now: page.env.now };
  await saveAccount(context, {
    name: "astro@a.example",
    serverUrl: "https://a.example/",
    homeUrl: "https://a.example/",
    credentials: { username: "astro", password: "pw" },
  });
  const scheduler = new SyncScheduler((request) => syncAll(context, request), page.env);
  /** Resolves once no sync runs. */
  const settled = () =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (scheduler.status.running) return;
        stop();
        resolve();
      };
      const stop = scheduler.subscribe(check);
      check();
    });
  scheduler.start();
  await settled();
  const [calendar] = await store.calendars();
  const [stored] = await store.hrefs(calendar!.id);

  // The server starts turning us away; an edit is made here meanwhile.
  busy = true;
  await store.saveLocal(calendar!.id, todo("after"));
  scheduler.changed();
  page.tick(CHANGE_DEBOUNCE_MS);
  await settled();
  // It waits on this device, and the account says changes wait.
  expect((await store.object(stored!.id))?.pending).toBe("update");
  expect(scheduler.status.accounts.values().next().value?.last.status).toBe("offline");

  // The server is back before the hold ends: nothing is asked of it until then.
  busy = false;
  page.elapse(59_000);
  await settled();
  expect((await store.object(stored!.id))?.pending).toBe("update");
  // The hold ends: a sync runs by itself, and the edit goes up.
  page.elapse(2_000);
  await settled();
  expect((await store.object(stored!.id))?.pending).toBe("none");
  expect(server.objects.get("https://a.example/cal/t.ics")?.ics).toContain("SUMMARY:after");
});
