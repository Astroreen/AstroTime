// The store's behaviour, run against every driver: `store.test.ts` (Node) and
// `store.browser.test.ts` (sqlite-wasm on OPFS in Chromium).
import { describe, expect, test, vi } from "vite-plus/test";
import { ALL_RIGHTS, NO_RIGHTS } from "@astrotime/core";

import { SCHEMA_VERSION, Store, type SqlDriver } from "../src/index.ts";

const vcal = (body: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n${body}END:VCALENDAR\r\n`;
const event = (uid: string, start: string, end: string, extra = "") =>
  vcal(
    `BEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261001T000000Z\r\nDTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:${uid}\r\n${extra}END:VEVENT\r\n`,
  );
const task = (uid: string, extra = "") =>
  vcal(
    `BEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261001T000000Z\r\nSUMMARY:${uid}\r\n${extra}END:VTODO\r\n`,
  );

export function storeContract(name: string, driver: () => Promise<SqlDriver> | SqlDriver) {
  async function setup() {
    const store = await Store.open(await driver());
    const account = await store.addAccount({
      provider: "caldav",
      name: "Nextcloud",
      serverUrl: "https://cloud.example.com/remote.php/dav/",
      username: "astro",
    });
    const calendar = await store.saveCalendar({
      accountId: account.id,
      url: "https://cloud.example.com/remote.php/dav/calendars/astro/personal/",
      name: "Personal",
      color: "#0082c9",
      components: ["VEVENT", "VTODO"],
      rights: ALL_RIGHTS,
    });
    return { store, account, calendar };
  }

  describe(`store on ${name}`, () => {
    test("migrates an empty database to this build's schema", async () => {
      const raw = await driver();
      await (await Store.open(raw)).accounts();
      expect(await raw.query("PRAGMA user_version", [])).toEqual([[SCHEMA_VERSION]]);
    });

    test("accounts and calendars persist; saving a calendar again updates it and keeps its sync state", async () => {
      const { store, account, calendar } = await setup();
      await store.setSyncState(calendar.id, { syncToken: "http://sabre.io/ns/sync/7", ctag: "7" });
      const again = await store.saveCalendar({
        ...calendar,
        name: "Personal (renamed)",
        components: ["VEVENT"],
      });
      expect(again.id).toBe(calendar.id);
      expect(await store.calendars(account.id)).toEqual([
        {
          ...calendar,
          name: "Personal (renamed)",
          components: ["VEVENT"],
          syncToken: "http://sabre.io/ns/sync/7",
          ctag: "7",
        },
      ]);
      expect((await store.accounts()).map((a) => a.name)).toEqual(["Nextcloud"]);
    });

    test("a calendar keeps what the user may do in it, and saving it again replaces that (D37)", async () => {
      const { store, account, calendar } = await setup();
      expect(calendar.rights).toEqual(ALL_RIGHTS);
      const shared = { create: false, edit: true, delete: false };
      await store.saveCalendar({ ...calendar, rights: shared });
      expect((await store.calendars(account.id)).map((c) => c.rights)).toEqual([shared]);
      await store.saveCalendar({ ...calendar, rights: NO_RIGHTS });
      expect((await store.calendars(account.id)).map((c) => c.rights)).toEqual([NO_RIGHTS]);
    });

    test("an account keeps the calendar home discovery found, and signing in again replaces it", async () => {
      const { store, account } = await setup();
      expect(account.homeUrl).toBeNull();
      const home = "https://cloud.example.com/remote.php/dav/calendars/astro/";
      await store.updateAccount(account.id, { homeUrl: home, username: "astro2" });
      expect(await store.accounts()).toEqual([{ ...account, homeUrl: home, username: "astro2" }]);
    });

    test("an account is found by its calendar home and user, else added, in one transaction (D90)", async () => {
      const { store, account } = await setup();
      const home = "https://cloud.example.com/remote.php/dav/calendars/astro/";
      const input = { name: "astro@cloud", serverUrl: account.serverUrl, homeUrl: home };
      // setup()'s account has the same user and no home (as before migration 5):
      // it is not matched, since discovery found no home for it.
      const added = await store.findOrAddAccount({ ...input, username: "astro" });
      expect(added.added).toBe(true);
      expect(added.account.id).not.toBe(account.id);
      expect(added.account).toMatchObject({ provider: "caldav", homeUrl: home, username: "astro" });
      const twice = await Promise.all([
        store.findOrAddAccount({ ...input, username: "astro" }),
        store.findOrAddAccount({ ...input, username: "astro" }),
      ]);
      expect(twice.map((found) => [found.added, found.account.id])).toEqual([
        [false, added.account.id],
        [false, added.account.id],
      ]);
      // Another user of the same home is another account.
      expect((await store.findOrAddAccount({ ...input, username: "anna" })).added).toBe(true);
      expect(await store.accounts()).toHaveLength(3);
    });

    test("objects are found by date range, widened only as far as zones reach", async () => {
      const { store, calendar } = await setup();
      await store.saveFromServer(calendar.id, {
        href: "a.ics",
        etag: '"1"',
        ics: event("a", "20261102T090000Z", "20261102T100000Z"),
      });
      await store.saveFromServer(calendar.id, {
        href: "b.ics",
        etag: '"1"',
        ics: event("b", "20261110T090000Z", "20261110T100000Z"),
      });
      await store.saveFromServer(calendar.id, {
        href: "c.ics",
        etag: '"1"',
        ics: event("c", "20260101T090000Z", "20260101T100000Z", "RRULE:FREQ=WEEKLY\r\n"),
      });
      await store.saveFromServer(calendar.id, { href: "t.ics", etag: '"1"', ics: task("t") });
      const week = { from: "2026-11-01", to: "2026-11-08", timeZone: "Europe/Vilnius" };
      expect(
        (await store.objectsBetween([calendar.id], week)).map((o) => o.uid).toSorted(),
      ).toEqual(["a", "c"]);
      expect((await store.undated([calendar.id])).map((o) => o.uid)).toEqual(["t"]);
    });

    test("the server's version replaces what was stored under its href", async () => {
      const { store, calendar } = await setup();
      const first = await store.saveFromServer(calendar.id, {
        href: "a.ics",
        etag: '"1"',
        ics: event("a", "20261102T090000Z", "20261102T100000Z"),
      });
      const second = await store.saveFromServer(calendar.id, {
        href: "a.ics",
        etag: '"2"',
        ics: event("a", "20261103T090000Z", "20261103T100000Z"),
      });
      expect(second.id).toBe(first.id);
      expect(second).toMatchObject({
        etag: '"2"',
        startMs: Date.parse("2026-11-03T09:00:00Z"),
        pending: "none",
      });
    });

    test("local changes wait for upload: create, update, delete", async () => {
      const { store, calendar } = await setup();
      const created = await store.saveLocal(
        calendar.id,
        event("new", "20261102T090000Z", "20261102T100000Z"),
      );
      expect(created).toMatchObject({ href: "new.ics", pending: "create", etag: null });
      // Editing it again before the upload keeps it a creation.
      expect(
        await store.saveLocal(calendar.id, event("new", "20261102T100000Z", "20261102T110000Z")),
      ).toMatchObject({ id: created.id, pending: "create" });

      await store.saveFromServer(calendar.id, {
        href: "old.ics",
        etag: '"5"',
        ics: event("old", "20261102T090000Z", "20261102T100000Z"),
      });
      const updated = await store.saveLocal(
        calendar.id,
        event("old", "20261102T120000Z", "20261102T130000Z"),
      );
      expect(updated).toMatchObject({ href: "old.ics", pending: "update", etag: '"5"' });
      expect((await store.pending(calendar.id)).map((o) => o.uid)).toEqual(["new", "old"]);

      await store.markSynced(created.id, {
        href: "new.ics",
        etag: '"1"',
        ics: (await store.object(created.id))!.ics,
      });
      await store.deleteLocal(updated.id);
      expect((await store.pending(calendar.id)).map((o) => [o.uid, o.pending])).toEqual([
        ["old", "delete"],
      ]);
      const week = { from: "2026-11-01", to: "2026-11-08", timeZone: "UTC" };
      expect((await store.objectsBetween([calendar.id], week)).map((o) => o.uid)).toEqual(["new"]);
    });

    test("the server's version never overwrites a pending local change, unless the sync engine says so", async () => {
      const { store, calendar } = await setup();
      await store.saveFromServer(calendar.id, {
        href: "p.ics",
        etag: '"1"',
        ics: event("p", "20261102T090000Z", "20261102T100000Z"),
      });
      const local = await store.saveLocal(
        calendar.id,
        event("p", "20261102T120000Z", "20261102T130000Z"),
      );
      const server = event("p", "20261102T150000Z", "20261102T160000Z");
      expect(
        await store.saveFromServer(calendar.id, { href: "p.ics", etag: '"2"', ics: server }),
      ).toEqual(local);
      expect(
        await store.saveFromServer(
          calendar.id,
          { href: "p.ics", etag: '"2"', ics: server },
          { replacePending: local },
        ),
      ).toMatchObject({
        pending: "none",
        etag: '"2"',
        ics: server,
      });
    });

    test("the sync engine replaces a pending change only as it saw it", async () => {
      const { store, calendar } = await setup();
      await store.saveFromServer(calendar.id, {
        href: "s.ics",
        etag: '"1"',
        ics: event("s", "20261102T090000Z", "20261102T100000Z"),
      });
      const seen = await store.saveLocal(
        calendar.id,
        event("s", "20261102T110000Z", "20261102T120000Z"),
      );
      // Edited again after the engine looked.
      const newer = await store.saveLocal(
        calendar.id,
        event("s", "20261102T130000Z", "20261102T140000Z"),
      );
      const server = event("s", "20261102T150000Z", "20261102T160000Z");
      expect(
        await store.saveFromServer(
          calendar.id,
          { href: "s.ics", etag: '"2"', ics: server },
          { replacePending: seen },
        ),
      ).toEqual(newer);
    });

    test("operations run one at a time: a local edit started during a download sees the download", async () => {
      const { store, calendar } = await setup();
      const [, local] = await Promise.all([
        store.saveFromServer(calendar.id, {
          href: "r.ics",
          etag: '"1"',
          ics: event("r", "20261102T090000Z", "20261102T100000Z"),
        }),
        store.saveLocal(calendar.id, event("r", "20261102T100000Z", "20261102T110000Z"), "r.ics"),
      ]);
      expect(local).toMatchObject({ pending: "update", etag: '"1"' });
    });

    test("the base of a local change is the server's version it started from", async () => {
      const { store, calendar } = await setup();
      const server = event("b", "20261102T090000Z", "20261102T100000Z");
      await store.saveFromServer(calendar.id, { href: "b.ics", etag: '"1"', ics: server });
      const local = await store.saveLocal(
        calendar.id,
        event("b", "20261102T110000Z", "20261102T120000Z"),
      );
      expect(local.baseIcs).toBe(server);
      await store.markSynced(local.id, { href: "b.ics", etag: '"2"', ics: local.ics });
      expect((await store.object(local.id))?.baseIcs).toBe(local.ics);

      const newer = event("b", "20261102T130000Z", "20261102T140000Z");
      const current = (await store.object(local.id))!;
      const rebased = await store.rebase(local.id, current.ics, {
        ics: newer,
        etag: '"3"',
        baseIcs: newer,
      });
      expect(rebased).toMatchObject({ etag: '"3"', startMs: Date.parse("2026-11-02T13:00:00Z") });
      // Edited meanwhile: the rebase does not overwrite it.
      await store.saveLocal(calendar.id, event("b", "20261102T150000Z", "20261102T160000Z"));
      expect(
        await store.rebase(local.id, newer, { ics: newer, etag: '"4"', baseIcs: newer }),
      ).toBeNull();
      expect((await store.object(local.id))?.startMs).toBe(Date.parse("2026-11-02T15:00:00Z"));
    });

    test("a change made while its upload was on the way stays pending", async () => {
      const { store, calendar } = await setup();
      const uploading = await store.saveLocal(
        calendar.id,
        event("u", "20261102T090000Z", "20261102T100000Z"),
      );
      // The user edits again before the server's answer arrives.
      await store.saveLocal(calendar.id, event("u", "20261102T110000Z", "20261102T120000Z"));
      await store.markSynced(uploading.id, {
        href: "https://dav.example/u.ics",
        etag: '"1"',
        ics: uploading.ics,
      });
      expect(await store.object(uploading.id)).toMatchObject({
        pending: "update",
        etag: '"1"',
        href: "https://dav.example/u.ics",
      });

      // And a deletion made meanwhile stays a deletion, now against the server's ETag.
      const second = await store.saveLocal(
        calendar.id,
        event("v", "20261102T090000Z", "20261102T100000Z"),
      );
      await store.markSynced(second.id, { href: "v.ics", etag: '"1"', ics: second.ics });
      await store.saveLocal(calendar.id, event("v", "20261102T130000Z", "20261102T140000Z"));
      const editing = (await store.object(second.id))!;
      await store.deleteLocal(second.id);
      await store.markSynced(second.id, { href: "v.ics", etag: '"2"', ics: editing.ics });
      expect(await store.object(second.id)).toMatchObject({ pending: "delete", etag: '"2"' });
    });

    test("a local change cannot replace another object at the same href", async () => {
      const { store, calendar } = await setup();
      await store.saveFromServer(calendar.id, {
        href: "x.ics",
        etag: '"1"',
        ics: event("x", "20261102T090000Z", "20261102T100000Z"),
      });
      await expect(
        store.saveLocal(calendar.id, event("y", "20261102T090000Z", "20261102T100000Z"), "x.ics"),
      ).rejects.toThrow(/holds x/);
      expect((await store.objectAt(calendar.id, "x.ics"))?.uid).toBe("x");
    });

    test("editing an object deleted here before the deletion is uploaded revives it (D38)", async () => {
      const { store, calendar } = await setup();
      const object = await store.saveFromServer(calendar.id, {
        href: "z.ics",
        etag: '"1"',
        ics: event("z", "20261102T090000Z", "20261102T100000Z"),
      });
      await store.deleteLocal(object.id);
      expect(
        await store.saveLocal(calendar.id, event("z", "20261102T110000Z", "20261102T120000Z")),
      ).toMatchObject({ id: object.id, pending: "update" });
    });

    test("a local change reads and writes in one transaction: all of its writes, or none", async () => {
      const { store, calendar } = await setup();
      const server = await store.saveFromServer(calendar.id, {
        href: "s.ics",
        etag: '"1"',
        ics: event("s", "20261102T090000Z", "20261102T100000Z"),
      });
      const split = await store.changeLocal(async (local) => {
        const current = (await local.object(server.id))!;
        await local.save(calendar.id, current.ics.replace("SUMMARY:s", "SUMMARY:s1"), current.href);
        return local.save(calendar.id, event("s2", "20261103T090000Z", "20261103T100000Z"));
      });
      expect(split).toMatchObject({ pending: "create", href: "s2.ics" });
      expect(await store.object(server.id)).toMatchObject({ pending: "update" });
      expect((await store.object(server.id))!.ics).toContain("SUMMARY:s1");

      await expect(
        store.changeLocal(async (local) => {
          await local.delete(server.id);
          await local.save(calendar.id, event("s3", "20261104T090000Z", "20261104T100000Z"));
          throw new Error("The change failed half way.");
        }),
      ).rejects.toThrow("half way");
      expect(await store.object(server.id)).toMatchObject({ pending: "update" });
      expect(await store.objectAt(calendar.id, "s3.ics")).toBeUndefined();
    });

    test("an empty store gets the calendar on this device, once; its changes are final, and it steps aside unused (D122)", async () => {
      const store = await Store.open(await driver());
      const names = { account: "On this device", calendar: "Personal", color: "#7c8db5" };
      const [local, again] = await Promise.all([
        store.addLocalCalendarIfEmpty(names),
        store.addLocalCalendarIfEmpty(names),
      ]);
      expect([local === null, again === null].toSorted()).toEqual([false, true]);
      const account = (local ?? again)!;
      expect(await store.accounts()).toEqual([account]);
      expect(account).toMatchObject({ provider: "local", name: "On this device" });
      const [calendar] = await store.calendars(account.id);
      expect(calendar).toMatchObject({
        name: "Personal",
        components: ["VEVENT", "VTODO"],
        rights: ALL_RIGHTS,
      });
      // Nothing uploads it, so nothing waits: a change is final, a deletion at once.
      const saved = await store.saveLocal(calendar!.id, task("milk"));
      expect(saved.pending).toBe("none");
      expect(
        (await store.saveLocal(calendar!.id, task("milk", "STATUS:COMPLETED\r\n"))).pending,
      ).toBe("none");
      expect(await store.pending(calendar!.id)).toEqual([]);
      await store.deleteLocal(saved.id);
      expect(await store.object(saved.id)).toBeUndefined();

      // A store with accounts gets none.
      expect(await store.addLocalCalendarIfEmpty(names)).toBeNull();
      // Alone, it stays; with a server's account beside it, unused, it goes.
      expect(await store.removeLocalCalendarIfUnused()).toBe(false);
      const server = await store.addAccount({
        provider: "caldav",
        name: "astro@cloud.example.com",
        serverUrl: "https://cloud.example.com/",
        username: "astro",
      });
      expect(await store.removeLocalCalendarIfUnused()).toBe(true);
      expect(await store.accounts()).toEqual([server]);
    });

    test("the calendar on this device stays beside a server's account while it holds items (D122)", async () => {
      const store = await Store.open(await driver());
      const local = await store.addLocalCalendarIfEmpty({
        account: "On this device",
        calendar: "Personal",
        color: "#7c8db5",
      });
      const [calendar] = await store.calendars(local!.id);
      await store.saveLocal(calendar!.id, task("milk"));
      await store.addAccount({
        provider: "caldav",
        name: "astro@cloud.example.com",
        serverUrl: "https://cloud.example.com/",
        username: "astro",
      });
      expect(await store.removeLocalCalendarIfUnused()).toBe(false);
      expect((await store.accounts()).map((a) => a.provider)).toEqual(["local", "caldav"]);
    });

    test("deleting an object that never reached the server removes it at once", async () => {
      const { store, calendar } = await setup();
      const created = await store.saveLocal(calendar.id, task("draft"));
      await store.deleteLocal(created.id);
      expect(await store.object(created.id)).toBeUndefined();
      expect(await store.pending(calendar.id)).toEqual([]);
    });

    test("invalid iCalendar never reaches the store", async () => {
      const { store, calendar } = await setup();
      await expect(
        store.saveFromServer(calendar.id, { href: "x.ics", etag: null, ics: "garbage" }),
      ).rejects.toThrow();
      expect(await store.hrefs(calendar.id)).toEqual([]);
    });

    test("undone tasks due before today are found once each, with the occurrence they count by (D51)", async () => {
      const { store, calendar } = await setup();
      const save = (uid: string, fields: string) =>
        store.saveFromServer(calendar.id, {
          href: `${uid}.ics`,
          etag: '"1"',
          ics: task(uid, fields),
        });
      await save("yesterday", "DUE;VALUE=DATE:20261103\r\n");
      await save("last-week", "DUE:20261028T090000Z\r\n");
      await save("done", "DUE;VALUE=DATE:20261102\r\nSTATUS:COMPLETED\r\n");
      await save("today", "DUE;VALUE=DATE:20261104\r\n");
      await save("undated", "");
      await save("daily", "DUE;VALUE=DATE:20261101\r\nRRULE:FREQ=DAILY\r\n");
      await store.saveFromServer(calendar.id, {
        href: "event.ics",
        etag: '"1"',
        ics: event("event", "20261102T090000Z", "20261102T100000Z"),
      });
      const deleted = await save("deleted", "DUE;VALUE=DATE:20261102\r\n");
      await store.deleteLocal(deleted.id);

      const undone = await store.undoneTasksBefore([calendar.id], "2026-11-04", "Europe/Vilnius");
      expect(undone.map((u) => [u.object.uid, u.occurrence.end])).toEqual([
        [
          "last-week",
          {
            type: "zoned",
            local: "2026-10-28T09:00:00",
            timeZone: "UTC",
            epochMs: Date.parse("2026-10-28T09:00:00Z"),
          },
        ],
        ["daily", { type: "date", date: "2026-11-04" }],
        ["yesterday", { type: "date", date: "2026-11-04" }],
      ]);
      expect(await store.undoneTasksBefore([], "2026-11-04", "Europe/Vilnius")).toEqual([]);
    });

    test("the undone tasks follow a task that changes, however often they are asked", async () => {
      const { store, calendar } = await setup();
      const save = (fields: string, etag: string) =>
        store.saveFromServer(calendar.id, { href: "t.ics", etag, ics: task("t", fields) });
      const ask = async (day = "2026-11-04") =>
        (await store.undoneTasksBefore([calendar.id], day, "UTC")).map((u) => u.occurrence.end);
      await save("DUE;VALUE=DATE:20261102\r\n", '"1"');
      expect(await ask()).toEqual([{ type: "date", date: "2026-11-03" }]);
      expect(await ask()).toEqual([{ type: "date", date: "2026-11-03" }]);
      await save("DUE;VALUE=DATE:20261101\r\n", '"2"');
      expect(await ask()).toEqual([{ type: "date", date: "2026-11-02" }]);
      expect(await ask("2026-11-01")).toEqual([]);
      await save("DUE;VALUE=DATE:20261101\r\nSTATUS:COMPLETED\r\n", '"3"');
      expect(await ask()).toEqual([]);
      await save("DUE;VALUE=DATE:20261101\r\n", '"4"');
      expect(await ask()).toEqual([{ type: "date", date: "2026-11-02" }]);
    });

    test("the tasks of the calendars, dated or not; events and deleted tasks left out (D52)", async () => {
      const { store, account, calendar } = await setup();
      const other = await store.saveCalendar({
        accountId: account.id,
        url: "https://cloud.example.com/remote.php/dav/calendars/astro/other/",
        name: "Other",
        color: null,
        components: ["VTODO"],
        rights: ALL_RIGHTS,
      });
      const save = (calendarId: string, uid: string, ics: string) =>
        store.saveFromServer(calendarId, { href: `${uid}.ics`, etag: '"1"', ics });
      await save(calendar.id, "dated", task("dated", "DUE;VALUE=DATE:20261104\r\n"));
      await save(calendar.id, "undated", task("undated"));
      await save(calendar.id, "event", event("event", "20261102T090000Z", "20261102T100000Z"));
      await save(other.id, "elsewhere", task("elsewhere"));
      const gone = await save(calendar.id, "gone", task("gone"));
      await store.deleteLocal(gone.id);
      const uids = async (ids: string[]) => (await store.tasks(ids)).map((o) => o.uid).toSorted();
      expect(await uids([calendar.id])).toEqual(["dated", "undated"]);
      expect(await uids([calendar.id, other.id])).toEqual(["dated", "elsewhere", "undated"]);
    });

    test("search finds titles, ignoring case and diacritics, in Russian too (D53)", async () => {
      const { store, calendar } = await setup();
      const titled = (uid: string, summary: string, fields = "") =>
        store.saveFromServer(calendar.id, {
          href: `${uid}.ics`,
          etag: '"1"',
          ics: vcal(
            `BEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261001T000000Z\r\nSUMMARY:${summary}\r\n${fields}END:VTODO\r\n`,
          ),
        });
      await titled("report", "Отправить ОТЧЁТ", "DUE;VALUE=DATE:20261104\r\n");
      await titled("cafe", "Café with Zoë", "DUE;VALUE=DATE:20261101\r\n");
      await titled("percent", "100% done_now");
      await titled("plain", "Water the plants", "DUE;VALUE=DATE:20261110\r\n");
      const gone = await titled("gone", "отчёт, удалённый здесь");
      await store.deleteLocal(gone.id);
      await store.saveFromServer(calendar.id, {
        href: "series.ics",
        etag: '"1"',
        ics: vcal(
          "BEGIN:VEVENT\r\nUID:series\r\nDTSTAMP:20261001T000000Z\r\nDTSTART:20261102T090000Z\r\nRRULE:FREQ=DAILY\r\nSUMMARY:Stand-up\r\nEND:VEVENT\r\n" +
            "BEGIN:VEVENT\r\nUID:series\r\nDTSTAMP:20261001T000000Z\r\nRECURRENCE-ID:20261103T090000Z\r\nDTSTART:20261103T100000Z\r\nSUMMARY:Retro\r\nEND:VEVENT\r\n",
        ),
      });
      const find = async (text: string, limit?: number) =>
        (await store.search([calendar.id], text, limit)).map((o) => o.uid);
      expect(await find("отчет")).toEqual(["report"]);
      expect(await find("  ОТЧЁТ ")).toEqual(["report"]);
      expect(await find("CAFE")).toEqual(["cafe"]);
      expect(await find("zoe")).toEqual(["cafe"]);
      // `%` and `_` are only themselves.
      expect(await find("0%")).toEqual(["percent"]);
      expect(await find("e_n")).toEqual(["percent"]);
      expect(await find("%")).toEqual(["percent"]);
      // An exception's own title finds its series.
      expect(await find("retro")).toEqual(["series"]);
      // The latest start first, undated last; at most `limit`.
      expect(await find("e")).toEqual(["plain", "series", "cafe", "percent"]);
      expect(await find("e", 2)).toEqual(["plain", "series"]);
      expect(await find("")).toEqual([]);
      expect(await store.search([], "отчёт")).toEqual([]);
    });

    test("a series whose rule ical.js refuses counts and reminds at its start alone; the others as ever (D118)", async () => {
      const { store, calendar } = await setup();
      const alarm = "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\n";
      const save = (uid: string, fields: string) =>
        store.saveFromServer(calendar.id, {
          href: `${uid}.ics`,
          etag: '"1"',
          ics: task(uid, fields),
        });
      // ical.js throws `Malformed values in BYDAY part` for a sixth Monday.
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await save(
          "refused",
          `DTSTART:20261102T090000Z\r\nDUE:20261102T100000Z\r\nRRULE:FREQ=MONTHLY;BYDAY=6MO\r\n${alarm}`,
        );
        await save("plain", `DUE:20261103T100000Z\r\n${alarm}`);
        const undone = await store.undoneTasksBefore([calendar.id], "2026-11-04", "UTC");
        expect(undone.map((u) => u.object.uid)).toEqual(["refused", "plain"]);
        const reminders = await store.reminders({
          from: "2026-11-02",
          to: "2026-11-04",
          timeZone: "UTC",
        });
        expect(reminders.map((r) => [r.uid, new Date(r.fireAt).toISOString()])).toEqual([
          ["refused", "2026-11-02T08:50:00.000Z"],
          ["plain", "2026-11-03T09:50:00.000Z"],
        ]);
        expect(logged).toHaveBeenCalled();
      } finally {
        logged.mockRestore();
      }
    });

    test("reminders: every calendar's items whose alarms fire in the range, soonest first (D100)", async () => {
      const { store, account, calendar } = await setup();
      const other = await store.saveCalendar({
        accountId: account.id,
        url: "https://cloud.example.com/remote.php/dav/calendars/astro/work/",
        name: "Work",
        color: null,
        components: ["VEVENT"],
        rights: NO_RIGHTS,
      });
      const alarm = (trigger: string) =>
        `BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER${trigger}\r\nEND:VALARM\r\n`;
      const save = (calendarId: string, uid: string, ics: string) =>
        store.saveFromServer(calendarId, { href: `${uid}.ics`, etag: '"1"', ics });
      await save(
        calendar.id,
        "meeting",
        event("meeting", "20261105T080000Z", "20261105T090000Z", alarm(":-PT15M")),
      );
      await save(
        other.id,
        "work",
        event("work", "20261104T120000Z", "20261104T130000Z", alarm(":-PT10M")),
      );
      // Weeks after the range, an alarm a month before it.
      await save(
        calendar.id,
        "far",
        event("far", "20261206T080000Z", "20261206T090000Z", alarm(":-P30D")),
      );
      // A series from long ago reminds of its occurrences in the range.
      await save(
        calendar.id,
        "daily",
        event(
          "daily",
          "20250101T070000Z",
          "20250101T073000Z",
          `RRULE:FREQ=DAILY\r\n${alarm(":-PT5M")}`,
        ),
      );
      // An overdue and an undated task with an alarm at a time of its own.
      await save(
        calendar.id,
        "overdue",
        task("overdue", `DUE:20261001T100000Z\r\n${alarm(";VALUE=DATE-TIME:20261106T060000Z")}`),
      );
      await save(
        calendar.id,
        "undated",
        task("undated", alarm(";VALUE=DATE-TIME:20261106T070000Z")),
      );
      // None of these.
      await save(calendar.id, "plain", event("plain", "20261105T080000Z", "20261105T090000Z"));
      await save(
        calendar.id,
        "done",
        task("done", `DUE:20261105T100000Z\r\nSTATUS:COMPLETED\r\n${alarm(":-PT15M")}`),
      );
      await save(
        calendar.id,
        "past",
        event("past", "20261001T080000Z", "20261001T090000Z", alarm(";RELATED=END:PT1H")),
      );
      await save(
        calendar.id,
        "dense",
        event(
          "dense",
          "19900101T000000Z",
          "19900101T000100Z",
          `RRULE:FREQ=MINUTELY\r\n${alarm(":-PT1M")}`,
        ),
      );
      const deleted = await save(
        calendar.id,
        "deleted",
        event("deleted", "20261105T080000Z", "20261105T090000Z", alarm(":-PT15M")),
      );
      await store.deleteLocal(deleted.id);

      const range = { from: "2026-11-04", to: "2026-11-07", timeZone: "Europe/Vilnius" };
      const fired = async () =>
        (await store.reminders(range)).map((r) => [r.uid, new Date(r.fireAt).toISOString()]);
      expect(await fired()).toEqual([
        ["daily", "2026-11-04T06:55:00.000Z"],
        ["work", "2026-11-04T11:50:00.000Z"],
        ["daily", "2026-11-05T06:55:00.000Z"],
        ["meeting", "2026-11-05T07:45:00.000Z"],
        ["overdue", "2026-11-06T06:00:00.000Z"],
        ["daily", "2026-11-06T06:55:00.000Z"],
        ["undated", "2026-11-06T07:00:00.000Z"],
        ["far", "2026-11-06T08:00:00.000Z"],
      ]);
      const [first] = await store.reminders(range);
      const daily = await store.objectAt(calendar.id, "daily.ics");
      expect(first).toMatchObject({ objectId: daily!.id, kind: "event", title: "daily" });

      // A change shows at once, however often the set is asked.
      await save(
        calendar.id,
        "meeting",
        event("meeting", "20261105T080000Z", "20261105T090000Z", alarm(":-PT30M")),
      );
      expect((await fired()).filter(([uid]) => uid === "meeting")).toEqual([
        ["meeting", "2026-11-05T07:30:00.000Z"],
      ]);
      await store.removeCalendar(other.id);
      expect((await fired()).filter(([uid]) => uid === "work")).toEqual([]);
    });

    test("a listener hears every write until it unsubscribes", async () => {
      const { store, calendar } = await setup();
      let heard = 0;
      const unsubscribe = store.subscribe(() => heard++);
      await store.saveFromServer(calendar.id, { href: "l.ics", etag: '"1"', ics: task("l") });
      expect(heard).toBe(1);
      await store.saveLocal(calendar.id, task("m"));
      await store.setSyncState(calendar.id, { syncToken: "1", ctag: null });
      expect(heard).toBe(3);
      // Reads are not writes.
      await store.objectsBetween([calendar.id], {
        from: "2026-11-01",
        to: "2026-11-02",
        timeZone: "UTC",
      });
      expect(heard).toBe(3);
      unsubscribe();
      await store.saveLocal(calendar.id, task("n"));
      expect(heard).toBe(3);
    });

    test("conflicts keep our refused version and go with their object", async () => {
      const { store, account, calendar } = await setup();
      const object = await store.saveFromServer(calendar.id, {
        href: "a.ics",
        etag: '"2"',
        ics: event("a", "20261102T090000Z", "20261102T100000Z"),
      });
      const conflict = await store.addConflict(
        object.id,
        event("a", "20261102T150000Z", "20261102T160000Z"),
      );
      expect(await store.conflicts()).toEqual([conflict]);
      await store.removeAccount(account.id);
      expect(await store.conflicts()).toEqual([]);
      expect(await store.calendars()).toEqual([]);
    });

    test("a sync's download is stored in one transaction with one notification, a pending change kept (D99)", async () => {
      // The driver's transactions counted: each begins with BEGIN.
      const inner = await driver();
      let begins = 0;
      const counted: SqlDriver = {
        query: (statement, params) => inner.query(statement, params),
        script: (statement) => {
          if (statement.startsWith("BEGIN")) begins++;
          return inner.script(statement);
        },
        close: () => inner.close(),
        ...(inner.subscribe ? { subscribe: (listener) => inner.subscribe!(listener) } : {}),
      };
      const store = await Store.open(counted);
      const account = await store.addAccount({
        provider: "caldav",
        name: "Nextcloud",
        serverUrl: "https://cloud.example.com/",
        username: "astro",
      });
      const calendar = await store.saveCalendar({
        accountId: account.id,
        url: "https://cloud.example.com/cal/",
        name: "Cal",
        color: null,
        components: ["VEVENT", "VTODO"],
        rights: ALL_RIGHTS,
      });
      await store.saveFromServer(calendar.id, { href: "mine.ics", etag: '"0"', ics: task("mine") });
      const mine = await store.saveLocal(calendar.id, task("mine", "STATUS:COMPLETED\r\n"));
      const listener = vi.fn();
      store.subscribe(listener);
      begins = 0;

      const resources = Array.from({ length: 250 }, (_, i) => ({
        href: `t${i}.ics`,
        etag: `"${i}"`,
        ics: task(`t${i}`),
      }));
      const result = await store.saveManyFromServer(calendar.id, [
        ...resources,
        { href: "broken.ics", etag: '"b"', ics: "not iCalendar" },
        { href: "mine.ics", etag: '"1"', ics: task("mine", "SUMMARY:theirs\r\n") },
        // An href given twice is one row, the later version.
        { href: "t3.ics", etag: '"3b"', ics: task("t3", "SUMMARY:again\r\n") },
      ]);
      expect([begins, listener.mock.calls.length]).toEqual([1, 1]);
      expect(result).toEqual({ saved: 250, invalid: ["broken.ics"] });
      expect(await store.objectAt(calendar.id, "t3.ics")).toMatchObject({ etag: '"3b"' });
      const stored = await store.hrefs(calendar.id);
      expect(stored).toHaveLength(251);
      // Ours stays pending, untouched; the others are the server's.
      expect(await store.object(mine.id)).toMatchObject({ pending: "update", ics: mine.ics });
      expect(await store.objectAt(calendar.id, "t7.ics")).toMatchObject({
        etag: '"7"',
        pending: "none",
        baseIcs: task("t7"),
      });

      // Again, changed: rows are updated in place, under their ids.
      const before = await store.objectAt(calendar.id, "t0.ics");
      await store.saveManyFromServer(calendar.id, [
        { href: "t0.ics", etag: '"x"', ics: task("t0", "STATUS:COMPLETED\r\n") },
      ]);
      expect(await store.objectAt(calendar.id, "t0.ics")).toMatchObject({
        id: before!.id,
        etag: '"x"',
        done: true,
      });

      // Removed by the server: in one transaction, ours only if still as seen.
      listener.mockClear();
      begins = 0;
      const gone = stored
        .filter((o) => o.href.startsWith("t"))
        .map(({ id }) => ({ id, pending: "none" as const }));
      const removed = await store.removeManyFromServer([...gone, { id: mine.id, pending: "none" }]);
      expect([begins, listener.mock.calls.length, removed.length]).toEqual([1, 1, 250]);
      expect((await store.hrefs(calendar.id)).map((o) => o.href)).toEqual(["mine.ics"]);
      await store.close();
    });
  });
}
