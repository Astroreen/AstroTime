// How long a big calendar takes to read (docs/plans/foundation.md#D118): a
// calendar like PR #17's, generated the same on every run, read the way the
// views, the "N undone tasks" chip and the reminder planner read it. It
// prints numbers; nothing here passes or fails (AGENTS.md: no timeouts in
// tests). Run it by hand, before and after a change to the read path:
//
//   node scripts/bench-big-calendar.ts
//
// The calendar and its today are `big-calendar.ts`'s.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CalendarObject,
  occurrencesBetween,
  soonestReminders,
  zonedToEpoch,
  type Range,
} from "../packages/core/src/index.ts";
import { walks } from "../packages/core/src/recurrence.ts";
import { Store } from "../packages/storage/src/index.ts";
import { nodeDriver } from "../packages/storage/src/node.ts";
import { agendaDays } from "../packages/ui/src/calendar/agenda.ts";
import { addDays, daysFrom } from "../packages/ui/src/calendar/dates.ts";
import { layoutMonth } from "../packages/ui/src/calendar/month.ts";
import { layoutRange, ObjectCache } from "../packages/ui/src/calendar/query.ts";
import { fill, TODAY, ZONE } from "./big-calendar.ts";

/** Each measurement is taken this many times, each time on a range not read before. */
const RUNS = 5;

async function populate(path: string): Promise<string[]> {
  const driver = nodeDriver(path);
  // A benchmark's file need not survive a power cut: no sync on every commit.
  await driver.script("PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;");
  const store = await Store.open(driver);
  const ids = await fill(store);
  await store.close();
  return ids;
}

/** Runs `measure` `RUNS` times, the run's index given, and prints the median and the range. */
async function report(label: string, measure: (run: number) => Promise<number> | number) {
  const times: number[] = [];
  for (let run = 0; run < RUNS; run++) times.push(await measure(run));
  times.sort((a, b) => a - b);
  const ms = (t: number) => `${t.toFixed(t < 10 ? 1 : 0)} ms`;
  const median = times[Math.floor(times.length / 2)]!;
  console.log(
    `${label.padEnd(58)} ${ms(median).padStart(9)}   (${ms(times[0]!)} – ${ms(times.at(-1)!)})`,
  );
}

async function elapsed(work: () => unknown): Promise<number> {
  const started = performance.now();
  await work();
  return performance.now() - started;
}

const range = (from: string, days: number): Range => ({
  from,
  to: addDays(from, days),
  timeZone: ZONE,
});

async function main() {
  const directory = mkdtempSync(join(tmpdir(), "astrotime-bench-"));
  const path = join(directory, "store.sqlite");
  try {
    let started = performance.now();
    const ids = await populate(path);
    console.log(`Stored 12 230 objects in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
    const store = await Store.open(nodeDriver(path));
    const context = { today: TODAY, timeZone: ZONE, undone: 0 };
    const monday = "2026-11-02";

    console.log(`\nNode ${process.version}; the median of ${RUNS} runs, each on a new range:\n`);

    // A view's first read: the store's rows, parsed and expanded, then laid out.
    const view = async (cache: ObjectCache, from: string, days: number) => {
      const r = range(from, days);
      const entries = cache.entries(await store.objectsBetween(ids, r), r);
      return { entries, days: daysFrom(from, days) };
    };

    await report("week, first read (nothing parsed yet)", (run) =>
      elapsed(async () => {
        const { entries, days } = await view(new ObjectCache(), addDays(monday, 7 * run), 7);
        layoutRange(entries, days, context);
      }),
    );

    const cache = new ObjectCache();
    await view(cache, addDays(monday, -7 * 10), 7 * 30);
    await report("week, a new range (its objects parsed)", (run) =>
      elapsed(async () => {
        const { entries, days } = await view(cache, addDays(monday, 7 * run - 14), 7);
        layoutRange(entries, days, context);
      }),
    );
    await report("month (42 days), a new range", (run) =>
      elapsed(async () => {
        const { entries, days } = await view(cache, addDays("2026-10-26", 7 * run - 21), 42);
        layoutMonth(entries, days, context);
      }),
    );
    await report("Agenda chunk (84 days), a new range", (run) =>
      elapsed(async () => {
        const from = addDays(TODAY, -28 + run);
        const { entries } = await view(cache, from, 84);
        agendaDays(entries, from, addDays(from, 84), context);
      }),
    );

    // The store remembers the chip and the reminders per object: each run on a store of its own.
    await report("undone tasks chip, first read", async (run) => {
      const fresh = await Store.open(nodeDriver(path));
      const time = await elapsed(() => fresh.undoneTasksBefore(ids, addDays(TODAY, run), ZONE));
      await fresh.close();
      return time;
    });
    await report("reminders set (9 days), first read", async (run) => {
      const fresh = await Store.open(nodeDriver(path));
      const today = addDays(TODAY, run);
      const time = await elapsed(async () => {
        const all = await fresh.reminders(range(addDays(today, -1), 9));
        soonestReminders(all, zonedToEpoch(`${today}T10:40:00`, ZONE));
      });
      await fresh.close();
      return time;
    });

    // Where the time goes: the series alone, expanded into a new week.
    const series = (await store.objectsBetween(ids, range(monday, 7)))
      .filter((row) => row.uid?.startsWith("series-"))
      .map((row) => ({ uid: row.uid, object: CalendarObject.parse(row.ics) }));
    const daily = series.filter(({ uid }) => Number(uid.slice(7)) < 30);
    const weekly = series.filter(({ uid }) => Number(uid.slice(7)) >= 30);
    console.log("");
    await report(`${daily.length} daily series, occurrencesBetween a new week`, (run) =>
      elapsed(() => {
        for (const { object } of daily) occurrencesBetween(object, range(addDays(monday, run), 7));
      }),
    );
    await report(`${weekly.length} weekly series, occurrencesBetween a new week`, (run) =>
      elapsed(() => {
        for (const { object } of weekly) occurrencesBetween(object, range(addDays(monday, run), 7));
      }),
    );
    await store.close();

    // How the series were walked, over every read above.
    const fallbacks = [...walks.fallbacks].map(([message, count]) => `${count}× ${message}`);
    console.log(
      `\nRules started near the range ${walks.near}, walked from DTSTART ${walks.fromStart}; ` +
        `starts near the range ical.js refused ${fallbacks.length > 0 ? fallbacks.join(", ") : "0"}; ` +
        `searches out of tries ${walks.exhausted}; rules ical.js refused ${walks.refused}.`,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

await main();
