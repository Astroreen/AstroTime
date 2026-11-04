// Subscriptions (docs/plans/providers.md#D251) through the sync engine and
// the store, against a fake server of the file: a conditional GET, objects
// added, changed and removed by UID, a bad answer that changes nothing, a
// removal of most of the calendar held until the user applies it.
import type { HttpClient, HttpRequest } from "@astrotime/caldav";
import { AuthError, type SecretStore } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { syncAccount, syncAll } from "../src/index.ts";
import { addSubscription, applyHeld } from "../src/subscriptions.ts";
import { expect, test } from "vite-plus/test";

import {
  calendarUrlOf,
  fingerprint,
  IcsProvider,
  NotCalendarError,
  subscriptionAddress,
} from "@astrotime/ics";

const ADDRESS = "https://calendar.example.org/feeds/team.ics";

const event = (uid: string, summary: string, extra = "") =>
  `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nDTSTART:20261110T090000Z\r\nDTEND:20261110T100000Z\r\nSUMMARY:${summary}\r\n${extra}END:VEVENT\r\n`;
const file = (...components: string[]) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Example//Feed//EN\r\nX-WR-CALNAME:Team\r\nX-APPLE-CALENDAR-COLOR:#3f7be0\r\n${components.join("")}END:VCALENDAR\r\n`;

/** The file's server: answers `body`, with an ETag of its version, and 304 to it. */
function server(initial: string) {
  let body = initial;
  let status = 200;
  let version = 1;
  const asked: HttpRequest[] = [];
  const http: HttpClient = async (request) => {
    asked.push(request);
    const etag = `"v${version}"`;
    const headers = new Map([
      ["etag", etag],
      ["content-type", "text/calendar"],
    ]);
    if (status === 200 && request.headers["If-None-Match"] === etag)
      return { status: 304, url: request.url, header: () => null, body: "" };
    return { status, url: request.url, header: (name) => headers.get(name) ?? null, body };
  };
  return {
    http,
    asked,
    serve(next: string, nextStatus = 200) {
      body = next;
      status = nextStatus;
      version += 1;
    },
  };
}

async function subscribed(initial: string) {
  const files = server(initial);
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "ics",
    name: "Team",
    serverUrl: new URL(ADDRESS).origin,
    username: null,
  });
  const calendarUrl = calendarUrlOf(ADDRESS);
  let apply: string | null = null;
  const sync = async () => {
    const [kept] = await store.calendars(account.id);
    const provider = new IcsProvider(
      files.http,
      { url: ADDRESS, apply },
      calendarUrl,
      kept ?? null,
    );
    return syncAccount(store, provider, account.id);
  };
  const summaries = async () => {
    const [calendar] = await store.calendars(account.id);
    const objects = await store.objectsBetween([calendar!.id], {
      from: "2026-11-01",
      to: "2026-12-01",
      timeZone: "UTC",
    });
    return objects.map((o) => /SUMMARY:(.*)\r\n/.exec(o.ics)?.[1]).toSorted();
  };
  return { files, store, account, sync, summaries, apply: (version: string) => (apply = version) };
}

test("a subscription is one read-only calendar named and coloured by its file, an object per UID", async () => {
  const feed = await subscribed(file(event("a", "Planning"), event("b", "Review")));
  await feed.sync();
  const [calendar] = await feed.store.calendars(feed.account.id);
  expect(calendar).toMatchObject({
    name: "Team",
    color: "#3f7be0",
    rights: { create: false, edit: false, delete: false },
  });
  expect(await feed.summaries()).toEqual(["Planning", "Review"]);
  const hrefs = (await feed.store.hrefs(calendar!.id)).map((entry) => entry.href);
  expect(hrefs.toSorted()).toEqual([`${calendar!.url}#a`, `${calendar!.url}#b`]);
  // The address, which may hold a secret, is nowhere in the store.
  expect(calendar!.url).toMatch(/^ics:[0-9a-f]{28}$/);
  expect(JSON.stringify(await feed.store.accounts())).not.toContain("feeds/team.ics");
});

