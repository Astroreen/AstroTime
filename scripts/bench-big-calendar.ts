// How long a big calendar takes to read (docs/plans/foundation.md#D118): a
// calendar like PR #17's, generated the same on every run, read the way the
// views, the "N undone tasks" chip and the reminder planner read it. It
// prints numbers; nothing here passes or fails (AGENTS.md: no timeouts in
// tests). Run it by hand, before and after a change to the read path:
//
//   node scripts/bench-big-calendar.ts
//
// Today is Wednesday 4 November 2026 in Europe/Vilnius. The calendar holds
// 12 230 objects in 3 calendars: 10 000 timed events over three years, 2 000
// tasks due on a date (half done), and 230 series from years ago (2019–2025):
// 30 daily (10 of them tasks) and 200 weekly, with EXDATEs and moved
// occurrences. Half are written as Nextcloud writes them (with a VTIMEZONE),
// half as Google does (a TZID with no VTIMEZONE); a third remind.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ALL_RIGHTS,
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

const TODAY = "2026-11-04";
const ZONE = "Europe/Vilnius";
/** Each measurement is taken this many times, each time on a range not read before. */
const RUNS = 5;

// A small seeded generator (mulberry32), so every run builds the same calendar.
let seed = 17;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
}
const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
const between = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));

const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Vilnius",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0300",
  "TZNAME:EEST",
  "DTSTART:19700329T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0200",
  "TZNAME:EET",
  "DTSTART:19701025T040000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const compact = (day: string) => day.replaceAll("-", "");
const at = (day: string, minutes: number) =>
  `${compact(day)}T${String(Math.floor(minutes / 60)).padStart(2, "0")}${String(minutes % 60).padStart(2, "0")}00`;
const zoned = (name: string, day: string, minutes: number) =>
  `${name};TZID=${ZONE}:${at(day, minutes)}`;
const ALARM = ["BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT10M", "END:VALARM"];

function vcalendar(components: string[], withZone: boolean): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AstroTime//bench//EN"];
  return [...lines, ...components, ...(withZone ? VTIMEZONE : []), "END:VCALENDAR", ""].join(
    "\r\n",
  );
}

function component(name: "VEVENT" | "VTODO", uid: string, lines: string[]): string {
  return [`BEGIN:${name}`, `UID:${uid}`, "DTSTAMP:20261001T000000Z", ...lines, `END:${name}`].join(
    "\r\n",
  );
}

const DAYS = ["MO", "TU", "WE", "TH", "FR"];

/** The calendar, as `[calendar index, iCalendar]`. */
function generate(): [number, string][] {
  const objects: [number, string][] = [];
  const first = "2024-11-04";
  for (let i = 0; i < 10_000; i++) {
    const day = addDays(first, between(0, 3 * 365));
    const start = between(8 * 4, 19 * 4) * 15;
    const lines = [
      zoned("DTSTART", day, start),
      zoned("DTEND", day, start + pick([30, 60, 90, 120])),
      `SUMMARY:Event ${i}`,
      ...(i % 5 === 0 ? ALARM : []),
    ];
    objects.push([i % 3, vcalendar([component("VEVENT", `event-${i}`, lines)], i % 2 === 0)]);
  }
  for (let i = 0; i < 2000; i++) {
    const due = addDays(first, between(0, 3 * 365));
    const done = i % 2 === 0 ? ["STATUS:COMPLETED", "COMPLETED:20261001T120000Z"] : [];
    const lines = [`DUE;VALUE=DATE:${compact(due)}`, `SUMMARY:Task ${i}`, ...done];
    objects.push([i % 3, vcalendar([component("VTODO", `task-${i}`, lines)], false)]);
  }
  for (let i = 0; i < 230; i++) {
    const daily = i < 30;
    const kind = daily && i < 10 ? "VTODO" : "VEVENT";
    const startDay = addDays("2019-01-07", between(0, 6 * 365));
    const start = between(8 * 4, 18 * 4) * 15;
    const withZone = i % 2 === 0;
    const uid = `series-${i}`;
    const byDay = [...new Set([pick(DAYS), pick(DAYS)])].join(",");
    const rule = daily
      ? "RRULE:FREQ=DAILY"
      : `RRULE:FREQ=WEEKLY;BYDAY=${byDay}${i % 4 === 0 ? ";INTERVAL=2" : ""}${i % 7 === 0 ? ";UNTIL=20271231T235959Z" : ""}`;
    const times =
      kind === "VTODO"
        ? [zoned("DTSTART", startDay, start), zoned("DUE", startDay, start + 30)]
        : [zoned("DTSTART", startDay, start), zoned("DTEND", startDay, start + 45)];
    const lines = [
      ...times,
      rule,
      `SUMMARY:Series ${i}`,
      ...(daily ? [zoned("EXDATE", addDays(startDay, 3), start)] : []),
      ...(i % 3 === 0 ? ALARM : []),
    ];
    const components = [component(kind, uid, lines)];
    if (!daily && i % 5 === 0) {
      // One occurrence, a year in, moved an hour later.
      const moved = addDays(startDay, 364);
      components.push(
        component(kind, uid, [
          zoned("RECURRENCE-ID", moved, start),
          zoned("DTSTART", moved, start + 60),
          zoned("DTEND", moved, start + 105),
          `SUMMARY:Series ${i} (moved)`,
        ]),
      );
    }
    objects.push([i % 3, vcalendar(components, withZone)]);
  }
  return objects;
}

async function populate(path: string): Promise<string[]> {
  const driver = nodeDriver(path);
  // A benchmark's file need not survive a power cut: no sync on every commit.
  await driver.script("PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;");
  const store = await Store.open(driver);
  const account = await store.addAccount({
    provider: "caldav",
    name: "Bench",
    serverUrl: "https://cloud.example.com/remote.php/dav/",
    username: "bench",
  });
  const ids: string[] = [];
  for (const name of ["Personal", "Work", "Family"]) {
    const calendar = await store.saveCalendar({
      accountId: account.id,
      url: `https://cloud.example.com/remote.php/dav/calendars/bench/${name.toLowerCase()}/`,
      name,
      color: "#0082c9",
      components: ["VEVENT", "VTODO"],
      rights: ALL_RIGHTS,
    });
    ids.push(calendar.id);
  }
  for (const [index, [calendar, ics]] of generate().entries()) {
    await store.saveFromServer(ids[calendar]!, { href: `${index}.ics`, etag: null, ics });
  }
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
