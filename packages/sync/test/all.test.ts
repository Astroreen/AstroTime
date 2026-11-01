// `syncAll`, the one sync entry every shell calls (docs/plans/android.md#D60,
// docs/plans/foundation.md#D90), and the accounts it syncs.
import type { HttpClient } from "@astrotime/caldav";
import { AuthError, OfflineError, type Provider, type SecretStore } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { expect, test } from "vite-plus/test";

import { removeAccount, saveAccount, syncAll, type Connect, type SyncLock } from "../src/index.ts";
import { memoryServer, type MemoryServer } from "./memory-provider.ts";

const task = (uid: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nSUMMARY:${uid}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;

function memorySecrets(): SecretStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
}

/** A promise the test resolves itself, to hold a sync in the middle. */
function gate() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** Servers by home URL; each connection is counted, and may wait at a gate. */
function servers(byHome: Record<string, MemoryServer>) {
  const connections: string[] = [];
  let hold: Promise<void> | null = null;
  const held: (() => void)[] = [];
  const connect: Connect = async (account, credentials) => {
    connections.push(`${account.homeUrl} as ${credentials.username}`);
    const server = byHome[account.homeUrl!]!;
    if (credentials.password !== "right") {
      return {
        ...server,
        calendars: async () => {
          throw new AuthError("refused");
        },
      };
    }
    const waiting = hold;
    if (!waiting) return server;
    return {
      ...server,
      calendars: async () => {
        for (const reached of held.splice(0)) reached();
        await waiting;
        return server.calendars();
      },
    } satisfies Provider;
  };
  return {
    connect,
    connections,
    holdAt: (at: Promise<void> | null) => (hold = at),
    /** Resolves once a sync waits at the gate, inside an account. */
    reached: () => new Promise<void>((resolve) => held.push(resolve)),
  };
}

async function setup() {
  const driver = nodeDriver();
  const store = await Store.open(driver);
  const secrets = memorySecrets();
  const a = memoryServer("https://a.example/cal/");
  const b = memoryServer("https://b.example/cal/");
  a.objects.set("https://a.example/cal/one.ics", { etag: '"1"', ics: task("one") });
  b.objects.set("https://b.example/cal/two.ics", { etag: '"1"', ics: task("two") });
  const net = servers({ "https://a.example/": a, "https://b.example/": b });
  const context = { store, secrets, connect: net.connect };
  const add = (host: string, password = "right") =>
    saveAccount(context, {
      name: `astro@${host}`,
      serverUrl: `https://${host}/`,
      homeUrl: `https://${host}/`,
      credentials: { username: "astro", password },
    });
  return { driver, store, secrets, a, b, net, context, add };
}

/** A lock the instances of one store share, as the web's tabs share a Web Lock (D91). */
function sharedLock(): SyncLock {
  let last: Promise<unknown> = Promise.resolve();
  return (work) => {
    const run = last.then(work);
    last = run.catch(() => {});
    return run;
  };
}

test("every account syncs and reports how it went; the demo's never does", async () => {
  const { store, a, context, add } = await setup();
  const first = (await add("a.example")).account;
  const second = (await add("b.example", "wrong")).account;
  await store.addAccount({
    provider: "demo",
    name: "Demo",
    serverUrl: "https://demo.astrotime.invalid/",
    username: null,
  });
  const report = await syncAll(context);
  expect(report.accounts.map((r) => [r.accountId, r.status])).toEqual([
    [first.id, "synced"],
    [second.id, "signed-out"],
  ]);
  expect(
    (await store.undated((await store.calendars()).map((c) => c.id))).map((o) => o.uid),
  ).toEqual(["one"]);

  a.offline = true;
  expect((await syncAll(context)).accounts[0]).toMatchObject({
    accountId: first.id,
    status: "offline",
  });
});

test("an account whose credentials are missing or unreadable asks to sign in again", async () => {
  const { secrets, context, add } = await setup();
  const { account } = await add("a.example");
  secrets.values.set(`account:${account.id}`, "not json");
  expect((await syncAll(context)).accounts).toEqual([
    expect.objectContaining({ accountId: account.id, status: "signed-out", report: null }),
  ]);
});

test("a call while a sync runs joins it instead of starting a second", async () => {
  const { net, context, add } = await setup();
  await add("a.example");
  const held = gate();
  net.holdAt(held.opened);
  const first = syncAll(context);
  const second = syncAll(context);
  expect(second).toBe(first);
  held.open();
  await first;
  expect(net.connections).toEqual(["https://a.example/ as astro"]);
});

test("a fresh call while a sync runs gets one more sync after it, shared by every such call", async () => {
  const { store, net, context, add } = await setup();
  await add("a.example");
  const held = gate();
  net.holdAt(held.opened);
  const running = syncAll(context);
  // Added while the first sync runs: only a sync that starts later sees it.
  const late = (await add("b.example")).account;
  const fresh = syncAll(context, { fresh: true });
  const again = syncAll(context, { fresh: true });
  expect(again).toBe(fresh);
  expect(fresh).not.toBe(running);
  net.holdAt(null);
  held.open();
  expect((await running).accounts.map((r) => r.accountId)).not.toContain(late.id);
  expect((await fresh).accounts.map((r) => [r.accountId, r.status])).toContainEqual([
    late.id,
    "synced",
  ]);
  expect(net.connections).toHaveLength(3);
  expect((await store.calendars(late.id)).map((c) => c.url)).toEqual(["https://b.example/cal/"]);
});

