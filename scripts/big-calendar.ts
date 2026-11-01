// The big calendar of docs/plans/foundation.md#D118, generated the same on
// every run: read by `bench-big-calendar.ts` in Node, and by
// `bench-cold-start.ts` in the browser, where it fills the web store.
//
// Today is Wednesday 4 November 2026 in Europe/Vilnius. The calendar holds
// 12 230 objects in 3 calendars: 10 000 timed events over three years, 2 000
// tasks due on a date (half done), and 230 series from years ago (2019–2025):
// 30 daily (10 of them tasks) and 200 weekly, with EXDATEs and moved
// occurrences. Half are written as Nextcloud writes them (with a VTIMEZONE),
// half as Google does (a TZID with no VTIMEZONE); a third remind.
import { ALL_RIGHTS } from "../packages/core/src/index.ts";
import type { Store } from "../packages/storage/src/index.ts";
import { addDays } from "../packages/ui/src/calendar/dates.ts";

export const TODAY = "2026-11-04";
export const ZONE = "Europe/Vilnius";

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
export function generate(): [number, string][] {
  seed = 17;
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

/** Fills `store` with the calendar: one account, its three calendars; their ids. */
export async function fill(store: Store): Promise<string[]> {
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
  return ids;
}
