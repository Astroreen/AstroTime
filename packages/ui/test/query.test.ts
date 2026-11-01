// The views' query path on the demo data: the store → parsed objects (kept
// while unchanged) → occurrences → the layout, with today's undone tasks.
import { HandOverError, Store, type SqlDriver, type StoredObject } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { describe, expect, test } from "vite-plus/test";

import { daysFrom } from "../src/calendar/dates.ts";
import { liveQuery } from "../src/calendar/live.ts";
import { layoutRange, ObjectCache, type RangeLayout } from "../src/calendar/query.ts";
import { DEMO_SERVER, loadDemo } from "../src/demo/index.ts";

const timeZone = "Europe/Vilnius";
const today = "2026-11-04";
const NOW = Date.parse("2026-11-04T10:40:00+02:00");

async function demoStore() {
  const store = await Store.open(nodeDriver());
  await loadDemo(store, { languages: ["en-US"], timeZone, now: NOW });
  const ids = (await store.calendars()).map((calendar) => calendar.id);
  return { store, ids };
}

async function layoutOf(store: Store, ids: string[], days: string[]): Promise<RangeLayout> {
  const range = { from: days[0]!, to: daysFrom(days.at(-1)!, 2)[1]!, timeZone };
  const rows = await store.objectsBetween(ids, range);
  const undone = await store.undoneTasksBefore(ids, today, timeZone);
  return layoutRange(new ObjectCache().entries(rows, range), days, {
    today,
    timeZone,
    undone: undone.length,
  });
}

const titles = (layout: RangeLayout) =>
  layout.strip
    .toSorted((a, b) => a.span.row - b.span.row)
    .map(({ entry }) => entry?.occurrence.item.summary ?? "(undone)");

describe("the demo data on the views", () => {
  test("today's strip: the all-day event, the undone chip, then the tasks (D14, D51)", async () => {
    const { store, ids } = await demoStore();
    const layout = await layoutOf(store, ids, [today]);
    expect(titles(layout)).toEqual([
      "Mom's birthday",
      "(undone)",
      "Buy a gift",
      "Call the bank",
      "Pay the rent",
    ]);
    expect(layout.rows).toBe(5);
    expect(
      layout.strip.find(({ entry }) => entry?.occurrence.item.summary === "Pay the rent")?.entry
        ?.done,
    ).toBe(true);
  });

  test("today's timed items cascade (D15), and a task with a due time is a chip (D16)", async () => {
    const { store, ids } = await demoStore();
    const [column] = (await layoutOf(store, ids, [today])).columns;
    const placed = Object.fromEntries(
      column!.timed.map(({ placed: p, entry }) => [
        entry.occurrence.item.summary,
        { left: p.left, shape: p.shape },
      ]),
    );
    expect(placed["Design review"]).toEqual({ left: 0, shape: "block" });
    expect(placed["Budget planning"]).toEqual({ left: 0.15, shape: "block" });
    expect(placed["Call with Anna"]).toEqual({ left: 0.3, shape: "block" });
    expect(placed["Send the report"]).toEqual({ left: 0, shape: "chip" });
  });

  test("a week: spans across days, undone tasks gone from their days, done ones kept", async () => {
    const { store, ids } = await demoStore();
    const days = daysFrom("2026-11-02", 7);
    const layout = await layoutOf(store, ids, days);
    const spanOf = (title: string) =>
      layout.strip.find(({ entry }) => entry?.occurrence.item.summary === title)?.span;
    expect(spanOf("Developer conference")).toMatchObject({ firstDay: 3, lastDay: 5 });
    expect(spanOf("Trip to Tallinn")).toMatchObject({
      firstDay: 6,
      lastDay: 6,
      continuesAfter: true,
    });
    expect(spanOf("Tidy the desk")).toMatchObject({ firstDay: 0, lastDay: 0 });
    expect(
      layout.strip.filter(({ entry }) => entry === null).map(({ span }) => span),
    ).toMatchObject([{ firstDay: 2, lastDay: 2 }]);
    const monday = layout.columns[0]!.timed.map(({ entry }) => entry.occurrence.item.summary);
    expect(monday).toContain("Stand-up");
    expect(monday).not.toContain("Reply to Olga");
    // The night train goes on past midnight.
    const sunday = layout.columns[6]!.timed.find(
      ({ entry }) => entry.occurrence.item.summary === "Night train",
    );
    expect(sunday?.placed).toMatchObject({ top: 22 * 60, continuesAfter: true });
  });

  test("the store finds the three undone tasks due before today, each once", async () => {
    const { store, ids } = await demoStore();
    const undone = await store.undoneTasksBefore(ids, today, timeZone);
    // Oldest due first; the passport and the recycling were both due on Sunday.
    expect(undone.map((u) => u.occurrence.item.summary)).toEqual([
      "Renew the passport",
      "Take out the recycling",
      "Reply to Olga",
    ]);
  });

  test("loading the demo again replaces its account and leaves others alone", async () => {
    const { store } = await demoStore();
    await store.addAccount({
      provider: "caldav",
      name: "Mine",
      serverUrl: "https://cloud.example.com/",
      username: "me",
    });
    await loadDemo(store, { languages: ["ru-RU"], timeZone, now: NOW });
    const accounts = await store.accounts();
    expect(accounts.map((a) => [a.name, a.serverUrl])).toEqual([
      ["Mine", "https://cloud.example.com/"],
      ["Демо", DEMO_SERVER],
    ]);
    expect((await store.calendars()).map((c) => c.name).toSorted()).toEqual([
      "Задачи",
      "Личное",
      "Праздники",
      "Работа",
    ]);
  });
});

