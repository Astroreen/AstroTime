// The sync engine and the CalDAV provider against real servers: Radicale on
// every run, Nextcloud in CI's nightly job (docs/plans/foundation.md#pr-4--caldav-provider).
import {
  CalDavProvider,
  fetchClient,
  proxyHandler,
  startLoginFlow,
  throughProxy,
  type HttpClient,
} from "@astrotime/caldav";
import {
  CalendarObject,
  createItem,
  editItem,
  occurrencesBetween,
  OfflineError,
  zonedTime,
  type Event,
} from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { syncAccount } from "../src/index.ts";
import { externalServer, startRadicale, type CalDavServer } from "./servers.ts";

const servers: { name: string; start: () => Promise<CalDavServer> }[] = [
  { name: "Radicale", start: startRadicale },
];
const nextcloud = externalServer("nextcloud");
if (nextcloud) servers.push({ name: "Nextcloud", start: async () => nextcloud });

const event = (uid: string, fields: Record<string, string> = {}) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nDTSTART:20261102T090000Z\r\nDTEND:20261102T100000Z\r\n${Object.entries(
    { SUMMARY: uid, ...fields },
  )
    .map(([k, v]) => `${k}:${v}\r\n`)
    .join("")}END:VEVENT\r\nEND:VCALENDAR\r\n`;
const task = (uid: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//EN\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nSUMMARY:${uid}\r\nX-APPLE-SORT-ORDER:5\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;

/** One device: its own store, and an HTTP client whose network can be cut. */
async function device(server: CalDavServer, calendarName: string) {
  let online = true;
  const http: HttpClient = async (request) => {
    if (!online) throw new OfflineError("offline");
    return fetchClient()(request);
  };
  const credentials = { username: server.username, password: server.password };
  const { homeUrl } = await CalDavProvider.discover(http, server.url, credentials);
  const provider = new CalDavProvider(http, credentials, homeUrl);
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: server.name,
    serverUrl: server.url,
    username: server.username,
  });
  const sync = () => syncAccount(store, provider, account.id);
  const calendar = async () => {
    const found = (await store.calendars(account.id)).find((c) => c.name === calendarName);
    if (!found) throw new Error(`No calendar ${calendarName}`);
    return found;
  };
  const summaries = async () => {
    const objects = await store.objectsBetween([(await calendar()).id], {
      from: "2026-11-01",
      to: "2026-11-08",
      timeZone: "UTC",
    });
    return objects.map((o) => CalendarObject.parse(o.ics).master?.summary).toSorted();
  };
  return {
    store,
    provider,
    sync,
    calendar,
    summaries,
    goOffline: () => (online = false),
    goOnline: () => (online = true),
  };
}

const week = { from: "2026-11-01", to: "2026-11-08", timeZone: "UTC" };

let n = 0;
// Unique per run: a server outside the test (a local Nextcloud) keeps calendars between runs.
const run = Date.now().toString(36);
const calendarName = () => `test-${run}-${n++}`;

// A ceiling, not a wait: Nextcloud checks the password on every request, about
// a second each, so a two-device test takes tens of seconds there.
describe.each(servers)(
  "CalDAV against $name",
  { timeout: 60_000 },
  ({ name: serverName, start }) => {
    let server: CalDavServer;
    beforeAll(async () => {
      server = await start();
    });
    afterAll(() => server.stop());

    test("discovery finds the calendar home, and the calendars with their names, colours and components", async () => {
      const name = calendarName();
      await server.mkcalendar(name, ["VTODO"]);
      const a = await device(server, name);
      await a.sync();
      expect(await a.calendar()).toMatchObject({
        name,
        color: "#0082c9",
        components: ["VTODO"],
        readOnly: false,
      });
    });

    test("changes travel both ways between two devices: create, update, delete", async () => {
      const name = calendarName();
      await server.mkcalendar(name);
      const [a, b] = [await device(server, name), await device(server, name)];
      await a.sync();
      await a.store.saveLocal((await a.calendar()).id, event("standup"));
      await a.store.saveLocal((await a.calendar()).id, task("buy-milk"));
      expect(await a.sync()).toMatchObject({ uploaded: 2 });

      // A fresh device downloads the whole account, other tests' calendars too.
      await b.sync();
      expect(await b.summaries()).toEqual(["standup"]);
      expect((await b.store.undated([(await b.calendar()).id])).map((o) => o.uid)).toEqual([
        "buy-milk",
      ]);

      await b.store.saveLocal(
        (await b.calendar()).id,
        event("standup", { SUMMARY: "Standup (moved)" }),
      );
      await b.sync();
      expect(await a.sync()).toMatchObject({ downloaded: 1 });
      expect(await a.summaries()).toEqual(["Standup (moved)"]);

      const [standup] = await b.store.objectsBetween([(await b.calendar()).id], {
        from: "2026-11-01",
        to: "2026-11-08",
        timeZone: "UTC",
      });
      await b.store.deleteLocal(standup!.id);
      await b.sync();
      expect(await a.sync()).toMatchObject({ removed: 1 });
      expect(await a.summaries()).toEqual([]);
    });

    test("a series made and split here reaches another device as two series with their own times (D11)", async () => {
      const name = calendarName();
      await server.mkcalendar(name);
      const [a, b] = [await device(server, name), await device(server, name)];
      await a.sync();
      const vilnius = (local: string) => zonedTime(local, "Europe/Vilnius");
      const now = Date.parse("2026-11-01T08:00:00Z");
      // Weekly on Mondays at 9:00 in Vilnius, with the VTIMEZONE core makes for it.
      const series = createItem(
        "event",
        {
          summary: "Swim",
          time: { start: vilnius("2026-10-19T09:00:00"), end: vilnius("2026-10-19T10:00:00") },
          repeat: {
            frequency: "WEEKLY",
            interval: 1,
            weekdays: [],
            monthlyWeekday: null,
            end: { type: "count", count: 4 },
          },
        },
        { now, uid: `swim-${run}` },
      );
      await a.store.saveLocal((await a.calendar()).id, series);
      expect(await a.sync()).toMatchObject({ uploaded: 1, errors: [] });
      // This and following, from November 2: an hour later, under a new UID.
      const [stored] = await a.store.objectsBetween([(await a.calendar()).id], week);
      const { ics, split } = editItem(
        CalendarObject.parse(stored!.ics),
        { time: { start: vilnius("2026-11-02T10:00:00"), end: vilnius("2026-11-02T11:00:00") } },
        {
          now,
          scope: "following",
          recurrenceId: vilnius("2026-11-02T09:00:00"),
          newUid: `swim2-${run}`,
        },
      );
      await a.store.saveLocal(stored!.calendarId, ics, stored!.href);
      await a.store.saveLocal(stored!.calendarId, split!);
      expect(await a.sync()).toMatchObject({ uploaded: 2, errors: [] });

      await b.sync();
      const starts = (
        await b.store.objectsBetween([(await b.calendar()).id], {
          from: "2026-10-01",
          to: "2026-12-01",
          timeZone: "UTC",
        })
      )
        .flatMap((o) =>
          occurrencesBetween(CalendarObject.parse(o.ics), {
            from: "2026-10-01",
            to: "2026-12-01",
            timeZone: "Europe/Vilnius",
          }),
        )
        .map((o) => (o.start.type === "zoned" ? o.start.local : ""))
        .toSorted();
      // Summer time ended on October 25: the wall clock stays.
      expect(starts).toEqual([
        "2026-10-19T09:00:00",
        "2026-10-26T09:00:00",
        "2026-11-02T10:00:00",
        "2026-11-09T10:00:00",
      ]);
    });

    test("a calendar deleted on the server goes with its objects (D38), though Nextcloud keeps it in its trash bin", async () => {
      const name = calendarName();
      const url = await server.mkcalendar(name);
      const a = await device(server, name);
      await a.sync();
      await a.store.saveLocal((await a.calendar()).id, event("doomed"));
      await a.sync();
      await server.deleteCalendar(url);
      await a.sync();
      expect((await a.store.calendars()).map((c) => c.name)).not.toContain(name);
    });

    test("a second sync with nothing new downloads nothing (sync-collection)", async () => {
      const name = calendarName();
      await server.mkcalendar(name);
      const a = await device(server, name);
      await a.sync();
      await a.store.saveLocal((await a.calendar()).id, event("once"));
      await a.sync();
      expect((await a.calendar()).syncToken).toMatch(/\S/);
      expect(await a.sync()).toEqual({
        uploaded: 0,
        downloaded: 0,
        removed: 0,
        conflicts: 0,
        skipped: [],
        errors: [],
        dropped: [],
      });
    });

    test("an edit made offline reaches the server when it comes back", async () => {
      const name = calendarName();
      await server.mkcalendar(name);
      const [a, b] = [await device(server, name), await device(server, name)];
      await a.sync();
      a.goOffline();
      await a.store.saveLocal((await a.calendar()).id, event("offline-edit"));
      await expect(a.sync()).rejects.toThrow(OfflineError);
      expect((await a.store.pending((await a.calendar()).id)).map((o) => o.uid)).toEqual([
        "offline-edit",
      ]);

      a.goOnline();
      expect(await a.sync()).toMatchObject({ uploaded: 1 });
      await b.sync();
      expect(await b.summaries()).toEqual(["offline-edit"]);
    });

    test("edits to different fields on two devices merge; the same field is a conflict, the server's value kept", async () => {
      const name = calendarName();
      await server.mkcalendar(name);
      const [a, b] = [await device(server, name), await device(server, name)];
      await a.sync();
      await a.store.saveLocal((await a.calendar()).id, event("planning", { LOCATION: "Room 1" }));
      await a.sync();
      await b.sync();

      // Different fields: A moves the room, B renames it.
      await a.store.saveLocal((await a.calendar()).id, event("planning", { LOCATION: "Room 7" }));
      await a.sync();
      await b.store.saveLocal(
        (await b.calendar()).id,
        event("planning", { SUMMARY: "Planning Q1", LOCATION: "Room 1" }),
      );
      expect(await b.sync()).toMatchObject({ uploaded: 1, conflicts: 0 });
      await a.sync();
      const merged = await a.store.objectsBetween([(await a.calendar()).id], {
        from: "2026-11-01",
        to: "2026-11-08",
        timeZone: "UTC",
      });
      expect(CalendarObject.parse(merged[0]!.ics).master).toMatchObject({
        summary: "Planning Q1",
        location: "Room 7",
      });

      // The same field: both rename it.
      await a.store.saveLocal(
        (await a.calendar()).id,
        event("planning", { SUMMARY: "From A", LOCATION: "Room 7" }),
      );
      await a.sync();
      await b.store.saveLocal(
        (await b.calendar()).id,
        event("planning", { SUMMARY: "From B", LOCATION: "Room 7" }),
      );
      expect(await b.sync()).toMatchObject({ conflicts: 1 });
      expect(await b.summaries()).toEqual(["From A"]);
      const [conflict] = await b.store.conflicts();
      expect((CalendarObject.parse(conflict!.localIcs).master as Event).summary).toBe("From B");
    });

    test("a deletion refused because the item changed on the server is dropped; the item comes back (D38)", async () => {
      const name = calendarName();
      await server.mkcalendar(name);
      const [a, b] = [await device(server, name), await device(server, name)];
      await a.sync();
      await a.store.saveLocal((await a.calendar()).id, event("keep"));
      await a.sync();
      await b.sync();
      const [mine] = await a.store.objectsBetween([(await a.calendar()).id], week);
      await a.store.deleteLocal(mine!.id);
      await b.store.saveLocal((await b.calendar()).id, event("keep", { SUMMARY: "Kept by B" }));
      await b.sync();
      await a.sync();
      expect(await a.summaries()).toEqual(["Kept by B"]);
      expect(await a.store.pending((await a.calendar()).id)).toEqual([]);
    });

    test("an edit of an item deleted on the server is dropped with it (D38)", async () => {
      const name = calendarName();
      await server.mkcalendar(name);
      const [a, b] = [await device(server, name), await device(server, name)];
      await a.sync();
      await a.store.saveLocal((await a.calendar()).id, event("gone"));
      await a.sync();
      await b.sync();
      const [theirs] = await b.store.objectsBetween([(await b.calendar()).id], week);
      await b.store.deleteLocal(theirs!.id);
      await b.sync();
      await a.store.saveLocal(
        (await a.calendar()).id,
        event("gone", { SUMMARY: "Edited meanwhile" }),
      );
      await a.sync();
      expect(await a.summaries()).toEqual([]);
      await b.sync();
      expect(await b.summaries()).toEqual([]);
    });

    test.runIf(serverName === "Nextcloud")(
      "Login Flow v2 end to end: the user approves in a browser and the app password reaches CalDAV (D19)",
      async () => {
        const name = calendarName();
        await server.mkcalendar(name);
        const flow = await startLoginFlow(fetchClient(), server.url);
        expect(new URL(flow.loginUrl).origin).toBe(new URL(server.url).origin);
        expect(await flow.poll()).toBeNull();

        // The user's side, on Nextcloud's own pages: sign in, then grant access.
        const browser = await chromium.launch();
        try {
          const page = await browser.newPage();
          await page.goto(flow.loginUrl);
          await page.getByRole("heading", { name: "Connect to your account" }).waitFor();
          await page.getByRole("button", { name: "Log in", exact: true }).click();
          await page.getByRole("textbox", { name: /^Account name/ }).fill(server.username);
          await page.getByRole("textbox", { name: "Password" }).fill(server.password);
          await page.getByRole("button", { name: "Log in", exact: true }).click();
          await page.getByRole("button", { name: "Grant access" }).click();
          // Shown once Nextcloud has stored the app password for the poll.
          await page.getByRole("heading", { name: "Account connected" }).waitFor();
        } finally {
          await browser.close();
        }

        const credentials = await flow.poll();
        if (!credentials) throw new Error("The flow gave no app password once approved.");
        try {
          expect(credentials).toMatchObject({
            server: server.url.replace(/\/$/, ""),
            username: server.username,
          });
          expect(credentials.password).not.toBe(server.password);
          // The app password is what AstroTime signs in with from now on.
          const { homeUrl } = await CalDavProvider.discover(fetchClient(), server.url, credentials);
          const provider = new CalDavProvider(fetchClient(), credentials, homeUrl);
          expect((await provider.calendars()).map((c) => c.name)).toContain(name);
        } finally {
          // The app password goes, as a user would revoke it: a long-lived
          // server (not the nightly's) keeps no device per run.
          const revoked = await fetch(new URL("ocs/v2.php/core/apppassword", server.url), {
            method: "DELETE",
            headers: {
              "OCS-APIRequest": "true",
              Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64")}`,
            },
          });
          expect(revoked.status).toBe(200);
        }
      },
    );

    test("the web app's proxy carries discovery and sync to the server (D20)", async () => {
      const name = calendarName();
      await server.mkcalendar(name);
      // The browser's side: every request goes to the app's own origin under /dav-proxy/.
      const app = "http://app.localhost";
      const handler = proxyHandler({ prefix: "/dav-proxy/", allow: [new URL(server.url).origin] });
      // As a browser's fetch: redirects are followed with their method (Fetch §4.4), and the
      // response knows the URL that answered.
      const browserFetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        let url = new URL(String(input), app);
        for (let hop = 0; hop < 5; hop++) {
          const response = await handler(new Request(url, init));
          const location = response.headers.get("location");
          if (response.status < 300 || response.status >= 400 || !location) {
            Object.defineProperty(response, "url", { value: url.href });
            return response;
          }
          url = new URL(location, url);
        }
        throw new Error("Too many redirects.");
      };
      const http = fetchClient({
        fetch: browserFetch as typeof fetch,
        via: throughProxy("/dav-proxy/"),
      });
      const credentials = { username: server.username, password: server.password };
      const { homeUrl } = await CalDavProvider.discover(http, server.url, credentials);
      expect(homeUrl.startsWith(server.url)).toBe(true);
      const provider = new CalDavProvider(http, credentials, homeUrl);
      const store = await Store.open(nodeDriver());
      const account = await store.addAccount({
        provider: "caldav",
        name: server.name,
        serverUrl: server.url,
        username: server.username,
      });
      await syncAccount(store, provider, account.id);
      const calendar = (await store.calendars(account.id)).find((c) => c.name === name)!;
      await store.saveLocal(calendar.id, event("proxied"));
      expect(await syncAccount(store, provider, account.id)).toMatchObject({ uploaded: 1 });
      expect((await store.hrefs(calendar.id))[0]?.href.startsWith(server.url)).toBe(true);

      // Not on the allowlist: refused before anything leaves.
      const closed = proxyHandler({ prefix: "/dav-proxy/", allow: ["https://elsewhere.example"] });
      const refused = await closed(
        new Request(`${app}${throughProxy("/dav-proxy/").to(server.url)}`, { method: "PROPFIND" }),
      );
      expect(refused.status).toBe(403);
    });

    test("what the server serves back keeps every property through a round trip (D7)", async () => {
      const name = calendarName();
      await server.mkcalendar(name);
      const [a, b] = [await device(server, name), await device(server, name)];
      await a.sync();
      await a.store.saveLocal((await a.calendar()).id, task("sorted"));
      await a.sync();
      await b.sync();
      const [served] = await b.store.undated([(await b.calendar()).id]);
      const object = CalendarObject.parse(served!.ics);
      expect(object.serialize().replaceAll("\r\n ", "")).toContain("X-APPLE-SORT-ORDER:5");
      expect(object.master).toMatchObject({ kind: "task", sortOrder: 5 });
    });
  },
);
