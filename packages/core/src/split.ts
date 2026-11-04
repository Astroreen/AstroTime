// One iCalendar file split into calendar objects (RFC 4791 §4.1): a file
// imported from the device (docs/plans/import.md#D267) and a subscription's
// answer (docs/plans/providers.md#D251) hold a whole calendar, the store
// keeps one object per UID. A subpath of its own (`@astrotime/core/split`),
// so the app loads it with the code that needs it, never with the app; it
// imports the modules it needs, not the package's index.
import ICAL from "ical.js";

import { CalendarObject, writeCalendar } from "./calendar-object.ts";
import { colorNameHex, hexColor } from "./colors.ts";

/** One calendar object of a file: a master and its exceptions with the time zones they use. */
export interface SplitObject {
  readonly uid: string;
  /** Its components' name, upper case: `VEVENT`, `VTODO`, or another kept as written (`VJOURNAL`). */
  readonly kind: string;
  /** The object's iCalendar text; the same file always gives the same text. */
  readonly ics: string;
}

/**
 * Why a component of the file is not among the objects: it has no UID, its
 * UID is shared by components of different kinds or by two masters, or what
 * it says cannot be read as an event or a task.
 */
export type SplitProblemReason = "no-uid" | "mixed-kinds" | "several-masters" | "invalid";

export interface SplitProblem {
  /** The component's place among the calendar's components (time zones aside), from 0. */
  readonly index: number;
  readonly uid: string | null;
  /** Its name, upper case. */
  readonly component: string;
  readonly reason: SplitProblemReason;
}

/** A calendar file's calendar: what it says of itself and its objects. */
export interface SplitCalendar {
  /** RFC 7986 `NAME`, or `X-WR-CALNAME`. */
  readonly name: string | null;
  /** RFC 7986 `COLOR` or `X-APPLE-CALENDAR-COLOR`, as `#rrggbb`. */
  readonly color: string | null;
  /** RFC 7986 `REFRESH-INTERVAL`, or `X-PUBLISHED-TTL`, in milliseconds. */
  readonly refresh: number | null;
  /** In the order their UIDs first appear in the file. */
  readonly objects: readonly SplitObject[];
  readonly problems: readonly SplitProblem[];
}

/** The text is not one iCalendar `VCALENDAR`: a web page, empty, cut short, or no iCalendar at all. */
export class NotCalendarError extends Error {
  override name = "NotCalendarError";
}

/**
 * Splits a file that must be exactly one `VCALENDAR`, as a subscription's
 * answer (providers D251): anything else (an HTML page, an empty or
 * truncated text, none or several calendars, a line outside the calendar)
 * throws `NotCalendarError`. A component that cannot be read is a problem
 * of its own, not the file's.
 */
export function splitCalendar(text: string): SplitCalendar {
  const calendars = calendarsOf(lines(text), true);
  if (calendars.length !== 1) throw new NotCalendarError("The text is not one VCALENDAR.");
  return splitOne(calendars[0]!, null);
}

/**
 * Splits a file from the device (import.md D267), forgiving what exporters
 * get wrong besides what `splitCalendar` forgives: several `VCALENDAR`s one
 * after another, lines outside them, a file cut short (what came whole is
 * kept, the component cut is a problem), and a component with no UID (it
 * gets `newUid()`). A text with no `VCALENDAR` throws `NotCalendarError`.
 */
export function splitCalendars(
  text: string,
  options: { readonly newUid: () => string },
): SplitCalendar[] {
  const calendars = calendarsOf(lines(text), false);
  if (calendars.length === 0) throw new NotCalendarError("The text holds no VCALENDAR.");
  return calendars.map((calendar) => splitOne(calendar, options.newUid));
}

/** jCal (RFC 7265) as iCalendar text, for `splitCalendars`; throws `NotCalendarError` for other JSON. */
export function jcalText(json: unknown): string {
  const calendars = Array.isArray(json) && typeof json[0] === "string" ? [json] : json;
  if (!Array.isArray(calendars) || calendars.length === 0) {
    throw new NotCalendarError("The JSON is not jCal.");
  }
  try {
    return calendars
      .map((jcal: unknown) => {
        if (!Array.isArray(jcal) || jcal[0] !== "vcalendar") throw new Error("Not a vcalendar.");
        return writeCalendar(new ICAL.Component(jcal));
      })
      .join("");
  } catch (error) {
    throw new NotCalendarError("The JSON is not jCal.", { cause: error });
  }
}

