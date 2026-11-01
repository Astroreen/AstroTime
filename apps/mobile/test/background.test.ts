// Background sync's page (docs/plans/android.md#D67) with native replaced:
// the channel's calls and answers, a run with nothing to sync, and a run that
// syncs through native's HTTP and credentials and hands the reminder set to
// native's notifications; the store closed whatever happens.
import { ALL_RIGHTS } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import type { Preferences } from "@astrotime/ui";
import { expect, test } from "vite-plus/test";

import { channel, NativeError, type NativePort } from "../src/background/channel.ts";
import { backgroundSync } from "../src/background/run.ts";

const NOW = Date.parse("2026-11-04T10:00:00Z");

/** Native as the page sees it: each call answered by `answer`, every message kept. */
function native(answer: (method: string, params: unknown) => { value: unknown } | NativeError) {
  const sent: { id?: number; method: string; params: unknown }[] = [];
  let listener: ((event: { data: unknown }) => void) | null = null;
  const port: NativePort = {
    postMessage(message) {
      const call = JSON.parse(message) as { id?: number; method: string; params: unknown };
      sent.push(call);
      if (call.id === undefined) return;
      const result = answer(call.method, call.params);
      const reply =
        result instanceof NativeError
          ? {
              id: call.id,
              ok: false,
              code: result.code,
              message: result.message,
              data: result.data,
            }
          : { id: call.id, ok: true, value: result.value };
      // As the WebView answers: later, as an event.
      queueMicrotask(() => listener?.({ data: JSON.stringify(reply) }));
    },
    addEventListener: (_type, next) => {
      listener = next;
    },
  };
  return { port, sent, methods: () => sent.map((call) => call.method) };
}

function memoryPreferences(): Preferences {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => void values.set(key, value),
  };
}

const alone = <T>(work: () => Promise<T>) => work();

function context(port: NativePort, store: Store) {
  let closed = false;
  const original = store.close.bind(store);
  store.close = async () => {
    closed = true;
    await original();
  };
  return {
    closed: () => closed,
    run: () =>
      backgroundSync({
        native: channel(port),
        openStore: async () => store,
        preferences: memoryPreferences(),
        languages: ["en-US"],
        timeZone: "UTC",
        syncLock: alone,
        remindersLock: alone,
        now: () => NOW,
      }),
  };
}

test("the channel answers each call under its id, a refusal with its code and data", async () => {
  const { port, sent } = native((method) =>
    method === "fails"
      ? new NativeError("No.", "cleartext", { origin: "http://a" })
      : { value: 42 },
  );
  const calls = channel(port);
  await expect(calls.call("works", { a: 1 })).resolves.toBe(42);
  const error = await calls.call("fails", {}).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(NativeError);
  expect(error).toMatchObject({ code: "cleartext", data: { origin: "http://a" }, message: "No." });
  calls.tell("done", { report: null });
  expect(sent).toEqual([
    { id: 1, method: "works", params: { a: 1 } },
    { id: 2, method: "fails", params: {} },
    { method: "done", params: { report: null } },
  ]);
});

test("signed out of every account: nothing is synced or scheduled, and the store is closed", async () => {
  const device = native(() => ({ value: null }));
  const run = context(device.port, await Store.open(nodeDriver()));
  await expect(run.run()).resolves.toEqual({ accounts: [], reminders: null });
  expect(device.sent).toEqual([]);
  expect(run.closed()).toBe(true);
});

test("each account syncs through native, and the reminder set goes to Android", async () => {
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "Radicale",
    serverUrl: "http://10.0.2.2:5232/",
    homeUrl: "http://10.0.2.2:5232/anna/",
    username: "anna",
  });
  const calendar = await store.saveCalendar({
    accountId: account.id,
    url: "http://10.0.2.2:5232/anna/work/",
    name: "Work",
    color: null,
    components: ["VEVENT"],
    rights: ALL_RIGHTS,
  });
  await store.saveLocal(
    calendar.id,
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:standup\r\nSUMMARY:Standup\r\nDTSTART:20261104T120000Z\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  );
  const device = native((method, params) => {
    if (method === "secrets.get") {
      expect(params).toEqual({ key: `account:${account.id}` });
      return { value: JSON.stringify({ username: "anna", password: "secret" }) };
    }
    // The server is not there: the account is offline, its change waits.
    if (method === "http") return new NativeError("Unreachable.", "offline", undefined);
    if (method === "notifications.check") return { value: { display: "granted" } };
    if (method === "notifications.exact") return { value: { exact_alarm: "granted" } };
    return { value: null };
  });
  const run = context(device.port, store);
  await expect(run.run()).resolves.toEqual({
    accounts: [{ accountId: account.id, status: "offline" }],
    reminders: 1,
  });
  // Plain http to the account's own server, as the open app allows it (D62).
  const http = device.sent.find((call) => call.method === "http")!.params as {
    cleartext: string[];
  };
  expect(http.cleartext).toEqual(["http://10.0.2.2:5232"]);
  const scheduled = device.sent.find((call) => call.method === "notifications.schedule")!
    .params as {
    notifications: { title: string; channelId: string; schedule: { at: string } }[];
  };
  expect(scheduled.notifications).toMatchObject([
    {
      title: "Standup",
      channelId: "reminders",
      schedule: { at: "2026-11-04T11:45:00.000Z", allowWhileIdle: true },
    },
  ]);
  expect(run.closed()).toBe(true);
});

test("a permission not granted in the background schedules nothing and asks no one", async () => {
  const store = await Store.open(nodeDriver());
  await store.addAccount({
    provider: "caldav",
    name: "R",
    serverUrl: "https://r.test/",
    username: "a",
  });
  const device = native((method) =>
    method === "notifications.check"
      ? { value: { display: "denied" } }
      : method === "notifications.exact"
        ? { value: { exact_alarm: "granted" } }
        : { value: null },
  );
  const report = await context(device.port, store).run();
  // No credentials kept: signed out, without a request.
  expect(report.accounts.map((a) => a.status)).toEqual(["signed-out"]);
  expect(device.methods()).not.toContain("http");
  expect(device.methods()).not.toContain("notifications.schedule");
});
