// Where a series' occurrences are walked from (docs/plans/foundation.md#D118):
// a rule whose occurrences repeat with its period starts near the range,
// whole periods of the rule after DTSTART, instead of at DTSTART.
import ICAL from "ical.js";

import { wallClockIn, zoneOrigin } from "./time.ts";

/**
 * The parts with which ical.js's iterator settles into the rule's period:
 * started anywhere on the lattice of whole periods from DTSTART, it gives the
 * same occurrences once it has settled (`startNear`). Others walk from
 * DTSTART: BYMONTH in a monthly rule (ical.js steps through its months
 * without the interval) and, not proven to settle, in a daily or weekly one;
 * BYWEEKNO, BYYEARDAY; COUNT; HOURLY or finer.
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
 * The Gregorian calendar repeats every 400 years: 146 097 days (a whole
 * number of weeks), 20 871 weeks, 4 800 months. A rule's candidates repeat
 * with it, whole periods at a time, so a search that has tried every
 * candidate of 400 years of periods without an occurrence never finds one
 * (D118). With an INTERVAL its lattice may take longer to come round (up to
 * INTERVAL times as long, when they share no factor): a daily or weekly rule
 * is searched through 400 years of days still, and one that meets less often
 * than that ends.
 */
const CYCLE: Readonly<Record<string, number>> = {
  DAILY: 146_097,
  WEEKLY: 20_871,
  MONTHLY: 4_800,
  YEARLY: 400,
};
/** The candidates ical.js tries in one period at most: each weekday of a week, each day of a month or a year. */
const PER_PERIOD: Readonly<Record<string, number>> = {
  DAILY: 1,
  WEEKLY: 7,
  MONTHLY: 32,
  YEARLY: 367,
};
/**
 * Hourly and finer rules try as many candidates as a daily one, not their
 * cycle (400 years of hours are 3.5 million tries, seconds of a frozen app):
 * 17 years of hours, 101 days of minutes. The one bound not safe by
 * construction; such a series from years ago is refused by
 * `ExpansionLimitError` anyway.
 */
const FINE = CYCLE["DAILY"]!;

const lengthOf = (values: unknown) =>
  Array.isArray(values) && values.length > 0 ? values.length : 1;

/**
 * How many candidate times ical.js's iterator may try for one occurrence of
 * `rule`: every candidate of 400 years of its periods, and none for a rule
 * that `neverMeets`. Its own search has no end for a daily or finer rule that
 * names days it never reaches, and would hang the app on an event anyone can
 * send.
 */
export function triesFor(rule: ICAL.Recur, dtstart: ICAL.Time): number {
  return neverMeets(rule, dtstart) ? 0 : cycleTries(rule);
}

/** Every candidate of 400 years of the rule's periods (`CYCLE`), each time of the day apart. */
export function cycleTries(rule: ICAL.Recur): number {
  const { parts } = rule;
  const times = lengthOf(parts.BYHOUR) * lengthOf(parts.BYMINUTE) * lengthOf(parts.BYSECOND);
  const cycle = CYCLE[rule.freq];
  return cycle === undefined ? FINE : cycle * PER_PERIOD[rule.freq]! * times;
}

/** The longest each month gets (29 February). */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * Whether a daily or finer rule names days ical.js never reaches, known
 * without walking it. Such a rule tests every candidate against its parts as
 * written (it never moves to another month as a monthly rule does, so it
 * never counts a day from the month's end): a BYMONTHDAY no BYMONTH has
 * (31 April, 30 February), one counted from the month's end, a BYDAY with a
 * position, or every INTERVAL of 7 days landing on a weekday BYDAY does not
 * name. The search would only find that out after `cycleTries`, about 0.12 s.
 */
function neverMeets(rule: ICAL.Recur, dtstart: ICAL.Time): boolean {
  if (CYCLE[rule.freq] !== undefined && rule.freq !== "DAILY") return false;
  const { BYMONTH, BYMONTHDAY, BYDAY } = rule.parts;
  const months = (BYMONTH ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]).filter(
    (m) => Number.isInteger(m) && m >= 1 && m <= 12,
  );
  if (months.length === 0) return true;
  if (
    BYMONTHDAY &&
    !BYMONTHDAY.some((day) => months.some((m) => day >= 1 && day <= MONTH_DAYS[m - 1]!))
  ) {
    return true;
  }
  if (BYDAY) {
    const weekdays = BYDAY.filter((day) => /^[A-Z]{2}$/i.test(day)).map((day) => day.toUpperCase());
    if (weekdays.length === 0) return true;
    const interval = Math.max(1, rule.interval || 1);
    const weekday = ICAL.Recur.numericDayToIcalDay(dtstart.dayOfWeek());
    if (rule.freq === "DAILY" && interval % 7 === 0 && !weekdays.includes(weekday)) return true;
  }
  return false;
}

