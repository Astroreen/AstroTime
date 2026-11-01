// A series is walked from near the range (docs/plans/foundation.md#D118).
// The proof is by generated series: for each, the starts walked from near a
// day far from DTSTART are ical.js's own starts walked from DTSTART, and the
// occurrences placed in a range are those of the walk from the first one.
import ICAL from "ical.js";
import { describe, expect, test, vi } from "vite-plus/test";

import {
  boundsOf,
  CalendarObject,
  ExpansionLimitError,
  isUndoneBefore,
  latestUndoneBefore,
  occurrencesBetween,
  remindersOf,
  wallClockOf,
  type Occurrence,
  type Range,
} from "../src/index.ts";
import {
  bounded,
  cycleTries,
  iteratorOf,
  seriesStarts,
  startNear,
  triesFor,
} from "../src/recurrence.ts";
import { vtimezone } from "../src/vtimezone.ts";

/** A seeded generator (mulberry32): every run tests the same series. */
function generator(seed: number) {
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (low: number, high: number) => low + Math.floor(random() * (high - low + 1));
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const chance = (p: number) => random() < p;
  const some = <T>(list: readonly T[], most: number): T[] => {
    const chosen = new Set<T>();
    const count = int(1, most);
    while (chosen.size < count) chosen.add(pick(list));
    return [...chosen];
  };
  return { int, pick, chance, some };
}
type Generator = ReturnType<typeof generator>;

const DAY_MS = 86_400_000;
const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

type Form = "vtimezone" | "tzid" | "utc" | "floating" | "date";
/** Zones with and without DST, north and south; a VTIMEZONE is made for them from `Intl`. */
const ZONES = ["Europe/Vilnius", "America/New_York", "Australia/Sydney", "Asia/Kolkata"];
const VTIMEZONES = new Map(ZONES.map((zone) => [zone, vtimezone(zone, 2013).toString()]));
const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** A time in one of the forms clients write, as `NAME;params:value`. */
function written(name: string, form: Form, zone: string, day: string, time: string): string {
  const date = day.replaceAll("-", "");
  switch (form) {
    case "date":
      return `${name};VALUE=DATE:${date}`;
    case "utc":
      return `${name}:${date}T${time}Z`;
    case "floating":
      return `${name}:${date}T${time}`;
    default:
      return `${name};TZID=${zone}:${date}T${time}`;
  }
}

interface Series {
  readonly form: Form;
  readonly zone: string;
  /** DTSTART's day and time on its own wall clock. */
  readonly day: string;
  readonly time: string;
  readonly lines: readonly string[];
}

/** A rule of the kinds clients write, and some they do not. */
function ruleOf(g: Generator, freq: string, form: Form, until: () => string): string {
  const parts = [`FREQ=${freq}`];
  if (g.chance(0.5)) parts.push(`INTERVAL=${g.pick([2, 3, 4, 7])}`);
  const plain = () => g.some(WEEKDAYS, 3).join(",");
  const ordinals = () =>
    g
      .some(WEEKDAYS, 2)
      .map((day) => `${g.pick(["", "1", "2", "3", "4", "5", "-1", "-2"])}${day}`)
      .join(",");
  const monthDays = () => g.some([1, 2, 5, 13, 15, 28, 29, 30, 31, -1, -2, -7], 3).join(",");
  const months = () => g.some([1, 2, 3, 4, 6, 9, 10, 11, 12], 3).join(",");
  const setPos = () => g.some([1, 2, -1, -2], 2).join(",");
  switch (freq) {
    case "DAILY":
      if (g.chance(0.3)) parts.push(`BYDAY=${plain()}`);
      // Rules that never meet too, which ical.js would search for ever
      // (31 April, a day from the month's end, a weekday 7 days never land on).
      if (g.chance(0.15)) parts.push(`BYMONTHDAY=${monthDays()}`);
      if (g.chance(0.05)) parts.push(`BYMONTH=${months()}`);
      break;
    case "WEEKLY":
      if (g.chance(0.7)) parts.push(`BYDAY=${plain()}`);
      if (g.chance(0.3)) parts.push(`WKST=${g.pick(["MO", "SU", "WE"])}`);
      break;
    case "MONTHLY":
      switch (g.int(0, 4)) {
        case 1:
          parts.push(`BYMONTHDAY=${monthDays()}`);
          break;
        case 2:
          parts.push(`BYDAY=${ordinals()}`);
          break;
        case 3:
          parts.push(`BYDAY=${plain()}`, `BYSETPOS=${setPos()}`);
          break;
        case 4:
          parts.push(`BYDAY=${g.pick(WEEKDAYS)}`, `BYMONTHDAY=${g.pick([13, 1, -1])}`);
          break;
      }
      break;
    case "YEARLY":
      switch (g.int(0, 5)) {
        case 1:
          parts.push(`BYMONTH=${months()}`);
          break;
        case 2:
          parts.push(`BYMONTH=${months()}`, `BYMONTHDAY=${monthDays()}`);
          break;
        case 3:
          parts.push(`BYMONTH=${months()}`, `BYDAY=${ordinals()}`);
          break;
        case 4:
          parts.push(`BYMONTH=${g.pick([3, 10, 11])}`, `BYDAY=${plain()}`, `BYSETPOS=${setPos()}`);
          break;
        case 5:
          parts.push(`BYMONTHDAY=${monthDays()}`);
          break;
      }
      break;
  }
  if (form !== "date" && freq !== "HOURLY" && g.chance(0.2)) {
    const hours = g.some([0, 6, 8, 9, 12, 17, 21, 23], 3);
    parts.push(`BYHOUR=${(g.chance(0.8) ? hours.toSorted((a, b) => a - b) : hours).join(",")}`);
    if (g.chance(0.3)) parts.push("BYMINUTE=0,30");
  }
  if (g.chance(0.3)) parts.push(`UNTIL=${until()}`);
  else if (g.chance(0.1)) parts.push(`COUNT=${g.int(1, 400)}`);
  return `RRULE:${parts.join(";")}`;
}

const FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;

function seriesOf(g: Generator, freq: string = g.pick(FREQUENCIES)): Series {
  const form = g.pick<Form>(["vtimezone", "vtimezone", "tzid", "tzid", "utc", "floating", "date"]);
  const zone = g.pick(ZONES);
  const year = g.int(2014, 2021);
  const month = g.int(1, 12);
  // Ends of months and 29 February often: where whole months and years are hardest.
  const day = g.chance(0.4) ? daysIn(year, month) - g.int(0, 3) : g.int(1, daysIn(year, month));
  const start = `${year}-${pad(month)}-${pad(day)}`;
  // DST changes happen at 02:00–03:00 in these zones: those hours often.
  const time = `${pad(g.pick([0, 2, 3, 8, 9, 12, 18, 23]))}${pad(g.pick([0, 30]))}00`;
  const until = () => {
    const at = addDays(start, g.int(30, 9 * 365)).replaceAll("-", "");
    if (form === "date") return at;
    return form === "floating" ? `${at}T${time}` : `${at}T${time}Z`;
  };
  const rules = [ruleOf(g, freq, form, until)];
  // Two rules, rarely (RFC 5545 deprecates it).
  if (g.chance(0.03)) rules.push(ruleOf(g, g.pick(["DAILY", "WEEKLY", "MONTHLY"]), form, until));
  const length = g.pick([0, 30, 90, 24 * 60, 3 * 24 * 60]);
  const end =
    form === "date"
      ? written("DTEND", form, zone, addDays(start, Math.max(1, Math.round(length / 1440))), time)
      : length === 0
        ? null
        : g.chance(0.5)
          ? `DURATION:PT${length}M`
          : written(
              "DTEND",
              form,
              zone,
              addDays(start, Math.floor(length / 1440)),
              `${pad((Number(time.slice(0, 2)) + Math.floor((length % 1440) / 60)) % 24)}${time.slice(2)}`,
            );
  const rdates = g.chance(0.15)
    ? [written("RDATE", form, zone, addDays(start, g.pick([-40, 3, 400, 1500, 2500])), time)]
    : [];
  return {
    form,
    zone,
    day: start,
    time,
    lines: [
      written("DTSTART", form, zone, start, time),
      ...(end ? [end] : []),
      ...rules,
      ...rdates,
    ],
  };
}

