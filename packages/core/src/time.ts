import ICAL from "ical.js";

import { WINDOWS_ZONES } from "./windows-zones.ts";

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
       * The IANA zone; a Windows zone name is read as the IANA zone it maps
       * to, with a VTIMEZONE or without. Only a TZID that is neither, in a
       * VTIMEZONE the object defines (`Customized Time Zone`), stays as written,
       * and is then no zone `Intl` knows. `epochMs` is exact either way. The
       * TZID itself is never rewritten: it stays in the calendar object, which
       * is what `serialize` writes.
       */
      readonly timeZone: string;
      readonly epochMs: number;
    };

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function localOf(time: ICAL.Time): string {
  return `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}T${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}`;
}

/**
 * Where an ical.js time's zone comes from: a date has none; UTC; a TZID the
 * object defines in a VTIMEZONE, which ical.js resolves itself (`defined`); a
 * TZID it does not define (Google, some Android clients, Outlook's Windows
 * names), which ical.js holds as a wall clock and AstroTime resolves through
 * `Intl` (`undefined`); or none, or a TZID nothing knows (`floating`)
 * (docs/plans/foundation.md#D32). `fromIcalTime` and the walk of a series'
 * `UNTIL` (D141) both tell the cases apart by this alone.
 */
export type ZoneOrigin =
  | { readonly kind: "date" }
  | { readonly kind: "utc" }
  | { readonly kind: "defined"; readonly timeZone: string }
  | { readonly kind: "undefined"; readonly timeZone: string }
  | { readonly kind: "floating" };

export function zoneOrigin(time: ICAL.Time): ZoneOrigin {
  if (time.isDate) return { kind: "date" };
  const zone = time.zone;
  if (zone === ICAL.Timezone.utcTimezone) return { kind: "utc" };
  if (zone && zone !== ICAL.Timezone.localTimezone && zone.tzid !== "floating") {
    return { kind: "defined", timeZone: ianaName(zone.tzid) };
  }
  const tzid = tzidOf(time);
  const timeZone = tzid === undefined ? undefined : resolveUndefinedTzid(tzid);
  return timeZone ? { kind: "undefined", timeZone } : { kind: "floating" };
}

/** Converts an ical.js time, its zone as `zoneOrigin` finds it. */
export function fromIcalTime(time: ICAL.Time): ItemTime {
  const origin = zoneOrigin(time);
  if (origin.kind === "date") {
    return { type: "date", date: `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}` };
  }
  const local = localOf(time);
  switch (origin.kind) {
    case "utc":
      return { type: "zoned", local, timeZone: "UTC", epochMs: time.toUnixTime() * 1000 };
    case "defined":
      return { type: "zoned", local, timeZone: origin.timeZone, epochMs: time.toUnixTime() * 1000 };
    case "undefined":
      return {
        type: "zoned",
        local,
        timeZone: origin.timeZone,
        epochMs: zonedToEpoch(local, origin.timeZone),
      };
    case "floating":
      return { type: "floating", local };
  }
}

/** The IANA zone for a TZID the object does not define: itself, or a Windows zone name's. */
function resolveUndefinedTzid(written: string): string | undefined {
  const tzid = written.trim();
  if (isKnownTimeZone(tzid)) return tzid;
  return windowsZone(tzid);
}

// Windows compares zone names case-insensitively.
const windowsZonesByLowerCase = new Map(
  Object.entries(WINDOWS_ZONES).map(([windows, iana]) => [windows.toLowerCase(), iana]),
);

function windowsZone(tzid: string): string | undefined {
  return windowsZonesByLowerCase.get(tzid.toLowerCase());
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
 * The IANA name a TZID the object defines stands for: itself, the end of a
 * path-style TZID (`/freeassociation.sourceforge.net/Europe/Berlin`, older
 * Evolution and Lightning), or a Windows zone name's. Anything else is
 * returned as written.
 */
function ianaName(tzid: string): string {
  if (isKnownTimeZone(tzid)) return tzid;
  const parts = tzid.split("/");
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts.slice(i).join("/");
    if (candidate.includes("/") && isKnownTimeZone(candidate)) return candidate;
  }
  return windowsZone(tzid.trim()) ?? tzid;
}

/**
 * Zone names already asked of `Intl`: every zoned time read asks, and making
 * an `Intl.DateTimeFormat` costs more than the rest of reading the time
 * (docs/plans/foundation.md#D118). Bounded as `wallClocks` is.
 */
const knownZones = new Map<string, boolean>();
const KNOWN_ZONES = 1000;

function isKnownTimeZone(timeZone: string): boolean {
  const known = knownZones.get(timeZone);
  if (known !== undefined) return known;
  let result: boolean;
  try {
    result = new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone !== "";
  } catch {
    result = false;
  }
  if (knownZones.size >= KNOWN_ZONES) knownZones.delete(knownZones.keys().next().value!);
  knownZones.set(timeZone, result);
  return result;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Wall clocks already asked of `Intl`, by zone and instant: the views ask
 * for the same ones on every layout, and a series' expansion again for each
 * range. Bounded: past the limit its oldest entry goes.
 */
const wallClocks = new Map<string, string>();
const WALL_CLOCKS = 20_000;

/** The wall clock of an instant in a zone, `2026-10-31T09:00:00`. */
export function wallClockIn(epochMs: number, timeZone: string): string {
  const cacheKey = `${timeZone} ${epochMs}`;
  const known = wallClocks.get(cacheKey);
  if (known !== undefined) return known;
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
  const local = `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}`;
  // The oldest goes first (a Map keeps insertion order), so a layout that
  // passes the limit keeps what it asked for last instead of starting over.
  if (wallClocks.size >= WALL_CLOCKS) wallClocks.delete(wallClocks.keys().next().value!);
  wallClocks.set(cacheKey, local);
  return local;
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

/** A wall clock in an IANA zone (or `UTC`) as an `ItemTime`, its instant as `zonedToEpoch` reads it. */
export function zonedTime(local: string, timeZone: string): Extract<ItemTime, { type: "zoned" }> {
  const epochMs = timeZone === "UTC" ? Date.parse(`${local}Z`) : zonedToEpoch(local, timeZone);
  return { type: "zoned", local, timeZone, epochMs };
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