/** A search that ran past its tries. */
class NeverMeets extends Error {
  override name = "NeverMeets";
}

/**
 * `iterator` with its search for each occurrence bounded: by `tries`
 * candidates, and by 400 years of the days ical.js steps through one at a
 * time (`increment_monthday`, a loop of its own: a daily rule at `INTERVAL=7`
 * steps 7 days a candidate, one at `INTERVAL=999999999` would never end its
 * first), and by the year 9999. Past any it is complete, and `next` returns
 * `null`. ical.js asks
 * `check_contracting_rules` of every candidate it tries, first of all. One
 * that throws on its way (`Same occurrence found twice`, `Malformed values in
 * BYDAY combined with BYMONTHDAY parts`) is complete too, and `refused` hears
 * of it.
 */
export function bounded(
  iterator: ICAL.RecurIterator,
  tries: number,
  refused: (error: unknown) => void = () => {},
): ICAL.RecurIterator {
  const check = iterator.check_contracting_rules.bind(iterator);
  const monthday = iterator.increment_monthday.bind(iterator);
  const next = iterator.next.bind(iterator);
  let tried = 0;
  let days = 0;
  iterator.check_contracting_rules = () => {
    // Past the year 9999, which iCalendar cannot write nor `Intl` show (an
    // hourly `INTERVAL=999999999` lands there in one step), a series ends.
    if (++tried > tries || iterator.last.year > 9999) throw new NeverMeets();
    return check();
  };
  iterator.increment_monthday = (inc: number) => {
    days += inc;
    if (days > CYCLE["DAILY"]!) throw new NeverMeets();
    monthday(inc);
  };
  iterator.next = (again?: boolean) => {
    tried = 0;
    days = 0;
    try {
      return next(again);
    } catch (error) {
      if (error instanceof NeverMeets) walks.exhausted++;
      else refused(error);
      iterator.completed = true;
      // As ical.js returns when it is complete; its types say a time.
      return null as unknown as ICAL.Time;
    }
  };
  return iterator;
}

/**
 * ical.js's iterator for `rule` from `start`, its constructor bounded by 400
 * years too: it looks for the first month with a fifth (or fifth last)
 * weekday, and the first year with a day, in loops of its own, and a monthly
 * `INTERVAL=24;BYDAY=5MO` from a February of an odd year, every month of it a
 * February of 28 days, never ends. `null` when it found none; it throws what
 * ical.js throws for a rule it refuses.
 */
export function iteratorOf(rule: ICAL.Recur, start: ICAL.Time): ICAL.RecurIterator | null {
  const prototype = ICAL.RecurIterator.prototype;
  const { increment_month: month, increment_year: year } = prototype;
  let months = 0;
  let years = 0;
  // Only while it is made: the constructor runs at once, and nothing else meanwhile.
  prototype.increment_month = function (this: ICAL.RecurIterator) {
    if (++months > CYCLE["MONTHLY"]!) throw new NeverMeets();
    month.call(this);
  };
  prototype.increment_year = function (this: ICAL.RecurIterator, inc: number) {
    if (++years > CYCLE["YEARLY"]!) throw new NeverMeets();
    year.call(this, inc);
  };
  try {
    return rule.iterator(start);
  } catch (error) {
    if (error instanceof NeverMeets) return null;
    throw error;
  } finally {
    prototype.increment_month = month;
    prototype.increment_year = year;
  }
}

/**
 * What the walks did since the counts were last read, for the benchmark
 * (`scripts/bench-big-calendar.ts`): rules started near the range, rules
 * walked from DTSTART, starts near the range ical.js refused (walked from
 * DTSTART instead, by its message), searches that ran out of tries, and rules
 * ical.js refused.
 */
export const walks = {
  near: 0,
  fromStart: 0,
  fallbacks: new Map<string, number>(),
  exhausted: 0,
  refused: 0,
};

/** The objects whose rule ical.js refused, by their master as written: logged once per version. */
const refusals = new Set<string>();
const REFUSALS = 1000;

/** Says that ical.js refused a series' rule, once per object and version of it. */
function logRefusal(master: ICAL.Component, error: unknown): void {
  walks.refused++;
  const version = JSON.stringify(master.toJSON());
  if (refusals.has(version)) return;
  if (refusals.size >= REFUSALS) refusals.delete(refusals.keys().next().value!);
  refusals.add(version);
  // Every platform has a console; the core's types (`types: []`) do not.
  const { console } = globalThis as { console?: { error(...data: unknown[]): void } };
  console?.error(
    `ical.js refused the recurrence of ${String(master.getFirstPropertyValue("uid"))}; it shows at its start alone.`,
    error,
  );
}