test("credentials go to the secret store, never the local store; signing in again replaces them", async () => {
  const { store, secrets, add } = await setup();
  const driver = nodeDriver();
  const raw = await Store.open(driver);
  const added = await saveAccount(
    { store: raw, secrets },
    {
      name: "astro@a.example",
      serverUrl: "https://a.example/",
      homeUrl: "https://a.example/",
      credentials: { username: "astro", password: "s3cret-password" },
    },
  );
  expect(added.added).toBe(true);
  const tables = await driver.query("SELECT name FROM sqlite_master WHERE type = 'table'", []);
  for (const [table] of tables) {
    const rows = await driver.query(`SELECT * FROM ${String(table)}`, []);
    expect(JSON.stringify(rows)).not.toContain("s3cret-password");
  }
  expect(JSON.parse(secrets.values.get(`account:${added.account.id}`)!)).toEqual({
    username: "astro",
    password: "s3cret-password",
  });

  const first = await add("a.example", "old");
  const again = await add("a.example", "right");
  expect([again.added, again.account.id]).toEqual([false, first.account.id]);
  expect(await store.accounts()).toHaveLength(1);
  expect(JSON.parse(secrets.values.get(`account:${first.account.id}`)!).password).toBe("right");
});

test("two sign-ins to one account at once add it once, whichever comes first (D90)", async () => {
  for (const order of [
    ["first", "second"],
    ["second", "first"],
  ]) {
    const { store, secrets, add } = await setup();
    const [one, two] = await Promise.all(order.map((password) => add("a.example", password)));
    expect([one!.added, two!.added]).toEqual([true, false]);
    expect(two!.account.id).toBe(one!.account.id);
    expect(await store.accounts()).toHaveLength(1);
    // The later sign-in's password is the one kept.
    expect(JSON.parse(secrets.values.get(`account:${one!.account.id}`)!).password).toBe(order[1]);
  }
});

/** A Nextcloud answering only the app password's revocation, or no server at all. */
function nextcloud(reachable = true) {
  const revoked: string[] = [];
  const http: HttpClient = async (request) => {
    if (!reachable) throw new OfflineError(`${request.url} could not be reached.`);
    revoked.push(`${request.method} ${request.url} ${request.headers["Authorization"]}`);
    return { status: 200, url: request.url, header: () => null, body: "{}" };
  };
  return { http, revoked };
}

test("removing an account Login Flow added revokes its app password on the server, after it is gone here", async () => {
  const { store, secrets, context } = await setup();
  const viaFlow = (host: string) =>
    saveAccount(context, {
      name: `astro@${host}`,
      serverUrl: `https://${host}/`,
      homeUrl: `https://${host}/`,
      credentials: { username: "astro", password: "app-pass" },
      loginFlow: true,
    });
  const { account } = await viaFlow("a.example");
  expect(JSON.parse(secrets.values.get(`account:${account.id}`)!)).toEqual({
    username: "astro",
    password: "app-pass",
    loginFlow: true,
  });
  const server = nextcloud();
  expect(await removeAccount({ ...context, http: server.http }, account.id)).toBe("revoked");
  expect(server.revoked).toEqual([
    `DELETE https://a.example/ocs/v2.php/core/apppassword Basic ${btoa("astro:app-pass")}`,
  ]);
  expect([await store.accounts(), secrets.values.size]).toEqual([[], 0]);

  // Offline: removed all the same, and the user is told the password is still valid there.
  const other = (await viaFlow("b.example")).account;
  expect(await removeAccount({ ...context, http: nextcloud(false).http }, other.id)).toBe("kept");
  expect([await store.accounts(), secrets.values.size]).toEqual([[], 0]);

  // A server that never answers holds nothing: the removal is done, the password said kept.
  const third = (await viaFlow("c.example")).account;
  const stalled: HttpClient = () => new Promise(() => {});
  expect(await removeAccount({ ...context, http: stalled, revokeWaitMs: 0 }, third.id)).toBe(
    "kept",
  );
  expect(await store.accounts()).toEqual([]);
});

test("a password the user typed is not revoked: removing asks nothing of the server", async () => {
  const { context, add } = await setup();
  const { account } = await add("a.example");
  const server = nextcloud();
  expect(await removeAccount({ ...context, http: server.http }, account.id)).toBe("none");
  expect(server.revoked).toEqual([]);
});

test("removing an account waits for a running sync, then deletes its secret and its data", async () => {
  const { store, secrets, net, context, add } = await setup();
  const { account } = await add("a.example");
  await syncAll(context);
  expect(await store.calendars(account.id)).toHaveLength(1);
  const held = gate();
  net.holdAt(held.opened);
  const running = syncAll(context);
  const removing = removeAccount(context, account.id);
  held.open();
  await Promise.all([running, removing]);
  expect(await store.accounts()).toEqual([]);
  expect(await store.calendars()).toEqual([]);
  expect(secrets.values.size).toBe(0);
});