describe("the object cache", () => {
  test("parses an object once while its iCalendar is unchanged", async () => {
    const { store, ids } = await demoStore();
    const range = { from: today, to: "2026-11-05", timeZone };
    const cache = new ObjectCache();
    const first = cache.entries(await store.objectsBetween(ids, range), range);
    const again = cache.entries(await store.objectsBetween(ids, range), range);
    expect(again.map((e) => e.object)).toEqual(first.map((e) => e.object));
    expect(again[0]!.object).toBe(first[0]!.object);

    const lunch = (await store.objectsBetween(ids, range)).find((o) => o.uid === "demo-lunch")!;
    await store.saveFromServer(lunch.calendarId, {
      href: lunch.href,
      etag: '"2"',
      ics: lunch.ics.replace("SUMMARY:Lunch with Marta", "SUMMARY:Lunch with Ines"),
    });
    const changed = cache.entries(await store.objectsBetween(ids, range), range);
    const byUid = (entries: typeof first, uid: string) =>
      entries.find((e) => e.object.uid === uid)!;
    expect(byUid(changed, "demo-lunch").occurrence.item.summary).toBe("Lunch with Ines");
    expect(byUid(changed, "demo-lunch").object).not.toBe(byUid(first, "demo-lunch").object);
    expect(byUid(changed, "demo-review").object).toBe(byUid(first, "demo-review").object);
  });
});

describe("live queries", () => {
  const event = (uid: string) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:20261104T120000Z\r\nDTEND:20261104T130000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

  test("a burst of writes during a run costs one more run, whose result sees them all", async () => {
    const { store, ids } = await demoStore();
    const range = { from: today, to: "2026-11-05", timeZone };
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let runs = 0;
    const results: StoredObject[][] = [];
    let delivered!: () => void;
    const result = new Promise<void>((resolve) => (delivered = resolve));
    const stop = liveQuery(
      store,
      async () => {
        runs++;
        await gate;
        return store.objectsBetween(ids, range);
      },
      (rows) => {
        results.push(rows);
        delivered();
      },
    );
    // The first run waits at the gate while ten writes land.
    await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.saveLocal(ids[0]!, event(`burst-${i}`))),
    );
    release();
    await result;
    expect(runs).toBe(2);
    expect(results).toHaveLength(1);
    expect(results[0]!.filter((row) => row.uid.startsWith("burst-"))).toHaveLength(10);

    stop();
    await store.saveLocal(ids[0]!, event("after"));
    expect(runs).toBe(2);
  });

  test("a read the leader tab took with it is not reported: it runs again once the next leader serves (D98)", async () => {
    // The web driver as a hand-over leaves it: one statement unanswered, then
    // every subscriber told that the store is served again.
    const inner = nodeDriver();
    let fail = false;
    let failed!: () => void;
    const tookIt = new Promise<void>((resolve) => (failed = resolve));
    let served = () => {};
    const driver: SqlDriver = {
      query: async (sql, params) => {
        if (fail && sql.includes('from "accounts"')) {
          fail = false;
          failed();
          throw new HandOverError("The leader went.");
        }
        return inner.query(sql, params);
      },
      script: (sql) => inner.script(sql),
      close: () => inner.close(),
      subscribe(listener) {
        served = listener;
        return () => {};
      },
    };
    const store = await Store.open(driver);
    fail = true;
    const errors: unknown[] = [];
    const counted = new Promise<number>((resolve) =>
      liveQuery(
        store,
        async () => (await store.accounts()).length,
        resolve,
        (error) => errors.push(error),
      ),
    );
    // The first run fails with the hand-over (wrapped by Drizzle); then the next leader serves.
    await tookIt;
    served();
    expect(await counted).toBe(0);
    expect(errors).toEqual([]);
  });
});