/** A content line's start: a name, then its parameters or its value (RFC 5545 §3.1). */
const CONTENT_LINE = /^[A-Za-z0-9-]+[;:]/;

/**
 * The text's content lines, folds kept: a byte order mark, LF or CR line
 * ends and blank lines forgiven, and a line broken without folding joined to
 * the one before as the line break it meant (Outlook's descriptions; RFC
 * 5545 §3.3.11).
 */
function lines(text: string): string[] {
  const result: string[] = [];
  for (const line of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    if (line.trim() === "") continue;
    const last = result.length - 1;
    if (last >= 0 && !CONTENT_LINE.test(line) && !/^[ \t]/.test(line)) {
      result[last] += `\\n${line}`;
    } else {
      result.push(line);
    }
  }
  return result;
}

/** A component of a calendar file: its place, its name and, if it could be read, itself. */
interface Part {
  readonly index: number;
  readonly name: string;
  /** Its UID as written, for a problem's sake when it cannot be read. */
  readonly uid: string | null;
  readonly component: ICAL.Component | null;
}

interface Calendar {
  readonly root: ICAL.Component;
  readonly zones: readonly ICAL.Component[];
  readonly parts: readonly Part[];
}

/** A component's lines; `whole` once its END came. */
interface Block {
  readonly lines: string[];
  whole: boolean;
}

const BEGIN = /^BEGIN:([A-Za-z0-9-]+)[ \t]*$/i;
const END = /^END:([A-Za-z0-9-]+)[ \t]*$/i;

/**
 * The text's `VCALENDAR`s, each component read on its own, so a value
 * ical.js refuses (an `RRULE` it does not know) costs that component only.
 * `strict`: a line outside a calendar or a calendar cut short throws.
 */
function calendarsOf(content: readonly string[], strict: boolean): Calendar[] {
  const calendars: Calendar[] = [];
  let header: string[] | null = null;
  let blocks: Block[] = [];
  let block: Block | null = null;
  let depth = 0;
  const close = () => {
    if (header) calendars.push(calendarOf(header, blocks, strict));
    header = null;
    blocks = [];
  };
  for (const line of content) {
    const begin = BEGIN.exec(line)?.[1]?.toUpperCase();
    const end = END.exec(line)?.[1]?.toUpperCase();
    if (!header) {
      if (begin === "VCALENDAR") header = [];
      else if (strict) throw new NotCalendarError("The text has a line outside a VCALENDAR.");
      continue;
    }
    if (block) {
      block.lines.push(line);
      if (begin) depth++;
      if (end) depth--;
      if (depth === 0) {
        block.whole = true;
        block = null;
      }
      continue;
    }
    if (end === "VCALENDAR") close();
    else if (begin) {
      block = { lines: [line], whole: false };
      blocks.push(block);
      depth = 1;
    } else header.push(line);
  }
  if (header) {
    if (strict) throw new NotCalendarError("The VCALENDAR is cut short.");
    // Cut short: what came whole is read, the component cut is not.
    close();
  }
  return calendars;
}

function calendarOf(
  header: readonly string[],
  blocks: readonly Block[],
  strict: boolean,
): Calendar {
  const wrap = (body: readonly string[]) =>
    ["BEGIN:VCALENDAR", ...body, "END:VCALENDAR"].join("\r\n");
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(wrap(header)) as unknown[]);
  } catch (error) {
    if (strict)
      throw new NotCalendarError("The calendar's properties are not iCalendar.", { cause: error });
    root = new ICAL.Component("vcalendar");
  }
  const zones: ICAL.Component[] = [];
  const parts: Part[] = [];
  for (const { lines: block, whole } of blocks) {
    const name = BEGIN.exec(block[0]!)![1]!.toUpperCase();
    let component: ICAL.Component | null = null;
    try {
      if (whole) {
        component =
          new ICAL.Component(ICAL.parse(wrap(block)) as unknown[]).getAllSubcomponents()[0] ?? null;
      }
    } catch {
      // Left unread: a problem of its own below, or a time zone the times then do without.
    }
    if (name === "VTIMEZONE") {
      if (component) zones.push(component);
      continue;
    }
    const uid = block.find((line) => /^UID[;:]/i.test(line))?.replace(/^[^:]*:/, "") ?? null;
    parts.push({ index: parts.length, name, uid: uid || null, component });
  }
  return { root, zones, parts };
}