test("an unchanged file costs one conditional GET and changes nothing; a changed one adds, changes and removes by UID", async () => {
  const feed = await subscribed(
    file(event("a", "Planning"), event("b", "Review"), event("c", "Lunch")),
  );
  await feed.sync();
  const second = await feed.sync();
  expect(feed.files.asked.at(-1)?.headers["If-None-Match"]).toBe('"v1"');
  expect(second).toMatchObject({ downloaded: 0, removed: 0 });

  feed.files.serve(file(event("a", "Planning moved"), event("c", "Lunch"), event("d", "Retro")));
  const third = await feed.sync();
  expect(third).toMatchObject({ removed: 1 });
  expect(await feed.summaries()).toEqual(["Lunch", "Planning moved", "Retro"]);
});

test("a series keeps its exceptions in one object", async () => {
  const feed = await subscribed(
    file(
      event("weekly", "Standup", "RRULE:FREQ=WEEKLY;COUNT=3\r\n"),
      `BEGIN:VEVENT\r\nUID:weekly\r\nRECURRENCE-ID:20261117T090000Z\r\nDTSTAMP:20261101T080000Z\r\nDTSTART:20261117T110000Z\r\nDTEND:20261117T120000Z\r\nSUMMARY:Standup, later\r\nEND:VEVENT\r\n`,
    ),
  );
  await feed.sync();
  const [calendar] = await feed.store.calendars(feed.account.id);
  const [only, ...more] = (await feed.store.hrefs(calendar!.id)).map((entry) => entry.href);
  expect(more).toEqual([]);
  const object = await feed.store.objectAt(calendar!.id, only!);
  expect(object?.ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
});

test("a sign-in page, an empty or a cut answer is a failed sync that changes nothing", async () => {
  const feed = await subscribed(file(event("a", "Planning"), event("b", "Review")));
  await feed.sync();
  for (const bad of [
    "<!doctype html><title>Sign in</title>",
    "",
    file(event("a", "Planning")).replace("END:VCALENDAR\r\n", ""),
  ]) {
    feed.files.serve(bad);
    await expect(feed.sync()).rejects.toThrow(NotCalendarError);
    expect(await feed.summaries()).toEqual(["Planning", "Review"]);
  }
});

test("a file that would empty the calendar, or take most of a big one, is held until the user applies it", async () => {
  const feed = await subscribed(file(event("a", "Planning"), event("b", "Review")));
  await feed.sync();
  feed.files.serve(file());
  // The sync goes on, its report saying what waits for the user.
  const report = await feed.sync();
  const [held] = report.errors;
  expect(held).toMatchObject({ problem: "held-removal", held: { count: 2 } });
  expect(await feed.summaries()).toEqual(["Planning", "Review"]);
  // The user applies that very file: it goes through.
  feed.apply(held!.held!.version);
  await feed.sync();
  expect(await feed.summaries()).toEqual([]);

  // Of 20 or more, more than half at once is held; fewer go as usual.
  const many = Array.from({ length: 20 }, (_, i) => event(`e${i}`, `Event ${i}`));
  const big = await subscribed(file(...many));
  await big.sync();
  // Eleven of twenty at once: held; eight: as usual.
  big.files.serve(file(...many.slice(0, 9)));
  expect((await big.sync()).errors[0]?.problem).toBe("held-removal");
  expect(await big.summaries()).toHaveLength(20);
  big.files.serve(file(...many.slice(0, 12)));
  expect((await big.sync()).errors).toEqual([]);
  expect(await big.summaries()).toHaveLength(12);
});

test("a refused subscription signs out; nothing is ever written to one", async () => {
  const feed = await subscribed(file(event("a", "Planning")));
  feed.files.serve("Forbidden", 403);
  await expect(feed.sync()).rejects.toThrow(AuthError);
  const provider = new IcsProvider(feed.files.http, { url: ADDRESS, apply: null }, "ics:x", null);
  await expect(provider.create()).rejects.toThrow(/read-only/);
  expect(feed.files.asked.every((request) => request.method === "GET")).toBe(true);
});

test("webcal:// is https; a typed address without a scheme is https", () => {
  expect(subscriptionAddress("webcal://calendar.example.org/a.ics")).toBe(
    "https://calendar.example.org/a.ics",
  );
  expect(subscriptionAddress("calendar.example.org/a.ics")).toBe(
    "https://calendar.example.org/a.ics",
  );
  expect(subscriptionAddress("ftp://x/a.ics")).toBeNull();
});

function memorySecrets(): SecretStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
}

