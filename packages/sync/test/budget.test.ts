// What each action costs a CalDAV server, in requests (docs/plans/foundation.md#D126):
// Radicale on every run, Nextcloud in CI's nightly job, every request
// recorded and held to a budget, so a change that sends more fails here
// instead of on the user's server.
import { CalDavProvider, fetchClient } from "@astrotime/caldav";
import { CalendarObject, type SecretStore } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { connectCalDav, saveAccount, syncAll } from "../src/index.ts";
import { recording, type Recorded } from "./recorder.ts";
import { externalServer, startRadicale, type CalDavServer } from "./servers.ts";

const servers: { name: string; start: () => Promise<CalDavServer> }[] = [
  { name: "Radicale", start: startRadicale },
];
const nextcloud = externalServer("nextcloud");
if (nextcloud) servers.push({ name: "Nextcloud", start: async () => nextcloud });

const event = (uid: string, summary = uid) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nDTSTART:20261102T090000Z\r\nDTEND:20261102T100000Z\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

function memorySecrets(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
}

const week = { from: "2026-11-01", to: "2026-11-08", timeZone: "UTC" };
// Unique per run: a server outside the test keeps calendars between runs.
const run = Date.now().toString(36);

// A ceiling, not a wait: Nextcloud checks the password on every request.
describe.each(servers)("requests to $name", { timeout: 60_000 }, ({ start }) => {
  let server: CalDavServer;
  /** The test's calendars by their names here: `personal`, `work`, `tasks`. */
  const calendars = new Map<string, string>();
  beforeAll(async () => {
    server = await start();
    for (const name of ["personal", "work", "tasks"])
      calendars.set(name, await server.mkcalendar(`${name}-${run}`));
    await elsewhere(`${calendars.get("personal")}a.ics`, event("a"));
    await elsewhere(`${calendars.get("work")}b.ics`, event("b"));
  });
  afterAll(() => server.stop());

  /** Another client writes on the server, unrecorded. */
  async function elsewhere(url: string, ics: string) {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Basic ${btoa(`${server.username}:${server.password}`)}`,
        "Content-Type": "text/calendar",
      },
      body: ics,
    });
    expect(response.status).toBeLessThan(300);
  }

  let home = "";
  /** A request as the test reads it: `PROPFIND home`, `REPORT work`, `PUT work/b.ics`. */
  function named({ method, path, status }: Recorded): string {
    expect(status).not.toBe("offline");
    expect(status).toBeLessThan(400);
    for (const [name, url] of calendars) {
      const at = new URL(url).pathname;
      if (path.startsWith(at))
        return `${method} ${name}${path === at ? "" : `/${path.slice(at.length)}`}`;
    }
    return `${method} ${path === home ? "home" : path}`;
  }

  /**
   * Whether a request is about this file's calendars, the home or discovery.
   * Nextcloud is shared with the other test files, whose calendars come and
   * go meanwhile; on Radicale every calendar is this file's.
   */
  function ours(path: string): boolean {
    if (!path.startsWith(home) || path === home) return true;
    return [...calendars.values()].some((url) => path.startsWith(new URL(url).pathname));
  }

  /** A device signed in by password, every request it sends recorded. */
  async function signIn() {
    const recorder = recording(fetchClient());
    const { http } = recorder;
    const store = await Store.open(nodeDriver());
    const context = { store, secrets: memorySecrets(), connect: connectCalDav(http) };
    const credentials = { username: server.username, password: server.password };
    const { homeUrl } = await CalDavProvider.discover(http, server.url, credentials);
    home = new URL(homeUrl).pathname;
    await saveAccount(context, { name: "astro", serverUrl: server.url, homeUrl, credentials });
    await syncAll(context, { fresh: true });
    const calendar = async (name: string) =>
      (await store.calendars()).find((c) => c.url === calendars.get(name))!;
    return {
      store,
      calendar,
      sync: () => syncAll(context, { fresh: true }),
      take: () =>
        recorder
          .take()
          .filter(({ path }) => ours(path))
          .map(named),
    };
  }

  const titles = async (store: Store) =>
    (
      await store.objectsBetween(
        (await store.calendars()).map((c) => c.id),
        week,
      )
    ).map((o) => CalendarObject.parse(o.ics).master?.summary);

  test("signing in costs discovery, the calendar home and one report per calendar", async () => {
    const { store, take } = await signIn();
    const requests = take();
    // Discovery: the principal at /.well-known/caldav, then its calendar home.
    expect(requests.slice(0, 2).map((r) => r.split(" ")[0])).toEqual(["PROPFIND", "PROPFIND"]);
    // A first sync is one report per calendar, its objects' data in it: no multiget.
    const there = (await store.calendars()).map((c) => new URL(c.url).pathname).filter(ours);
    expect(there.length).toBeGreaterThanOrEqual(3);
    expect(requests.slice(2)).toEqual([
      "PROPFIND home",
      ...there.map((path) => named({ method: "REPORT", path, status: 207 })),
    ]);
    expect(await titles(store)).toEqual(expect.arrayContaining(["a", "b"]));
  });

  test("a sync that finds nothing new costs one request per account, however many calendars (D127)", async () => {
    const { take, sync } = await signIn();
    take();
    await sync();
    await sync();
    expect(take()).toEqual(["PROPFIND home", "PROPFIND home"]);
  });

  test("a change on another device costs the home and one report of its calendar, its data in it", async () => {
    const { store, take, sync } = await signIn();
    take();
    await elsewhere(`${calendars.get("work")}c.ics`, event("c"));
    await sync();
    expect(take()).toEqual(["PROPFIND home", "REPORT work"]);
    expect(await titles(store)).toContain("c");
  });

  test("an edit, a creation and a deletion here cost their write and one report of their calendar", async () => {
    const { store, calendar, take, sync } = await signIn();
    const work = await calendar("work");
    take();

    const b = (await store.hrefs(work.id)).find((o) => o.href.endsWith("b.ics"))!;
    const stored = (await store.object(b.id))!;
    await store.saveLocal(work.id, stored.ics.replace("SUMMARY:b", "SUMMARY:edited"));
    await sync();
    expect(take()).toEqual(["PROPFIND home", "PUT work/b.ics", "REPORT work"]);

    await store.saveLocal((await calendar("personal")).id, event("new"));
    await sync();
    expect(take()).toEqual(["PROPFIND home", "PUT personal/new.ics", "REPORT personal"]);

    await store.deleteLocal(stored.id);
    await sync();
    expect(take()).toEqual(["PROPFIND home", "DELETE work/b.ics", "REPORT work"]);
    // What went up is what another device reads.
    const other = await signIn();
    expect(await titles(other.store)).toEqual(expect.arrayContaining(["a", "c", "new"]));
    expect(await titles(other.store)).not.toContain("edited");
  });
});
