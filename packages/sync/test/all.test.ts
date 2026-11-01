// `syncAll`, the one sync entry every shell calls (docs/plans/android.md#D60,
// docs/plans/foundation.md#D90), and the accounts it syncs.
import { AuthError, type Provider, type SecretStore } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { expect, test } from "vite-plus/test";

import { removeAccount, saveAccount, syncAll, type Connect } from "../src/index.ts";
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
        await waiting;
        return server.calendars();
      },
    } satisfies Provider;
  };
  return { connect, connections, holdAt: (at: Promise<void> | null) => (hold = at) };
}

async function setup() {
  const store = await Store.open(nodeDriver());
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
  return { store, secrets, a, b, net, context, add };
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