function ics(series: Series, components: readonly (readonly string[])[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AstroTime//test//EN",
    ...components.flatMap((lines) => [
      "BEGIN:VEVENT",
      "UID:series",
      "DTSTAMP:20261001T000000Z",
      ...lines,
      "END:VEVENT",
    ]),
    ...(series.form === "vtimezone" ? [VTIMEZONES.get(series.zone)!.trim()] : []),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

const dayOf = (time: ICAL.Time) => `${time.year}-${pad(time.month)}-${pad(time.day)}`;
const shown = (time: ICAL.Time) => `${time.toString()} ${time.zone?.tzid ?? ""}`;

/** The starts on the days from `from` until `to`, from a `next()`; or what it threw. */
function startsOn(next: () => ICAL.Time | null, from: string, to: string): string[] | string {
  const found: string[] = [];
  try {
    for (let step = 0; step < 400_000; step++) {
      const time = next();
      if (!time) return found;
      const day = dayOf(time);
      if (day >= to) return found;
      if (day >= from) found.push(shown(time));
    }
    return "walked too far";
  } catch (error) {
    return String(error);
  }
}

/**
 * ical.js's own walk from DTSTART, the oracle: its `RecurExpansion`, each
 * rule made and searched bounded as AstroTime bounds them, one it refuses its
 * DTSTART alone. In a sweep it searches every rule at one time of the day
 * its whole cycle, so AstroTime's `neverMeets` is checked against ical.js too.
 */
function icalStartsOn(master: ICAL.Component, dtstart: ICAL.Time, from: string, to: string) {
  const original = ICAL.Recur.prototype.iterator;
  const patched = function (this: ICAL.Recur, start: ICAL.Time) {
    ICAL.Recur.prototype.iterator = original;
    try {
      const iterator = iteratorOf(this, start);
      return iterator
        ? bounded(iterator, SWEEP && once(this) ? cycleTries(this) : triesFor(this, start))
        : stub(start, 0);
    } catch {
      return stub(start, 1);
    } finally {
      ICAL.Recur.prototype.iterator = patched;
    }
  };
  ICAL.Recur.prototype.iterator = patched;
  try {
    const expansion = new ICAL.RecurExpansion({ component: master, dtstart });
    return startsOn(() => expansion.next() ?? null, from, to);
  } catch (error) {
    return String(error);
  } finally {
    ICAL.Recur.prototype.iterator = original;
  }
}

/**
 * Whether a rule names one time of the day. `neverMeets` knows days only, so
 * a sweep checks it on these: searching the whole cycle of a rule at six
 * times a day takes ical.js 15 s.
 */
const once = (rule: ICAL.Recur) =>
  [rule.parts.BYHOUR, rule.parts.BYMINUTE, rule.parts.BYSECOND].every(
    (values) => !values || values.length <= 1,
  );

/** An iterator giving `start` `times` times (0 or 1), as AstroTime takes a rule it cannot walk. */
function stub(start: ICAL.Time, times: number): ICAL.RecurIterator {
  let calls = 0;
  const iterator = {
    completed: times === 0,
    last: start.clone(),
    next() {
      iterator.completed = ++calls > times;
      return iterator.completed ? null : iterator.last;
    },
  };
  return iterator as unknown as ICAL.RecurIterator;
}

function walkFrom(master: ICAL.Component, dtstart: ICAL.Time, from: string | null) {
  try {
    return seriesStarts(master, dtstart, from);
  } catch (error) {
    return () => {
      throw error;
    };
  }
}

/**
 * The series each run tests, in chunks of about half a second here, so none
 * comes near Vitest's 5 s on a slower runner. Seeded: every run tests the
 * same ones. `node scripts/sweep-recurrence.ts <seed>…` runs ten times as
 * many series for other seeds, by hand (`SEED`, `SCALE`), in chunks a tenth
 * as big: its oracle searches a rule that never meets for its whole cycle.
 */
const SEED = Number(process.env["ASTROTIME_RECURRENCE_SEED"] ?? "118");
const SCALE = Number(process.env["ASTROTIME_RECURRENCE_SCALE"] ?? "1");
/** Chunks per frequency, and series in each: a daily one walks furthest for the oracle. */
const CHUNKS = { DAILY: [3, 70], WEEKLY: [3, 220], MONTHLY: [3, 160], YEARLY: [1, 800] } as const;
const SWEEP = SCALE > 1;
const chunks = (count: number) =>
  Array.from({ length: count * SCALE * (SWEEP ? 10 : 1) }, (_, chunk) => chunk);
/** Series in one chunk: a tenth as many in a sweep. */
const each = (cases: number) => (SWEEP ? Math.ceil(cases / 10) : cases);
const seedOf = (chunk: number, salt: number) => SEED * 10_000 + salt * 100 + chunk;

describe("a series walked from near the range (D118)", () => {
  describe.each(FREQUENCIES)(
    "the starts walked from near a day are ical.js's own from DTSTART: %s",
    (freq) => {
      const [count, cases] = CHUNKS[freq];
      test.each(chunks(count))("chunk %i", (chunk) => {
        const g = generator(seedOf(chunk, freq.length));
        let jumped = 0;
        for (let i = 0; i < each(cases); i++) {
          const series = seriesOf(g, freq);
          const object = CalendarObject.parse(ics(series, [series.lines]));
          const master = object.components.master!;
          const dtstart = master.getFirstPropertyValue("dtstart") as ICAL.Time;
          // Mostly far from the start, sometimes near it.
          const from = addDays(series.day, g.chance(0.1) ? g.int(-5, 60) : g.int(200, 7 * 365));
          const to = addDays(from, g.pick([1, 7, 42, 84, 400]));
          const rules = master
            .getAllProperties("rrule")
            .map((p) => p.getFirstValue() as ICAL.Recur);
          if (rules.some((rule) => startNear(rule, dtstart, from))) jumped++;
          // Two rules against AstroTime's own walk from DTSTART: ical.js's
          // merge stops both when one ends (a rule refused, or out of tries).
          const oracle =
            rules.length > 1
              ? startsOn(walkFrom(master, dtstart, null), from, to)
              : icalStartsOn(master, dtstart, from, to);
          expect(
            startsOn(walkFrom(master, dtstart, from), from, to),
            `${series.lines.join(" ")} from ${from}`,
          ).toEqual(oracle);
        }
        // Many generated rules start near the day: the test is not of the walk alone.
        if (!SWEEP) expect(jumped).toBeGreaterThan(cases / 4);
      });
    },
  );

  test("an hourly, a counted and a BYMONTH-stepped rule walk from DTSTART", () => {
    const dtstart = ICAL.Time.fromDateTimeString("2020-01-06T09:00:00");
    const near = (rule: string) => startNear(ICAL.Recur.fromString(rule), dtstart, "2026-11-01");
    expect(near("FREQ=HOURLY")).toBeNull();
    expect(near("FREQ=DAILY;COUNT=5000")).toBeNull();
    expect(near("FREQ=DAILY;BYMONTH=1,6")).toBeNull();
    expect(near("FREQ=DAILY;BYHOUR=17,9")).toBeNull();
    // A daily rule moves whole intervals, a month or more before the day.
    expect(near("FREQ=DAILY;INTERVAL=3")?.toString()).toBe("2026-10-01T09:00:00");
    // A monthly one on the 31st moves only to a month that has one: not November.
    const last = ICAL.Time.fromDateTimeString("2020-01-31T09:00:00");
    expect(startNear(ICAL.Recur.fromString("FREQ=MONTHLY"), last, "2026-12-01")?.toString()).toBe(
      "2026-10-31T09:00:00",
    );
  });

  test.each(chunks(4))(
    "occurrences in a range are those of the walk from the first one, EXDATEs and exceptions too: chunk %i",
    (chunk) => {
      const g = generator(seedOf(chunk, 33));
      const zones = ["Europe/Vilnius", "America/Los_Angeles", "Pacific/Kiritimati", "UTC"];
      for (let i = 0; i < each(60); i++) {
        const series = seriesOf(g);
        const plain = CalendarObject.parse(ics(series, [series.lines]));
        const master = plain.components.master!;
        const dtstart = master.getFirstPropertyValue("dtstart") as ICAL.Time;
        const from = addDays(series.day, g.int(200, 4 * 365));
        const range: Range = {
          from,
          to: addDays(from, g.pick([1, 7, 42])),
          timeZone: g.pick(zones),
        };
        // Occurrences near the range, excluded or replaced; and an EXDATE naming none.
        const near = icalStartsOn(master, dtstart, addDays(from, -2), range.to);
        const times = Array.isArray(near) ? near : [];
        const at = (index: number) => {
          const [day, time] = times[index]!.split(" ")[0]!.replace("Z", "").split("T");
          return { day: day!, time: (time ?? "00:00:00").replaceAll(":", "") };
        };
        const extra: string[] = [];
        const exceptions: string[][] = [];
        if (times.length > 0 && g.chance(0.5)) {
          const { day, time } = at(g.int(0, times.length - 1));
          // An EXDATE as a date on a timed series matches by day (D35).
          const form = g.chance(0.2) ? "date" : series.form;
          extra.push(written("EXDATE", form, series.zone, day, time));
        }
        if (g.chance(0.3)) {
          extra.push(written("EXDATE", series.form, series.zone, addDays(from, 1), "013000"));
        }
        if (times.length > 0 && g.chance(0.5)) {
          const { day, time } = at(g.int(0, times.length - 1));
          const moved = `${pad((Number(time.slice(0, 2)) + 2) % 24)}${time.slice(2)}`;
          exceptions.push([
            written("RECURRENCE-ID", series.form, series.zone, day, time),
            written("DTSTART", series.form, series.zone, day, moved),
            ...(g.chance(0.3) ? ["STATUS:CANCELLED"] : []),
            "SUMMARY:Moved",
          ]);
        }
        const object = CalendarObject.parse(
          ics(series, [[...series.lines, ...extra, "SUMMARY:Series"], ...exceptions]),
        );
        const walked = attempt(() =>
          occurrencesBetween(object, { ...range, from: addDays(series.day, -45) }).filter(
            (occurrence) => touches(occurrence, range),
          ),
        );
        expect(
          attempt(() => occurrencesBetween(object, range)),
          `${series.lines.join(" ")} in ${from}`,
        ).toEqual(walked);
      }
    },
  );

  test("a dense series from decades ago reaches the range; one that must walk is still refused", () => {
    const object = (rule: string) =>
      CalendarObject.parse(
        `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:d\r\nDTSTART;TZID=Europe/Berlin:19900101T080000\r\nDURATION:PT30M\r\n${rule}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
      );
    const range: Range = { from: "2026-11-02", to: "2026-11-03", timeZone: "Europe/Vilnius" };
    // Four times a day for 37 years: past the steps a walk from 1990 may take.
    const starts = occurrencesBetween(object("RRULE:FREQ=DAILY;BYHOUR=8,12,16,20"), range).map(
      (o) => wallClockOf(o.start, "Europe/Berlin"),
    );
    expect(starts).toEqual([
      "2026-11-02T08:00:00",
      "2026-11-02T12:00:00",
      "2026-11-02T16:00:00",
      "2026-11-02T20:00:00",
    ]);
    expect(() => occurrencesBetween(object("RRULE:FREQ=HOURLY;INTERVAL=4"), range)).toThrow(
      ExpansionLimitError,
    );
  });
});

/** What `work` returns, or what it threw. */
function attempt<T>(work: () => T): T | string {
  try {
    return work();
  } catch (error) {
    return String(error);
  }
}

/** Whether an occurrence touches a range, as `occurrencesBetween` decides it. */
function touches(occurrence: Occurrence, range: Range): boolean {
  const from = `${range.from}T00:00:00`;
  const to = `${range.to}T00:00:00`;
  const s = wallClockOf(occurrence.start, range.timeZone);
  const e = wallClockOf(occurrence.end, range.timeZone);
  return s < to && (e === s ? s >= from : e > from);
}

describe("a rule ical.js never meets (D118)", () => {
  const object = (rule: string, kind = "VEVENT") =>
    CalendarObject.parse(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        `BEGIN:${kind}`,
        "UID:never",
        "DTSTAMP:20261001T000000Z",
        // A Monday.
        "DTSTART;TZID=Europe/Vilnius:20261005T090000",
        kind === "VEVENT" ? "DURATION:PT1H" : "DUE;TZID=Europe/Vilnius:20261005T100000",
        rule,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:-PT10M",
        "END:VALARM",
        `END:${kind}`,
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  const vilnius = (from: string, to: string): Range => ({ from, to, timeZone: "Europe/Vilnius" });
  const NEVER = [
    "RRULE:FREQ=DAILY;BYMONTHDAY=31;BYMONTH=4,11",
    "RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30",
    "RRULE:FREQ=DAILY;BYMONTHDAY=-1",
    "RRULE:FREQ=DAILY;INTERVAL=7;BYDAY=TU",
    "RRULE:FREQ=HOURLY;BYMONTHDAY=31;BYMONTH=4",
    "RRULE:FREQ=MINUTELY;BYMONTH=2;BYMONTHDAY=30",
  ];

  // Each of these used to spin inside one step of ical.js's iterator, so
  // the view, the chip, the reminders and the store's write never returned.
  test.each(NEVER)("%s is its DTSTART alone, wherever it is read", (rule) => {
    const starts = (range: Range) =>
      occurrencesBetween(object(rule), range).map((o) => wallClockOf(o.start, range.timeZone));
    // RFC 5545: DTSTART is the first occurrence, whether the rule names it or not.
    expect(starts(vilnius("2026-10-01", "2026-11-01"))).toEqual(["2026-10-05T09:00:00"]);
    expect(starts(vilnius("2029-03-01", "2029-04-01"))).toEqual([]);
    expect(remindersOf(object(rule), "never", vilnius("2026-11-01", "2026-11-10"))).toEqual([]);
    expect(
      latestUndoneBefore(object(rule, "VTODO"), "2026-11-04", "Europe/Vilnius")?.start,
    ).toEqual(object(rule, "VTODO").master?.start);
    expect(boundsOf(object(`${rule};UNTIL=20271231T000000Z`)).endMs).toBe(
      Date.parse("2026-10-05T07:00:00Z"),
    );
  });

  // `neverMeets` says so without walking; ical.js searching each for the
  // whole 400-year cycle (`cycleTries`) agrees.
  test.each(NEVER)("ical.js searching %s for 400 years finds nothing, as triesFor says", (rule) => {
    const recur = ICAL.Recur.fromString(rule.slice("RRULE:".length));
    const dtstart = ICAL.Time.fromDateTimeString("2026-10-05T09:00:00");
    expect(triesFor(recur, dtstart)).toBe(0);
    const iterator = bounded(iteratorOf(recur, dtstart)!, cycleTries(recur));
    expect(iterator.next()?.toString()).toBe("2026-10-05T09:00:00");
    expect(iterator.next()).toBeNull();
  });

  // Not known without walking: the search runs its whole cycle, about 0.6 s.
  test("a daily rule naming a week February never has is its DTSTART alone", () => {
    expect(
      occurrencesBetween(
        object("RRULE:FREQ=DAILY;BYWEEKNO=53;BYMONTH=2"),
        vilnius("2026-10-01", "2026-11-01"),
      ).map((o) => wallClockOf(o.start, "Europe/Vilnius")),
    ).toEqual(["2026-10-05T09:00:00"]);
  });

  // ical.js tries every day of a daily rule, BYMONTH's months or not: 14 301
  // from 2073 to 2112, the year 2100 not leap.
  test("a rule that meets rarely still meets: the 29th of February on a Monday", () => {
    const sparse = CalendarObject.parse(
      object("RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=29;BYDAY=MO")
        .serialize()
        .replaceAll("20261005", "20730102"),
    );
    const starts = occurrencesBetween(sparse, vilnius("2073-01-01", "2169-01-01")).map((o) =>
      wallClockOf(o.start, "Europe/Vilnius"),
    );
    expect(starts).toEqual([
      "2073-01-02T09:00:00",
      "2112-02-29T09:00:00",
      "2140-02-29T09:00:00",
      "2168-02-29T09:00:00",
    ]);
  });

  // ical.js steps a daily rule's days one at a time: an INTERVAL past 400
  // years never ended its first step, and one of 7 days took 7 a candidate.
  test("a daily rule's interval is walked by days, bounded by 400 years of them", () => {
    for (const rule of [
      "RRULE:FREQ=DAILY;INTERVAL=999999999;BYHOUR=8",
      "RRULE:FREQ=DAILY;INTERVAL=7;BYWEEKNO=53;BYMONTH=2",
      "RRULE:FREQ=HOURLY;INTERVAL=999999999",
    ]) {
      expect(occurrencesBetween(object(rule), vilnius("2026-10-01", "2027-11-01"))).toHaveLength(
        rule.includes("BYHOUR=8") ? 0 : 1,
      );
    }
  });

  // ical.js's constructor looks for a month with a fifth Monday in a loop of
  // its own: every other year's February, from an odd year, has 28 days.
  test("a rule whose first occurrence ical.js would look for for ever has none", () => {
    const never = CalendarObject.parse(
      object("RRULE:FREQ=MONTHLY;INTERVAL=24;BYDAY=5MO")
        .serialize()
        .replaceAll("20261005", "20230201"),
    );
    expect(occurrencesBetween(never, vilnius("2023-01-01", "2027-01-01"))).toEqual([]);
    expect(
      occurrencesBetween(object("RRULE:FREQ=YEARLY;BYMONTH=2;BYDAY=5MO;BYMONTHDAY=30"), {
        ...vilnius("2026-10-01", "2026-11-01"),
      }).length,
    ).toBeLessThanOrEqual(1);
  });
});

describe("EXDATE, matched as a RECURRENCE-ID is (D35, D118)", () => {
  const series = (start: string, exdate: string) =>
    CalendarObject.parse(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "BEGIN:VEVENT",
        "UID:exdate",
        "DTSTAMP:20261001T000000Z",
        start,
        "RRULE:FREQ=DAILY;COUNT=3",
        exdate,
        "END:VEVENT",
        VTIMEZONES.get("Europe/Vilnius")!.trim(),
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  const days = (object: CalendarObject) =>
    occurrencesBetween(object, {
      from: "2026-11-01",
      to: "2026-11-10",
      timeZone: "Europe/Vilnius",
    }).map((o) => wallClockOf(o.start, "Europe/Vilnius").slice(0, 10));
  /** ical.js's own expansion, its EXDATE handling, for the days it gives. */
  const icalDays = (object: CalendarObject) => {
    const master = object.components.master!;
    const expansion = new ICAL.RecurExpansion({
      component: master,
      dtstart: master.getFirstPropertyValue("dtstart") as ICAL.Time,
    });
    const found: string[] = [];
    for (let next = expansion.next(); next; next = expansion.next()) found.push(dayOf(next));
    return found;
  };

  test("a date on a timed series removes that day's occurrence, as ical.js does", () => {
    const object = series(
      "DTSTART;TZID=Europe/Vilnius:20261102T090000",
      "EXDATE;VALUE=DATE:20261103",
    );
    expect(days(object)).toEqual(["2026-11-02", "2026-11-04"]);
    expect(icalDays(object)).toEqual(["2026-11-02", "2026-11-04"]);
  });

  test("a date removes every occurrence of its day (ical.js only the first)", () => {
    const object = CalendarObject.parse(
      series("DTSTART;TZID=Europe/Vilnius:20261102T090000", "EXDATE;VALUE=DATE:20261103")
        .serialize()
        .replace("COUNT=3", "COUNT=6;BYHOUR=9,17"),
    );
    expect(days(object)).toEqual(["2026-11-02", "2026-11-02", "2026-11-04", "2026-11-04"]);
    expect(icalDays(object)).toEqual([
      "2026-11-02",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-04",
    ]);
  });

  test("a time on an all-day series, or a floating one on a zoned series, removes that day's or wall clock's (ical.js does not)", () => {
    const allDay = series(
      "DTSTART;VALUE=DATE:20261102",
      "EXDATE;TZID=Europe/Vilnius:20261103T000000",
    );
    expect(days(allDay)).toEqual(["2026-11-02", "2026-11-04"]);
    expect(icalDays(allDay)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    const floating = series(
      "DTSTART;TZID=Europe/Vilnius:20261102T090000",
      "EXDATE:20261103T090000",
    );
    expect(days(floating)).toEqual(["2026-11-02", "2026-11-04"]);
    expect(icalDays(floating)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
  });
});

describe("a rule ical.js refuses (D118)", () => {
  const object = (rule: string, kind = "VEVENT") =>
    CalendarObject.parse(
      [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        `BEGIN:${kind}`,
        `UID:refused-${kind}`,
        "DTSTAMP:20261001T000000Z",
        "DTSTART;TZID=Europe/Vilnius:20261005T090000",
        kind === "VEVENT" ? "DURATION:PT1H" : "DUE;TZID=Europe/Vilnius:20261005T100000",
        rule,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:-PT10M",
        "END:VALARM",
        `END:${kind}`,
        "END:VCALENDAR",
        "",
      ].join("\r\n"),
    );
  const vilnius = (from: string, to: string): Range => ({ from, to, timeZone: "Europe/Vilnius" });

  // ical.js throws making the iterator: `Malformed values in BYDAY part`, and
  // `For WEEKLY recurrences neither BYMONTHDAY nor BYYEARDAY may appear`.
  test.each(["RRULE:FREQ=MONTHLY;BYDAY=6MO", "RRULE:FREQ=WEEKLY;BYMONTHDAY=1"])(
    "%s is its DTSTART alone, said once per object and version",
    (rule) => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const event = object(rule);
        const starts = (range: Range) =>
          occurrencesBetween(event, range).map((o) => wallClockOf(o.start, "Europe/Vilnius"));
        expect(starts(vilnius("2026-10-01", "2026-11-01"))).toEqual(["2026-10-05T09:00:00"]);
        expect(starts(vilnius("2026-11-01", "2026-12-01"))).toEqual([]);
        expect(remindersOf(event, "refused", vilnius("2026-10-05", "2026-10-06"))).toHaveLength(1);
        expect(boundsOf(object(`${rule};UNTIL=20271231T000000Z`)).endMs).toBe(
          Date.parse("2026-10-05T07:00:00Z"),
        );
        // The same object parsed again is the same version: said once.
        occurrencesBetween(object(rule), vilnius("2026-10-01", "2026-11-01"));
        const task = object(rule, "VTODO");
        expect(latestUndoneBefore(task, "2026-11-04", "Europe/Vilnius")?.start).toEqual(
          task.master?.start,
        );
        // The event, its version with an UNTIL, and the task.
        expect(logged).toHaveBeenCalledTimes(3);
        expect(String(logged.mock.calls[0]?.[0])).toContain("refused-VEVENT");
      } finally {
        logged.mockRestore();
      }
    },
  );
});

test("an EXDATE after one naming no occurrence still removes its own (ical.js skipped it)", () => {
  const object = CalendarObject.parse(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:x",
      "DTSTART;TZID=Europe/Vilnius:20261102T090000",
      "DURATION:PT1H",
      "RRULE:FREQ=WEEKLY",
      // The first names no occurrence (the series moved from 08:00); the second does.
      "EXDATE;TZID=Europe/Vilnius:20261109T080000,20261116T090000",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
  const starts = occurrencesBetween(object, {
    from: "2026-11-01",
    to: "2026-11-30",
    timeZone: "Europe/Vilnius",
  }).map((o) => wallClockOf(o.start, "Europe/Vilnius"));
  expect(starts).toEqual(["2026-11-02T09:00:00", "2026-11-09T09:00:00", "2026-11-23T09:00:00"]);
});

test.each(chunks(3))(
  "the latest undone occurrence, read back from today, is the one a walk from the first finds: chunk %i",
  (chunk) => {
    const g = generator(seedOf(chunk, 51));
    /** `latestUndoneBefore` as it was: every occurrence from the first. */
    const walked = (object: CalendarObject, day: string, timeZone: string) => {
      const dueOf = (o: Occurrence) => wallClockOf(o.end, timeZone);
      return occurrencesBetween(object, { from: "0001-01-01", to: day, timeZone })
        .filter((o) => isUndoneBefore(object, o, day, timeZone))
        .reduce<Occurrence | null>((a, o) => (!a || dueOf(o) > dueOf(a) ? o : a), null);
    };
    for (let i = 0; i < each(80); i++) {
      const form = g.pick<Form>(["vtimezone", "tzid", "utc", "date"]);
      const zone = g.pick(ZONES);
      const start = addDays("2023-01-01", g.int(0, 900));
      const time = `${pad(g.int(6, 20))}0000`;
      const freq = g.pick(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);
      const rule = `RRULE:FREQ=${freq}${g.chance(0.3) ? `;INTERVAL=${g.int(2, 5)}` : ""}${g.chance(0.2) ? `;UNTIL=${addDays(start, g.int(10, 900)).replaceAll("-", "")}${form === "date" ? "" : "T000000Z"}` : ""}`;
      const day = addDays(start, g.int(-10, 1400));
      const series: Series = { form, zone, day: start, time, lines: [] };
      const times = g.pick(["start and due", "due", "start"]);
      const dueAfter = g.int(0, 2);
      /** A task's times on `on`, the due `dueAfter` days on. */
      const timesOn = (on: string) => [
        ...(times !== "due" ? [written("DTSTART", form, zone, on, time)] : []),
        ...(times !== "start" ? [written("DUE", form, zone, addDays(on, dueAfter), time)] : []),
      ];
      const lines = [...timesOn(start), rule, "SUMMARY:Water the plants"];
      // Some of the latest occurrences replaced: done, moved (and undone), or
      // changed and still undone.
      const master = CalendarObject.parse(ics(series, [lines]).replaceAll("VEVENT", "VTODO"));
      const before = occurrencesBetween(master, {
        from: addDays(day, -400),
        to: day,
        timeZone: "Europe/Vilnius",
      });
      const exceptions = before
        .slice(-g.int(0, 5))
        .filter(() => g.chance(0.7))
        .map((o) => {
          const id = o.recurrenceId!;
          const value = id.type === "date" ? id.date : id.local;
          const [d, t] = value.split("T");
          // The day the occurrence starts on (its due day for a task with a due alone).
          const on = times === "due" ? addDays(d!, -dueAfter) : d!;
          const exception = [
            written("RECURRENCE-ID", form, zone, d!, (t ?? "000000").replaceAll(":", "")),
          ];
          switch (g.pick(["done", "moved", "undone"])) {
            case "done":
              exception.push(...timesOn(on), "STATUS:COMPLETED");
              break;
            case "moved":
              exception.push(...timesOn(addDays(on, g.pick([-500, -40, -3, 1, 5, 40]))));
              break;
            default:
              exception.push(...timesOn(on), "SUMMARY:Water the plants, the big pot too");
          }
          return exception;
        });
      const text = ics(series, [lines, ...exceptions]).replaceAll("VEVENT", "VTODO");
      const object = CalendarObject.parse(text);
      const timeZone = g.pick(["Europe/Vilnius", "America/Los_Angeles", "Pacific/Kiritimati"]);
      expect(latestUndoneBefore(object, day, timeZone), `${text} before ${day}`).toEqual(
        walked(object, day, timeZone),
      );
    }
  },
);