test("subscribing reads the file first, keeps the address as a secret, and syncs it at most hourly unless the user asks", async () => {
  const files = server(file(event("a", "Planning")));
  const store = await Store.open(nodeDriver());
  const secrets = memorySecrets();
  const http = files.http;
  // A page that is no calendar adds nothing.
  files.serve("<!doctype html><title>Sign in</title>");
  await expect(addSubscription({ store, secrets, http }, ADDRESS)).rejects.toThrow(
    NotCalendarError,
  );
  expect(await store.accounts()).toEqual([]);
  expect(await addSubscription({ store, secrets, http }, "not an address at all")).toBeNull();

  files.serve(file(event("a", "Planning")));
  const found = await addSubscription(
    { store, secrets, http },
    "webcal://calendar.example.org/feeds/team.ics",
  );
  expect(found).toMatchObject({
    added: true,
    account: { provider: "ics", name: "Team", serverUrl: "https://calendar.example.org" },
  });
  const [secret] = secrets.values.values();
  expect(JSON.parse(secret!)).toEqual({ subscription: ADDRESS, apply: null });
  // The same address again finds the same account.
  expect((await addSubscription({ store, secrets, http }, ADDRESS))?.added).toBe(false);

  let time = Date.UTC(2026, 10, 4, 9);
  const context = {
    store,
    secrets,
    http,
    connect: () => Promise.reject(new Error("no CalDAV here")),
    now: () => time,
  };
  const first = await syncAll(context);
  expect(first.accounts).toMatchObject([{ status: "synced" }]);
  const asked = files.asked.length;
  // Within the hour: no request; the last result stands.
  time += 30 * 60_000;
  expect((await syncAll(context, { fresh: true })).accounts).toMatchObject([{ status: "synced" }]);
  expect(files.asked.length).toBe(asked);
  // The user's own "Sync now" asks at once; past the hour, a sync does too.
  await syncAll(context, { retry: true });
  expect(files.asked.length).toBe(asked + 1);
  time += 61 * 60_000;
  await syncAll(context, { fresh: true });
  expect(files.asked.length).toBe(asked + 2);
  expect(await subscribedSummaries(store, found!.account.id)).toEqual(["Planning"]);
});

test("a held removal is applied once the user lets that version of the file through", async () => {
  const files = server(file(event("a", "Planning"), event("b", "Review")));
  const store = await Store.open(nodeDriver());
  const secrets = memorySecrets();
  const context = {
    store,
    secrets,
    http: files.http,
    connect: () => Promise.reject(new Error("none")),
  };
  const { account } = (await addSubscription(context, ADDRESS))!;
  await syncAll(context);
  files.serve(file());
  const report = await syncAll(context, { retry: true });
  const held =
    report.accounts[0]?.status === "synced" ? report.accounts[0].report.errors[0] : undefined;
  expect(held).toMatchObject({ problem: "held-removal", held: { count: 2 } });
  expect(await subscribedSummaries(store, account.id)).toEqual(["Planning", "Review"]);
  await applyHeld(context, account.id, held!.held!.version);
  await syncAll(context, { retry: true });
  expect(await subscribedSummaries(store, account.id)).toEqual([]);
});

async function subscribedSummaries(store: Store, accountId: string) {
  const [calendar] = await store.calendars(accountId);
  const objects = await store.objectsBetween([calendar!.id], {
    from: "2026-11-01",
    to: "2026-12-01",
    timeZone: "UTC",
  });
  return objects.map((o) => /SUMMARY:(.*)\r\n/.exec(o.ics)?.[1]).toSorted();
}

