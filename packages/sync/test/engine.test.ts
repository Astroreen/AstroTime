import { OfflineError, type Provider } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import { syncAccount } from "../src/index.ts";
import { memoryServer, type MemoryServer } from "./memory-provider.ts";

const calendarUrl = "https://dav.example/cal/";
const task = (uid: string, summary = uid) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nSUMMARY:${summary}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;

async function device(server: Provider) {
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "Memory",
    serverUrl: calendarUrl,
    username: null,
  });
  const sync = () => syncAccount(store, server, account.id);
  await sync();
  const [calendar] = await store.calendars(account.id);
  return { store, sync, calendar: calendar! };
}

describe("the sync engine's harder paths (review of #4)", () => {
  test("an object the server serves that is not iCalendar is skipped and reported, the rest arrive (D36)", async () => {
    const server = memoryServer(calendarUrl);
    server.objects.set(`${calendarUrl}broken.ics`, { etag: '"b"', ics: "not a calendar" });
    server.objects.set(`${calendarUrl}ok.ics`, { etag: '"o"', ics: task("ok") });
    const { store, calendar } = await device(server);
    expect((await store.undated([calendar.id])).map((o) => o.uid)).toEqual(["ok"]);
    const again = await syncAccount(store, server, calendar.accountId);
    expect(again.skipped).toEqual([`${calendarUrl}broken.ics`]);
  });

  test("a creation the server has no place for stays pending and is reported, never deleted", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("new"));
    server.beforeWrite = () => ({ ok: false, reason: "gone" });
    const report = await sync();
    expect(report.errors).toEqual([
      {
        href: `${calendarUrl}new.ics`,
        problem: "no-place",
        detail: `The server has no place for ${calendarUrl}new.ics`,
      },
    ]);
    expect((await store.pending(calendar.id)).map((o) => [o.uid, o.pending])).toEqual([
      ["new", "create"],
    ]);

    server.beforeWrite = () => {};
    expect(await sync()).toMatchObject({ uploaded: 1, errors: [] });
  });

  test("a creation whose answer was lost is recognised on the next sync, without a conflict", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("twice"));
    // The server stores it, but the answer never arrives.
    server.beforeWrite = (method, href) => {
      if (method !== "create") return;
      server.objects.set(href, { etag: '"lost"', ics: task("twice") });
      throw new OfflineError("the answer was lost");
    };
    await expect(sync()).rejects.toThrow(OfflineError);
    server.beforeWrite = () => {};
    expect(await sync()).toMatchObject({ conflicts: 0, errors: [] });
    expect(await store.pending(calendar.id)).toEqual([]);
    expect((await store.objectAt(calendar.id, `${calendarUrl}twice.ics`))?.etag).toBe('"lost"');
  });

  test("a creation at an href another object holds keeps the server's and lists ours as a conflict", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("clash", "Ours"));
    server.objects.set(`${calendarUrl}clash.ics`, { etag: '"x"', ics: task("clash", "Theirs") });
    expect(await sync()).toMatchObject({ conflicts: 1 });
    expect(
      (await store.undated([calendar.id])).map((o) => o.ics.includes("SUMMARY:Theirs")),
    ).toEqual([true]);
    expect((await store.conflicts())[0]?.localIcs).toContain("SUMMARY:Ours");
  });

  test("one object failing does not stop the others, nor the download", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("bad"));
    await store.saveLocal(calendar.id, task("good"));
    server.objects.set(`${calendarUrl}theirs.ics`, { etag: '"t"', ics: task("theirs") });
    server.beforeWrite = (_method, href) => {
      if (href.endsWith("bad.ics")) throw new Error("415 Unsupported Media Type");
    };
    const report = await sync();
    expect(report).toMatchObject({
      uploaded: 1,
      downloaded: 1,
      errors: [
        { href: `${calendarUrl}bad.ics`, problem: "failed", detail: "415 Unsupported Media Type" },
      ],
    });
    expect((await store.pending(calendar.id)).map((o) => o.uid)).toEqual(["bad"]);
  });

  test("an outage in the middle stops the sync; what did not go up stays pending", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("first"));
    await store.saveLocal(calendar.id, task("second"));
    // The network goes after the first upload, whichever it is.
    let writes = 0;
    server.beforeWrite = () => {
      if (++writes > 1) server.offline = true;
      if (server.offline) throw new OfflineError("offline");
    };
    await expect(sync()).rejects.toThrow(OfflineError);
    expect(await store.pending(calendar.id)).toHaveLength(1);
    expect(server.objects.size).toBe(1);
    server.offline = false;
    server.beforeWrite = () => {};
    expect(await sync()).toMatchObject({ uploaded: 1 });
    expect([...server.objects.keys()].toSorted()).toEqual([
      `${calendarUrl}first.ics`,
      `${calendarUrl}second.ics`,
    ]);
  });

  test("in a read-only calendar a new item waits, reported; an edit gives way at once, ours a conflict", async () => {
    const server: MemoryServer = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("kept", "Kept"));
    await sync();
    server.calendarList = [{ ...server.calendarList[0]!, readOnly: true }];
    await store.saveLocal(calendar.id, task("locked"));
    await store.saveLocal(calendar.id, task("kept", "Ours"));
    const report = await sync();
    expect(report.errors.map((e) => e.problem)).toEqual(["read-only"]);
    expect(report.conflicts).toBe(1);
    expect((await store.pending(calendar.id)).map((o) => o.uid)).toEqual(["locked"]);
    expect((await store.objectAt(calendar.id, `${calendarUrl}kept.ics`))?.ics).toContain(
      "SUMMARY:Kept",
    );
    expect(server.objects.get(`${calendarUrl}kept.ics`)?.ics).toContain("SUMMARY:Kept");
  });

  test("after a write the server answered without an ETag, a change made there since is merged, not overwritten", async () => {
    const server = memoryServer(calendarUrl);
    server.etagsOnWrite = false;
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("plain", "Plain"));
    await sync();
    const href = `${calendarUrl}plain.ics`;
    // As right after a write the server answered without an ETag, before a download fills it in.
    const synced = (await store.objectAt(calendar.id, href))!;
    await store.markSynced(synced.id, { href, etag: null, ics: synced.ics });
    // Another client adds a location there; we rename it here.
    server.objects.set(href, {
      etag: '"theirs"',
      ics: task("plain", "Plain").replace("END:VTODO", "LOCATION:Kitchen\r\nEND:VTODO"),
    });
    await store.saveLocal(calendar.id, task("plain", "Renamed"));
    expect(await sync()).toMatchObject({ uploaded: 1, conflicts: 0, errors: [] });
    const stored = server.objects.get(href)!.ics;
    expect(stored).toContain("SUMMARY:Renamed");
    expect(stored).toContain("LOCATION:Kitchen");
  });

  test("after a write without an ETag, an unchanged server copy is written against the ETag it has now", async () => {
    const server = memoryServer(calendarUrl);
    server.etagsOnWrite = false;
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("same", "Same"));
    await sync();
    const synced = (await store.objectAt(calendar.id, `${calendarUrl}same.ics`))!;
    await store.markSynced(synced.id, { href: synced.href, etag: null, ics: synced.ics });
    await store.saveLocal(calendar.id, task("same", "Edited"));
    expect(await sync()).toMatchObject({ uploaded: 1, conflicts: 0 });
    expect(server.objects.get(`${calendarUrl}same.ics`)!.ics).toContain("SUMMARY:Edited");
  });

  test("an edit of an object deleted on the server, with no ETag to write against, is dropped, not recreated (D38)", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("ghost", "Ghost"));
    await sync();
    const href = `${calendarUrl}ghost.ics`;
    const synced = (await store.objectAt(calendar.id, href))!;
    await store.markSynced(synced.id, { href, etag: null, ics: synced.ics });
    server.objects.delete(href);
    await store.saveLocal(calendar.id, task("ghost", "Edited"));
    await sync();
    expect(server.objects.has(href)).toBe(false);
    expect(await store.objectAt(calendar.id, href)).toBeUndefined();
  });

  test("a refused write with no base keeps the server's version and lists ours as a conflict", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    const href = `${calendarUrl}nobase.ics`;
    server.objects.set(href, { etag: '"1"', ics: task("nobase", "Theirs") });
    // A row with no base, as one written before the store kept bases.
    const row = await store.saveFromServer(calendar.id, {
      href,
      etag: '"0"',
      ics: task("nobase", "Old"),
    });
    await store.rebase(row.id, row.ics, { ics: row.ics, etag: '"0"', baseIcs: row.ics });
    await store.saveLocal(calendar.id, task("nobase", "Ours"));
    const local = (await store.objectAt(calendar.id, href))!;
    await store.rebase(local.id, local.ics, {
      ics: local.ics,
      etag: '"0"',
      baseIcs: null as unknown as string,
    });
    expect(await sync()).toMatchObject({ conflicts: 1 });
    expect(server.objects.get(href)!.ics).toContain("SUMMARY:Theirs");
    expect((await store.conflicts())[0]?.localIcs).toContain("SUMMARY:Ours");
  });

  test("an interrupted sync's error carries what was done until then", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("one"));
    await store.saveLocal(calendar.id, task("two"));
    let writes = 0;
    server.beforeWrite = () => {
      if (++writes > 1) throw new OfflineError("offline");
    };
    const error = await sync().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OfflineError);
    expect((error as { report?: unknown }).report).toMatchObject({ uploaded: 1 });
  });

  test("a pending edit dropped because the server deleted its object is reported", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("vanish"));
    await sync();
    server.objects.delete(`${calendarUrl}vanish.ics`);
    await store.saveLocal(calendar.id, task("vanish", "Edited"));
    expect((await sync()).dropped).toEqual([`${calendarUrl}vanish.ics`]);
  });

  test("in a read-only calendar a stuck edit gives way: the server's version shows, ours is a conflict", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("shared", "Original"));
    await sync();
    server.calendarList = [{ ...server.calendarList[0]!, readOnly: true }];
    await store.saveLocal(calendar.id, task("shared", "Ours"));
    const href = `${calendarUrl}shared.ics`;
    server.objects.set(href, { etag: '"owner"', ics: task("shared", "Owner's") });
    expect(await sync()).toMatchObject({ conflicts: 1 });
    expect((await store.objectAt(calendar.id, href))?.ics).toContain("SUMMARY:Owner's");
    expect(await store.pending(calendar.id)).toEqual([]);
    expect((await store.conflicts())[0]?.localIcs).toContain("SUMMARY:Ours");
  });

  test("a calendar missing from a listing keeps its unsent changes, reported; empty, it goes", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("unsent"));
    server.beforeWrite = () => {
      throw new Error("503 Service Unavailable");
    };
    await sync();
    const listed = server.calendarList;
    server.calendarList = [];
    const report = await sync();
    expect(report.errors.map((e) => e.problem)).toEqual(["calendar-gone-unsent"]);
    expect((await store.pending(calendar.id)).map((o) => o.uid)).toEqual(["unsent"]);
    server.calendarList = listed;
    server.beforeWrite = () => {};
    expect(await sync()).toMatchObject({ uploaded: 1 });
    server.calendarList = [];
    await sync();
    expect(await store.calendars()).toEqual([]);
  });

  test("a weak ETag is never sent in If-Match", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("weak", "One"));
    await sync();
    const href = `${calendarUrl}weak.ics`;
    const row = (await store.objectAt(calendar.id, href))!;
    await store.markSynced(row.id, { href, etag: 'W/"1"', ics: row.ics });
    const sent: (string | null)[] = [];
    const update = server.update.bind(server);
    server.update = async (h, ics, etag) => {
      sent.push(etag);
      return update(h, ics, etag);
    };
    await store.saveLocal(calendar.id, task("weak", "Two"));
    expect(await sync()).toMatchObject({ uploaded: 1, conflicts: 0 });
    expect(sent.every((e) => !e?.startsWith("W/"))).toBe(true);
  });

  test("after a merge, a server without a strong ETag gets no blind retry; the next sync compares first", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("m", "One"));
    await sync();
    const href = `${calendarUrl}m.ics`;
    server.objects.set(href, {
      etag: '"theirs"',
      ics: task("m", "One").replace("END:VTODO", "LOCATION:There\r\nEND:VTODO"),
    });
    const fetchServer = server.fetch.bind(server);
    // The server answers a GET with a weak ETag only.
    server.fetch = async (h) => {
      const object = await fetchServer(h);
      return object ? { ...object, etag: 'W/"weak"' } : null;
    };
    const updates: (string | null)[] = [];
    const update = server.update.bind(server);
    server.update = async (h, ics, etag) => {
      updates.push(etag);
      return update(h, ics, etag);
    };
    await store.saveLocal(calendar.id, task("m", "Two"));
    await sync();
    // One conditional try (refused), then no blind write against the weak ETag.
    expect(updates).toEqual(['"1"']);
    expect((await store.pending(calendar.id)).map((o) => o.uid)).toEqual(["m"]);
  });

  test("a server change held back by a pending edit keeps the old sync token, so it is reported again", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("held", "One"));
    await sync();
    const before = (await store.calendars())[0]!.syncToken;
    const href = `${calendarUrl}held.ics`;
    server.objects.set(href, { etag: '"theirs"', ics: task("held", "Theirs") });
    server.beforeWrite = () => {
      throw new Error("503");
    };
    await store.saveLocal(calendar.id, task("held", "Ours"));
    await sync();
    expect((await store.calendars())[0]!.syncToken).toBe(before);
  });

  test("an edit made while a sync runs survives that sync's news of a server deletion", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("mid", "One"));
    await sync();
    const href = `${calendarUrl}mid.ics`;
    server.objects.delete(href);
    const changes = server.changes.bind(server);
    // The user edits it after the sync took its snapshot, before the listing arrives.
    server.changes = async (...args) => {
      const result = await changes(...args);
      await store.saveLocal(calendar.id, task("mid", "Edited mid-sync"));
      return result;
    };
    await sync();
    expect((await store.objectAt(calendar.id, href))?.pending).toBe("update");
  });

  test("an edit made while a taken href is resolved stays pending", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("race", "Ours"));
    const href = `${calendarUrl}race.ics`;
    server.objects.set(href, { etag: '"x"', ics: task("race", "Theirs") });
    const fetchServer = server.fetch.bind(server);
    server.fetch = async (h) => {
      const object = await fetchServer(h);
      await store.saveLocal(calendar.id, task("race", "Edited meanwhile"));
      return object;
    };
    await sync().catch(() => {});
    const row =
      (await store.objectAt(calendar.id, href)) ?? (await store.objectAt(calendar.id, "race.ics"));
    expect(row?.ics).toContain("SUMMARY:Edited meanwhile");
    expect(row?.pending).not.toBe("none");
  });

  test("in a read-only calendar a pending object the server serves as garbage is skipped, not stuck", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("junk", "One"));
    await sync();
    server.calendarList = [{ ...server.calendarList[0]!, readOnly: true }];
    const href = `${calendarUrl}junk.ics`;
    await store.saveLocal(calendar.id, task("junk", "Ours"));
    server.objects.set(href, { etag: '"bad"', ics: "not a calendar" });
    const report = await sync();
    expect([report.errors, report.skipped]).toEqual([[], [href]]);
  });

  test("in a read-only calendar a deletion the server will not take comes back, and says so", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("keep"));
    await sync();
    server.calendarList = [{ ...server.calendarList[0]!, readOnly: true }];
    const row = (await store.objectAt(calendar.id, `${calendarUrl}keep.ics`))!;
    await store.deleteLocal(row.id);
    const report = await sync();
    expect(report.errors.map((e) => e.problem)).toEqual(["deletion-reverted"]);
    expect((await store.objectAt(calendar.id, `${calendarUrl}keep.ics`))?.pending).toBe("none");
  });

  test("an edit made while a read-only calendar gives way is kept, not overwritten", async () => {
    const server = memoryServer(calendarUrl);
    const { store, sync, calendar } = await device(server);
    await store.saveLocal(calendar.id, task("ro", "One"));
    await sync();
    server.calendarList = [{ ...server.calendarList[0]!, readOnly: true }];
    await store.saveLocal(calendar.id, task("ro", "Ours"));
    const fetchServer = server.fetch.bind(server);
    server.fetch = async (h) => {
      const object = await fetchServer(h);
      await store.saveLocal(calendar.id, task("ro", "Edited while it settled"));
      return object;
    };
    await sync();
    expect((await store.objectAt(calendar.id, `${calendarUrl}ro.ics`))?.ics).toContain(
      "SUMMARY:Edited while it settled",
    );
  });
});
