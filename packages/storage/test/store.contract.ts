// The store's behaviour, run against every driver: `store.test.ts` (Node) and
// `store.browser.test.ts` (sqlite-wasm on OPFS in Chromium).
import { describe, expect, test } from "vite-plus/test";

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
      readOnly: false,
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

    test("an account keeps the calendar home discovery found, and signing in again replaces it", async () => {
      const { store, account } = await setup();
      expect(account.homeUrl).toBeNull();
      const home = "https://cloud.example.com/remote.php/dav/calendars/astro/";
      await store.updateAccount(account.id, { homeUrl: home, username: "astro2" });
      expect(await store.accounts()).toEqual([{ ...account, homeUrl: home, username: "astro2" }]);
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
  });
}
