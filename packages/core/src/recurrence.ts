// Where a series' occurrences are walked from (docs/plans/foundation.md#D118):
// a rule whose occurrences repeat with its period starts near the range,
// whole periods of the rule after DTSTART, instead of at DTSTART.
import ICAL from "ical.js";

/**
 * The parts with which ical.js's iterator settles into the rule's period:
 * started anywhere on the lattice of whole periods from DTSTART, it gives the
 * same occurrences once it has settled (`startNear`). Others (BYMONTH outside
 * YEARLY, which ical.js steps through without the interval; BYWEEKNO,
 * BYYEARDAY), COUNT and HOURLY or finer walk from DTSTART.
 */
const SETTLING_PARTS: Readonly<Record<string, readonly string[]>> = {
  DAILY: ["BYSECOND", "BYMINUTE", "BYHOUR", "BYDAY", "BYMONTHDAY"],
  WEEKLY: ["BYSECOND", "BYMINUTE", "BYHOUR", "BYDAY"],
  MONTHLY: ["BYSECOND", "BYMINUTE", "BYHOUR", "BYDAY", "BYMONTHDAY", "BYSETPOS"],
  YEARLY: ["BYSECOND", "BYMINUTE", "BYHOUR", "BYDAY", "BYMONTHDAY", "BYMONTH", "BYSETPOS"],
};

/** Whether ical.js's iterator settles for this rule (`SETTLING_PARTS`). */
function settles(rule: ICAL.Recur): boolean {
  const allowed = SETTLING_PARTS[rule.freq];
  if (!allowed || rule.count) return false;
  for (const [part, values] of Object.entries(rule.parts)) {
    if (!allowed.includes(part) || !Array.isArray(values)) return false;
    if (part === "BYSECOND" || part === "BYMINUTE" || part === "BYHOUR") {
      // Times of the day in the order they come: ical.js steps through them as written.
      const ascending = values.every(
        (v, i) => typeof v === "number" && (i === 0 || v > Number(values[i - 1])),
      );
      if (!ascending) return false;
      // In a month without the day, ical.js gives the next month's first
      // at the other times, and how it got there decides which.
      if (values.length > 1 && (rule.freq === "MONTHLY" || rule.freq === "YEARLY")) return false;
    }
    // A weekday with a position only means something in a month or a year.
    if (part === "BYDAY" && (rule.freq === "DAILY" || rule.freq === "WEEKLY")) {
      if (!values.every((v) => typeof v === "string" && /^[A-Z]{2}$/i.test(v))) return false;
    }
    // A year's days of the month are normalized by the month ical.js last
    // stood in: only days every month has are the same whatever that was.
    if (part === "BYMONTHDAY" && rule.freq === "YEARLY") {
      if (!values.every((v) => typeof v === "number" && v >= 1 && v <= 28)) return false;
    }
  }
  return true;
}

const DAY_MS = 86_400_000;
const dayNumber = (year: number, month: number, day: number) =>
  Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
const monthNumber = (year: number, month: number) => year * 12 + (month - 1);

/** `DTSTART` moved on its wall clock by whole days or months; `null` past a month's end. */
function moved(dtstart: ICAL.Time, days: number, months: number): ICAL.Time | null {
  const start = dtstart.clone();
  if (days !== 0) {
    const date = new Date((dayNumber(start.year, start.month, start.day) + days) * DAY_MS);
    start.year = date.getUTCFullYear();
    start.month = date.getUTCMonth() + 1;
    start.day = date.getUTCDate();
    return start;
  }
  const target = monthNumber(start.year, start.month) + months;
  const year = Math.floor(target / 12);
  const month = (target % 12) + 1;
  if (start.day > ICAL.Time.daysInMonth(month, year)) return null;
  start.year = year;
  start.month = month;
  return start;
}

/**
 * Where a rule's iterator can start instead of `DTSTART` and still give
 * every occurrence on or after `from` (a day on the series' own wall clock):
 * the latest start whole periods of the rule after `DTSTART` whose settling
 * point is on or before `from`. ical.js's iterator is quirky only before it
 * settles (the start itself is given even when the rule does not name it; a
 * week's days before the start are dropped; BYSETPOS and BYMONTHDAY are
 * first worked out for the start's own month), and settles by:
 * - DAILY, the first of the next month (BYMONTHDAY is normalized per month);
 * - WEEKLY, the end of the start's week (7 days on);
 * - MONTHLY, the first of the next month;
 * - YEARLY, the first of the next year.
 * `null`: the rule walks from `DTSTART`.
 */
