// `syncAll`, the one sync entry every shell calls (docs/plans/android.md#D60,
// docs/plans/foundation.md#D90), and the accounts it syncs.
import type { HttpClient } from "@astrotime/caldav";
import {
  AuthError,
  OfflineError,
  ServerBusyError,
  type Provider,
  type SecretStore,
} from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

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
  // A typed password over Login Flow's: Login Flow's is revoked all the same.
  expect(await (await signIn("typed-again", false)).replaced).toBe("revoked");
  expect(server.revoked.at(-1)).toBe(
    `DELETE https://a.example/ocs/v2.php/core/apppassword Basic ${btoa("astro:app-4")}`,
  );
});

test("signing in again repairs credentials the secret store cannot read: the new ones are saved", async () => {
  const { secrets, context, add } = await setup();
  const { account } = await add("a.example", "old");
  const get = secrets.get;
  secrets.get = () => Promise.reject(new Error("Keystore unavailable."));
  const again = await saveAccount(
    { ...context, http: nextcloud().http },
    {
      name: "astro@a.example",
      serverUrl: "https://a.example/",
      homeUrl: "https://a.example/",
      credentials: { username: "astro", password: "new" },
      loginFlow: true,
    },
  );
  secrets.get = get;
  expect([again.added, again.account.id, await again.replaced]).toEqual([
    false,
    account.id,
    "none",
  ]);
  expect(JSON.parse(secrets.values.get(`account:${account.id}`)!).password).toBe("new");
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

describe("an account a server turned away is left alone for a while (D128)", () => {
  /** One account on a server that answers as `answer` says, its tries counted. */
  async function turnedAway() {
    const store = await Store.open(nodeDriver());
    const secrets = memorySecrets();
    const server = memoryServer("https://a.example/cal/");
    let answer: () => Promise<void> = async () => {};
    let tries = 0;
    let time = 1_000_000;
    const connect: Connect = async () => ({
      ...server,
      calendars: async () => {
        tries++;
        await answer();
        return server.calendars();
      },
    });
    const context = { store, secrets, connect, now: () => time };
    const { account } = await saveAccount(context, {
      name: "astro@a.example",
      serverUrl: "https://a.example/",
      homeUrl: "https://a.example/",
      credentials: { username: "astro", password: "old" },
    });
    return {
      context,
      account,
      tries: () => tries,
      answer: (next: () => Promise<void>) => (answer = next),
      pass: (ms: number) => (time += ms),
    };
  }

  test("refused credentials are not tried again until they change, or the user asks", async () => {
    const { context, account, tries, answer } = await turnedAway();
    answer(async () => {
      throw new AuthError("refused");
    });
    const first = await syncAll(context);
    expect(first.accounts[0]).toMatchObject({ status: "signed-out" });
    // Every trigger meanwhile hears the same, without a request.
    expect((await syncAll(context, { fresh: true })).accounts).toEqual(first.accounts);
    expect(tries()).toBe(1);
    // "Sync now" is the user's: it tries.
    await syncAll(context, { retry: true });
    expect(tries()).toBe(2);
    // Signed in again: new credentials are tried at once.
    answer(async () => {});
    await saveAccount(context, {
      name: account.name,
      serverUrl: account.serverUrl,
      homeUrl: account.homeUrl!,
      credentials: { username: "astro", password: "new" },
    });
    expect((await syncAll(context)).accounts[0]).toMatchObject({ status: "synced" });
    expect(tries()).toBe(3);
  });

  test("a 429 or 503 holds the server for its Retry-After, when longer than the backoff's step", async () => {
    const { context, tries, answer, pass } = await turnedAway();
    answer(async () => {
      throw new ServerBusyError("429", 120_000);
    });
    expect((await syncAll(context)).accounts[0]).toMatchObject({ status: "offline" });
    pass(119_000);
    await syncAll(context, { fresh: true });
    expect(tries()).toBe(1);
    answer(async () => {});
    pass(1_000);
    expect((await syncAll(context)).accounts[0]).toMatchObject({ status: "synced" });
    expect(tries()).toBe(2);
  });

  test("without Retry-After, a busy or failing server waits a minute, then twice as long each time, up to half an hour", async () => {
    const { context, tries, answer, pass } = await turnedAway();
    answer(async () => {
      throw new ServerBusyError("503", null);
    });
    await syncAll(context);
    const waits: number[] = [];
    for (let strike = 1; strike <= 7; strike++) {
      // Each wait is its step, give or take a fifth: tried only once it has passed.
      let waited = 0;
      while (tries() === strike) {
        pass(1_000);
        waited += 1_000;
        await syncAll(context);
      }
      waits.push(waited);
    }
    const steps = [1, 2, 4, 8, 16, 30, 30].map((minutes) => minutes * 60_000);
    waits.forEach((waited, i) => {
      expect(waited).toBeGreaterThanOrEqual(steps[i]! * 0.8);
      expect(waited).toBeLessThanOrEqual(steps[i]! * 1.2 + 1_000);
    });
    // A server back on its feet clears the count.
    answer(async () => {});
    pass(60 * 60_000);
    expect((await syncAll(context)).accounts[0]).toMatchObject({ status: "synced" });
  });

  test("a Retry-After of 0, or a date gone by, never holds less than the backoff's step", async () => {
    const { context, tries, answer, pass } = await turnedAway();
    answer(async () => {
      throw new ServerBusyError("429", 0);
    });
    await syncAll(context);
    const waits: number[] = [];
    for (let strike = 1; strike <= 3; strike++) {
      let waited = 0;
      while (tries() === strike) {
        pass(1_000);
        waited += 1_000;
        await syncAll(context);
      }
      waits.push(waited);
    }
    [1, 2, 4].forEach((minutes, i) => {
      expect(waits[i]).toBeGreaterThanOrEqual(minutes * 60_000 * 0.8);
      expect(waits[i]).toBeLessThanOrEqual(minutes * 60_000 * 1.2 + 1_000);
    });
  });

  test("only a sync that goes through clears the count: a timeout between two 503s does not", async () => {
    const { context, tries, answer, pass } = await turnedAway();
    const busy = async () => {
      throw new ServerBusyError("503", null);
    };
    const timeout = async () => {
      throw new OfflineError("no answer in time");
    };
    /** Syncs every second until the server is tried again; how long that took. */
    const waitOut = async () => {
      const before = tries();
      let waited = 0;
      while (tries() === before) {
        pass(1_000);
        waited += 1_000;
        await syncAll(context);
      }
      return waited;
    };
    answer(busy);
    await syncAll(context); // strike 1: about a minute
    answer(timeout);
    await waitOut(); // tried after the minute: it times out
    answer(busy);
    await syncAll(context); // strike 2, not 1 again: about two minutes
    answer(async () => {});
    expect(await waitOut()).toBeGreaterThanOrEqual(2 * 60_000 * 0.8);
    // Through: the count is cleared, and the next 503 waits a minute again.
    answer(busy);
    await syncAll(context);
    answer(async () => {});
    expect(await waitOut()).toBeLessThanOrEqual(60_000 * 1.2 + 1_000);
  });

  test("offline holds nothing: no request reached the server", async () => {
    const { context, tries, answer } = await turnedAway();
    answer(async () => {
      throw new OfflineError("offline");
    });
    await syncAll(context);
    await syncAll(context);
    expect(tries()).toBe(2);
  });
});