/**
 * The starts of a series by its RRULEs and RDATEs, merged as ical.js's
 * `RecurExpansion` merges them, without its EXDATEs (`occurrencesBetween`
 * matches those by key, D118). With `from`, each rule that settles starts
 * near that day (`startNear`); starts before it may still come, and a caller
 * skips them. `null` when there are no more.
 *
 * Every rule is walked bounded (`iteratorOf`, `bounded`, `triesFor`), and a
 * rule ical.js refuses (`Malformed values in BYDAY part` from some months,
 * BYMONTHDAY in a weekly rule) is its DTSTART alone, the first occurrence by
 * RFC 5545, said once (D118): no object any server can send hangs a read or
 * breaks a whole range.
 */
export function seriesStarts(
  master: ICAL.Component,
  dtstart: ICAL.Time,
  from: string | null,
): () => ICAL.Time | null {
  const refused = (error: unknown) => logRefusal(master, error);
  let starts = 0;
  const rules = master.getAllProperties("rrule");
  const iterators = rules.flatMap((property) => {
    let iterator: ICAL.RecurIterator | null;
    let rule: ICAL.Recur;
    try {
      rule = onWallClock(property.getFirstValue() as ICAL.Recur, dtstart);
      // Made first, so a rule ical.js refuses from DTSTART is refused there,
      // and one it finds nothing for from there (a monthly 31st from a month
      // of 30 days, three such months on) stays without occurrences.
      iterator = iteratorOf(rule, dtstart);
    } catch (error) {
      refused(error);
      starts++;
      return [];
    }
    if (!iterator) return [];
    const tries = triesFor(rule, dtstart);
    const near = from === null || iterator.completed ? null : startNear(rule, dtstart, from);
    if (near) {
      let shifted: ICAL.RecurIterator | null = null;
      try {
        shifted = iteratorOf(rule, near);
      } catch (error) {
        // ical.js refuses some rules from some months only (a BYDAY that
        // BYMONTHDAY never meets in the first): walked from DTSTART.
        if (!(error instanceof Error)) throw error;
        walks.fallbacks.set(error.message, (walks.fallbacks.get(error.message) ?? 0) + 1);
      }
      if (shifted) iterator = shifted;
    }
    if (iterator.dtstart === near) walks.near++;
    else walks.fromStart++;
    bounded(iterator, tries, refused);
    // As RecurExpansion does: its `last` is then the first occurrence.
    iterator.next();
    return [iterator];
  });

  // An RDATE of a period starts an occurrence at the period's start.
  const dates = master
    .getAllProperties("rdate")
    .flatMap((property) => property.getValues())
    .flatMap((value) =>
      value instanceof ICAL.Period ? [value.start] : value instanceof ICAL.Time ? [value] : [],
    );
  // DTSTART is the first instance of the recurrence set (RFC 5545 3.8.5.3),
  // of RDATEs alone too, where ical.js's RecurExpansion leaves it out; an
  // RRULE's own walk gives it.
  if (rules.length === 0 && !master.hasProperty("recurrence-id")) starts++;
  for (let i = 0; i < starts; i++) dates.push(dtstart.clone());
  dates.sort((a, b) => a.compare(b));
  // As RecurExpansion: the RDATEs from DTSTART on, or all of them when the
  // first is before it (Google's birthdays).
  let index = dates[0] && dates[0].compare(dtstart) < 0 ? 0 : firstFrom(dates, dtstart);

  const step = () => {
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
  // The set is the union of the rules' and the RDATEs' starts (RFC 5545
  // 3.8.5.3): a start two of them give (an RDATE at DTSTART beside an RRULE,
  // two rules that meet) is one occurrence. Both come in order, so the same
  // start comes twice in a row.
  let last: ICAL.Time | null = null;
  return () => {
    for (;;) {
      const next = step();
      if (!next || !last || next.compare(last) !== 0) {
        last = next;
        return next;
      }
    }
  };
}

/**
 * The rule as ical.js must walk it from `dtstart`. A DTSTART in a zone the
 * object does not define (Google's and Outlook's: a TZID and no VTIMEZONE,
 * D32) is a wall clock to ical.js, which compares a UTC UNTIL with it as if
 * the wall clock were UTC, so the series ended hours early or late. Such an
 * UNTIL becomes its instant's wall clock in that zone.
 */
function onWallClock(rule: ICAL.Recur, dtstart: ICAL.Time): ICAL.Recur {
  const { until } = rule;
  if (!until || zoneOrigin(until).kind !== "utc") return rule;
  const origin = zoneOrigin(dtstart);
  if (origin.kind !== "undefined") return rule;
  const walked = rule.clone();
  // In the hour a DST change repeats, the wall clock stands for both of its
  // instants: an occurrence at it is kept.
  walked.until = ICAL.Time.fromDateTimeString(
    wallClockIn(until.toUnixTime() * 1000, origin.timeZone),
  );
  return walked;
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