test("a sync queued behind the running one leaves an account being removed alone", async () => {
  const { store, secrets, net, context, add } = await setup();
  const { account } = await add("a.example");
  const held = gate();
  net.holdAt(held.opened);
  const inside = net.reached();
  const running = syncAll(context);
  await inside;
  const queued = syncAll(context, { fresh: true });
  const removing = removeAccount(context, account.id);
  net.holdAt(null);
  held.open();
  await Promise.all([running, removing]);
  expect((await queued).accounts).toEqual([]);
  // Only the sync begun before the removal reached the server.
  expect(net.connections).toHaveLength(1);
  expect([await store.accounts(), await store.calendars(), secrets.values.size]).toEqual([
    [],
    [],
    0,
  ]);
});

test("with the platform's lock, another instance's sync waits for the running one, so a change goes up once", async () => {
  const { driver, store, secrets, a, net, add } = await setup();
  const { account } = await add("a.example");
  // Two instances of the store on one database, as the web's tabs (D98).
  const other = await Store.open(driver);
  const lock = sharedLock();
  await syncAll({ store, secrets, connect: net.connect, lock });
  const [calendar] = await store.calendars(account.id);
  await store.saveLocal(calendar!.id, task("new"));
  const writes: string[] = [];
  a.beforeWrite = (method, href) => void writes.push(`${method} ${href}`);

  const held = gate();
  net.holdAt(held.opened);
  const inside = net.reached();
  const first = syncAll({ store, secrets, connect: net.connect, lock });
  await inside;
  // The other instance's change: a sync that starts after this call.
  const second = syncAll({ store: other, secrets, connect: net.connect, lock }, { fresh: true });
  net.holdAt(null);
  held.open();
  const reports = await Promise.all([first, second]);
  expect(reports.map((report) => report.accounts.map((r) => r.status))).toEqual([
    ["synced"],
    ["synced"],
  ]);
  expect(writes).toEqual([`create https://a.example/cal/new.ics`]);
});

test("with the platform's lock, removing an account waits for another instance's sync inside it", async () => {
  const { driver, store, secrets, net, add } = await setup();
  const { account } = await add("a.example");
  const other = await Store.open(driver);
  const lock = sharedLock();
  const held = gate();
  net.holdAt(held.opened);
  const inside = net.reached();
  const running = syncAll({ store, secrets, connect: net.connect, lock });
  await inside;
  const removing = removeAccount({ store: other, secrets, lock }, account.id);
  held.open();
  const [report] = await Promise.all([running, removing]);
  // The sync ended whole, its account still there; then it went.
  expect(report.accounts).toEqual([
    expect.objectContaining({ status: "synced", report: expect.objectContaining({ errors: [] }) }),
  ]);
  expect([await store.accounts(), await store.calendars(), secrets.values.size]).toEqual([
    [],
    [],
    0,
  ]);
});

test("signing in again revokes the app password Login Flow gave the one replaced, never one typed", async () => {
  const { secrets, context } = await setup();
  const server = nextcloud();
  const signIn = (password: string, loginFlow: boolean, http: HttpClient | null = server.http) =>
    saveAccount(
      { ...context, ...(http ? { http } : {}) },
      {
        name: "astro@a.example",
        serverUrl: "https://a.example/",
        homeUrl: "https://a.example/",
        credentials: { username: "astro", password },
        loginFlow,
      },
    );
  const typed = await signIn("typed", false);
  expect(await typed.replaced).toBe("none");
  // A password the user typed is theirs: replaced, never revoked.
  expect(await (await signIn("app-1", true)).replaced).toBe("none");
  expect(await (await signIn("app-2", true)).replaced).toBe("revoked");
  expect(server.revoked).toEqual([
    `DELETE https://a.example/ocs/v2.php/core/apppassword Basic ${btoa("astro:app-1")}`,
  ]);
  expect(JSON.parse(secrets.values.get(`account:${typed.account.id}`)!).password).toBe("app-2");
  // The same password again replaces nothing; offline, the old one is said kept.
  expect(await (await signIn("app-2", true)).replaced).toBe("none");
  expect(await (await signIn("app-3", true, nextcloud(false).http)).replaced).toBe("kept");
  expect(await (await signIn("app-4", true, null)).replaced).toBe("kept");
  expect(server.revoked).toHaveLength(1);
});

test("signing in as another user of the same calendar home adds that user, never takes over", async () => {
  const { store, secrets, context } = await setup();
  const as = (username: string) =>
    saveAccount(context, {
      name: `${username}@a.example`,
      serverUrl: "https://a.example/",
      homeUrl: "https://a.example/",
      credentials: { username, password: "right" },
    });
  const astro = await as("astro");
  const other = await as("other");
  expect(other.added).toBe(true);
  expect((await store.accounts()).map((a) => a.username)).toEqual(["astro", "other"]);
  expect(JSON.parse(secrets.values.get(`account:${astro.account.id}`)!).username).toBe("astro");
});