test("a subscription needs no Web Crypto: its ids and versions are the same on a page over plain http", async () => {
  // As a page over plain http has it: no `crypto.subtle` (an own property
  // over the prototype's getter, taken off again after).
  Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
  try {
    const feed = await subscribed(file(event("a", "Planning")));
    await feed.sync();
    expect(await feed.summaries()).toEqual(["Planning"]);
  } finally {
    delete (globalThis.crypto as { subtle?: unknown }).subtle;
  }
  expect(globalThis.crypto.subtle).toBeDefined();
  // Stable and distinct: the same text, the same fingerprint.
  expect(fingerprint("a")).toBe(fingerprint("a"));
  expect(fingerprint("a")).not.toBe(fingerprint("b"));
  expect(fingerprint("")).toMatch(/^[0-9a-f]{28}$/);
});

test("a sync that said a problem is read again at the next chance, not left alone for the hour", async () => {
  const files = server(file(event("a", "Planning"), event("b", "Review")));
  const store = await Store.open(nodeDriver());
  const secrets = memorySecrets();
  const context = {
    store,
    secrets,
    http: files.http,
    connect: () => Promise.reject(new Error("none")),
  };
  await addSubscription(context, ADDRESS);
  await syncAll(context);
  files.serve(file());
  await syncAll(context, { retry: true });
  const asked = files.asked.length;
  // Held: the next automatic sync reads again, so the file's next version is seen.
  await syncAll(context, { fresh: true });
  expect(files.asked.length).toBe(asked + 1);
});

test("an applied removal is used up: the same big drop later asks again", async () => {
  const two = file(event("a", "Planning"), event("b", "Review"));
  const files = server(two);
  const store = await Store.open(nodeDriver());
  const secrets = memorySecrets();
  const context = {
    store,
    secrets,
    http: files.http,
    connect: () => Promise.reject(new Error("none")),
  };
  const { account } = (await addSubscription(context, ADDRESS))!;
  await syncAll(context);
  files.serve(file());
  const errorsOf = (report: Awaited<ReturnType<typeof syncAll>>) =>
    report.accounts[0]?.status === "synced" ? report.accounts[0].report.errors : [];
  const [held] = errorsOf(await syncAll(context, { retry: true }));
  await applyHeld(context, account.id, held!.held!.version);
  await syncAll(context, { retry: true });
  expect(await subscribedSummaries(store, account.id)).toEqual([]);
  expect(JSON.parse([...secrets.values.values()][0]!)).toMatchObject({ apply: null });
  // Back to two items, then the very same empty file again: held again.
  files.serve(two);
  await syncAll(context, { retry: true });
  files.serve(file());
  expect(errorsOf(await syncAll(context, { retry: true }))[0]?.problem).toBe("held-removal");
  expect(await subscribedSummaries(store, account.id)).toEqual(["Planning", "Review"]);
});

test("whatever a provider throws, undefined too, stays that calendar's problem (foundation D37)", async () => {
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "x",
    serverUrl: "https://dav.example",
    username: null,
  });
  const calendar = (url: string) => ({
    url,
    name: url,
    color: null,
    components: ["VEVENT" as const],
    rights: { create: false, edit: false, delete: false },
  });
  const report = await syncAccount(
    store,
    {
      calendars: async () => [
        calendar("https://dav.example/a/"),
        calendar("https://dav.example/b/"),
      ],
      changes: async (url) => {
        // oxlint-disable-next-line no-throw-literal -- what a careless provider may do
        if (url.endsWith("/a/")) throw undefined;
        return { changed: [], removed: [], syncToken: "t", ctag: null };
      },
      fetch: async () => null,
      create: async () => ({ ok: false, reason: "gone" }),
      update: async () => ({ ok: false, reason: "gone" }),
      remove: async () => ({ ok: false, reason: "gone" }),
    },
    account.id,
  );
  expect(report.errors).toEqual([
    { href: "https://dav.example/a/", problem: "failed", detail: "undefined" },
  ]);
  // The other calendar synced: its token is kept.
  const [, b] = await store.calendars(account.id);
  expect(b?.syncToken).toBe("t");
});
