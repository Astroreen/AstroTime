import ICAL from "ical.js";

/**
 * A point in time as iCalendar states it (docs/plans/foundation.md#D7):
 * - `date`: an all-day date, `2026-10-31`;
 * - `floating`: a wall-clock time with no zone, the same in every zone;
 * - `zoned`: a wall-clock time in an IANA zone (`UTC` for `Z` times), with
 *   the instant it names.
 */
export type ItemTime =
  | { readonly type: "date"; readonly date: string }
  | { readonly type: "floating"; readonly local: string }
  | {
      readonly type: "zoned";
      readonly local: string;
      /**
       * The IANA zone, or the TZID as written when it is not an IANA name
       * (an Outlook VTIMEZONE, say). `epochMs` is exact either way.
       */
      readonly timeZone: string;
      readonly epochMs: number;
    };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function localOf(time: ICAL.Time): string {
  return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
}

/**
 * Converts an ical.js time. A TZID the object defines in a VTIMEZONE is
 * resolved by ical.js; a TZID it does not define (Google, some Android
 * clients) is taken as an IANA name and resolved through `Intl`. A TZID
 * neither knows stays floating.
 */
export function fromIcalTime(time: ICAL.Time): ItemTime {
  if (time.isDate) {
    return { type: "date", date: `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}` };
  }
  const local = localOf(time);
  const zone = time.zone;
  if (zone === ICAL.Timezone.utcTimezone) {
    return { type: "zoned", local, timeZone: "UTC", epochMs: time.toUnixTime() * 1000 };
  }
  if (zone && zone !== ICAL.Timezone.localTimezone && zone.tzid !== "floating") {
    return {
      type: "zoned",
      local,
      timeZone: ianaName(zone.tzid),
      epochMs: time.toUnixTime() * 1000,
    };
  }
  const tzid = tzidOf(time);
  if (tzid && isKnownTimeZone(tzid)) {
    return { type: "zoned", local, timeZone: tzid, epochMs: zonedToEpoch(local, tzid) };
  }
  return { type: "floating", local };
}

/**
 * The TZID a time was written with. ical.js keeps it on an untyped field when
 * the object has no VTIMEZONE for it, and drops it when it clones the time.
 */
function tzidOf(time: ICAL.Time): string | undefined {
  return (time as ICAL.Time & { timezone?: string }).timezone;
}

/** Copies the TZID `tzidOf` reads from one time to another. */
export function keepTzid(from: ICAL.Time, to: ICAL.Time): ICAL.Time {
  const tzid = tzidOf(from);
  if (tzid) (to as ICAL.Time & { timezone?: string }).timezone = tzid;
  return to;
}

/**
 * The IANA name a TZID stands for: itself, or the end of a path-style TZID
 * (`/freeassociation.sourceforge.net/Europe/Berlin`, older Evolution and
 * Lightning). Anything else is returned as written.
 */
function ianaName(tzid: string): string {
  if (isKnownTimeZone(tzid)) return tzid;
  const parts = tzid.split("/");
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join("/");
    if (candidate.includes("/") && isKnownTimeZone(candidate)) return candidate;
  }
  return tzid;
}

function isKnownTimeZone(timeZone: string): boolean {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall clock of an instant in a zone, `2026-10-31T09:00:00`. */
export function wallClockIn(epochMs: number, timeZone: string): string {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(epochMs).map((p) => [p.type, p.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}`;
}

function wallClockAsUtc(local: string): number {
  return Date.parse(`${local}Z`);
}

const DAY_MS = 86_400_000;

/**
 * The instant a wall-clock time names in a zone, as RFC 5545 §3.3.5 reads it:
 * a time skipped by a DST gap uses the offset before the gap (so it moves
 * forward); an ambiguous one takes the earlier instant.
 */
export function zonedToEpoch(local: string, timeZone: string): number {
  const target = wallClockAsUtc(local);
  const offsetAt = (epoch: number) => wallClockAsUtc(wallClockIn(epoch, timeZone)) - epoch;
  const before = target - offsetAt(target - DAY_MS);
  const after = target - offsetAt(target + DAY_MS);
  const valid = [before, after].filter((epoch) => wallClockIn(epoch, timeZone) === local);
  return valid.length > 0 ? Math.min(...valid) : before;
}

/** The wall clock at which a time shows to a user in `timeZone`. */
export function wallClockOf(time: ItemTime, timeZone: string): string {
  switch (time.type) {
    case "date":
      return `${time.date}T00:00:00`;
    case "floating":
      return time.local;
    case "zoned":
      return wallClockIn(time.epochMs, timeZone);
  }
}