export function startNear(rule: ICAL.Recur, dtstart: ICAL.Time, from: string): ICAL.Time | null {
  if (!settles(rule)) return null;
  const interval = Math.max(1, rule.interval || 1);
  const [year, month, day] = from.split("-").map(Number) as [number, number, number];
  switch (rule.freq) {
    case "DAILY":
    case "WEEKLY": {
      const period = rule.freq === "DAILY" ? interval : 7 * interval;
      const settling = rule.freq === "DAILY" ? 31 : 7;
      const days =
        dayNumber(year, month, day) -
        settling -
        dayNumber(dtstart.year, dtstart.month, dtstart.day);
      const periods = Math.floor(days / period);
      return periods > 0 ? moved(dtstart, periods * period, 0) : null;
    }
    case "MONTHLY":
    case "YEARLY": {
      const period = rule.freq === "MONTHLY" ? interval : 12 * interval;
      const settling = rule.freq === "MONTHLY" ? 1 : 12;
      const months = monthNumber(year, month) - settling - monthNumber(dtstart.year, dtstart.month);
      // A start on the 31st (or 29 February) moves only to a month that has it.
      for (let periods = Math.floor(months / period); periods > 0; periods--) {
        const start = moved(dtstart, 0, periods * period);
        if (start) return start;
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * How many candidate times ical.js's iterator may try for one occurrence
 * (D118). Its own search has no end for a daily or finer rule that never
 * meets (31 April, a day counted from the month's end, which it never
 * matches, a weekday that an interval of 7 days never lands on): it would
 * hang the app on an event anyone can send. Past them the rule has no more
 * occurrences. A daily rule tries each day, so 10 000 are 27 years; the
 * sparsest one a client writes, the 29th of February on a Monday (every 28
 * years), says BYMONTH=2, and ical.js then tries February's days alone,
 * about 800. A try costs about 5 µs.
 */
const MAX_TRIES = 10_000;

class NeverMeets extends Error {
  override name = "NeverMeets";
}

/**
 * `iterator` with its search for each occurrence bounded by `MAX_TRIES`: past
 * them it is complete, and `next` returns `null`. ical.js asks
 * `check_contracting_rules` of every candidate it tries, first of all.
 */
export function bounded(iterator: ICAL.RecurIterator): ICAL.RecurIterator {
  const check = iterator.check_contracting_rules.bind(iterator);
  const next = iterator.next.bind(iterator);
  let tries = 0;
  iterator.check_contracting_rules = () => {
    if (++tries > MAX_TRIES) throw new NeverMeets();
    return check();
  };
  iterator.next = (again?: boolean) => {
    tries = 0;
    try {
      return next(again);
    } catch (error) {
      if (!(error instanceof NeverMeets)) throw error;
      iterator.completed = true;
      // As ical.js returns when it is complete; its types say a time.
      return null as unknown as ICAL.Time;
    }
  };
  return iterator;
}

/**
 * The starts of a series by its RRULEs and RDATEs, merged as ical.js's
 * `RecurExpansion` merges them, without its EXDATEs (`occurrencesBetween`
 * matches those by key, D118). With `from`, each rule that settles starts
 * near that day (`startNear`); starts before it may still come, and a caller
 * skips them. `null` when there are no more. Each rule's search for an
 * occurrence is `bounded`.
 */
export function seriesStarts(
  master: ICAL.Component,
  dtstart: ICAL.Time,
  from: string | null,
): () => ICAL.Time | null {
  const iterators = master.getAllProperties("rrule").map((property) => {
    const rule = property.getFirstValue() as ICAL.Recur;
    // Made first, so a rule ical.js refuses from DTSTART is refused as before,
    // and one it finds nothing for from there (a monthly 31st from a month
    // of 30 days, three such months on) stays without occurrences.
    let iterator = bounded(rule.iterator(dtstart));
    const near = from === null || iterator.completed ? null : startNear(rule, dtstart, from);
    if (near) {
      try {
        iterator = bounded(rule.iterator(near));
      } catch {
        // ical.js refuses some rules from some months only (a BYDAY that
        // BYMONTHDAY never meets in the first): walked from DTSTART.
      }
    }
    // As RecurExpansion does: its `last` is then the first occurrence.
    iterator.next();
    return iterator;
  });

  const dates = master
    .getAllProperties("rdate")
    .flatMap((property) => property.getValues() as ICAL.Time[])
    .toSorted((a, b) => a.compare(b));
  // As RecurExpansion: an item that does not recur has its start alone.
  if (iterators.length === 0 && dates.length === 0 && !master.hasProperty("recurrence-id")) {
    dates.push(dtstart.clone());
  }
  // As RecurExpansion: the RDATEs from DTSTART on, or all of them when the
  // first is before it (Google's birthdays).
  let index = dates[0] && dates[0].compare(dtstart) < 0 ? 0 : firstFrom(dates, dtstart);

  return () => {
    let earliest: ICAL.RecurIterator | null = null;
    for (const iterator of iterators) {
      if (!iterator.completed && (!earliest || earliest.last.compare(iterator.last) > 0)) {
        earliest = iterator;
      }
    }
    const date = dates[index];
    if (date && (!earliest || date.compare(earliest.last) <= 0)) {
      index++;
      return date;
    }
    if (!earliest) return null;
    const next = earliest.last.clone();
    earliest.next();
    return next;
  };
}

/** The index of the first time in `sorted` at or after `time`. */
function firstFrom(sorted: readonly ICAL.Time[], time: ICAL.Time): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle]!.compare(time) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
}
