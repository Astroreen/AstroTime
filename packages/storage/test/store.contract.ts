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
          { replacePending: true },
        ),
      ).toMatchObject({
        pending: "none",
        etag: '"2"',
        ics: server,
      });
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