const CALENDAR_ONLY = new Set(["method"]);

function splitOne(calendar: Calendar, newUid: (() => string) | null): SplitCalendar {
  const { root } = calendar;
  // Every property of the calendar goes with each object but METHOD, which a
  // calendar object resource must not have (RFC 4791 §4.1).
  const header = root
    .getAllProperties()
    .filter((property) => !CALENDAR_ONLY.has(property.name))
    .map((property) => property.toJSON());
  const zones = new Map<string, ICAL.Component>();
  for (const zone of calendar.zones) {
    const tzid = zone.getFirstPropertyValue("tzid");
    if (typeof tzid === "string" && !zones.has(tzid)) zones.set(tzid, zone);
  }

  const problems: SplitProblem[] = [];
  const groups = new Map<string, { index: number; components: ICAL.Component[] }>();
  for (const { index, name, uid: written, component } of calendar.parts) {
    if (!component) {
      problems.push({ index, uid: written, component: name, reason: "invalid" });
      continue;
    }
    let uid = component.getFirstPropertyValue("uid");
    if ((typeof uid !== "string" || uid === "") && newUid) {
      uid = newUid();
      component.updatePropertyWithValue("uid", uid);
    }
    if (typeof uid !== "string" || uid === "") {
      problems.push({ index, uid: null, component: name, reason: "no-uid" });
      continue;
    }
    const group = groups.get(uid);
    if (group) group.components.push(component);
    else groups.set(uid, { index, components: [component] });
  }

  const objects: SplitObject[] = [];
  for (const [uid, { index, components }] of groups) {
    const kind = components[0]!.name.toUpperCase();
    const problem = (reason: SplitProblemReason) =>
      problems.push({ index, uid, component: kind, reason });
    if (components.some((component) => component.name !== components[0]!.name)) {
      problem("mixed-kinds");
      continue;
    }
    if (components.filter((component) => !component.hasProperty("recurrence-id")).length > 1) {
      problem("several-masters");
      continue;
    }
    const used = new Set(components.flatMap(tzidsOf));
    const own = [...zones].filter(([tzid]) => used.has(tzid)).map(([, zone]) => zone.toJSON());
    const ics = writeCalendar(
      new ICAL.Component([
        "vcalendar",
        header,
        [...own, ...components.map((component) => component.toJSON())],
      ]),
    );
    if (kind === "VEVENT" || kind === "VTODO") {
      try {
        CalendarObject.parse(ics);
      } catch {
        // What ical.js cannot read of a value throws its own errors, not only ours.
        problem("invalid");
        continue;
      }
    }
    objects.push({ uid, kind, ics });
  }
  problems.sort((a, b) => a.index - b.index);

  return {
    name: textOf(root, "name") ?? textOf(root, "x-wr-calname"),
    color: colorOf(root),
    refresh: refreshOf(root),
    objects,
    problems,
  };
}

/** The TZIDs a component's times name, its alarms' too. */
function tzidsOf(component: ICAL.Component): string[] {
  return [
    ...component.getAllProperties().flatMap((property) => {
      const tzid = property.getParameter("tzid");
      return typeof tzid === "string" ? [tzid] : [];
    }),
    ...component.getAllSubcomponents().flatMap(tzidsOf),
  ];
}

function textOf(root: ICAL.Component, name: string): string | null {
  const value = root.getFirstPropertyValue(name);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function colorOf(root: ICAL.Component): string | null {
  const color = textOf(root, "color");
  const named = color && (colorNameHex(color) ?? hexColor(color));
  if (named) return named;
  // Apple writes `#RRGGBBAA`; the alpha is left out.
  const apple = textOf(root, "x-apple-calendar-color");
  return apple ? hexColor(apple.slice(0, 7)) : null;
}

function refreshOf(root: ICAL.Component): number | null {
  for (const name of ["refresh-interval", "x-published-ttl"]) {
    const value: unknown = root.getFirstPropertyValue(name);
    try {
      const duration =
        value instanceof ICAL.Duration
          ? value
          : typeof value === "string"
            ? ICAL.Duration.fromString(value.trim())
            : null;
      const seconds = duration?.toSeconds() ?? 0;
      if (seconds > 0) return seconds * 1000;
    } catch {
      // Unreadable: the next one, or none.
    }
  }
  return null;
}
