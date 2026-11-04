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
 * What went wrong with a part of the file. Not among the objects: `no-uid`
 * (where no UID can be given), `invalid` (ical.js or AstroTime cannot read
 * it), `unterminated` (its `END` never came). Among them all the same
 * (`kept`): `duplicate` (the same component twice under one UID: one is
 * kept), `several-masters` and `mixed-kinds` (a second master, or a
 * component of another kind, under a UID taken: it becomes an object of its
 * own under a new UID), `joined-line` (a line broken without folding,
 * joined to the text value before it), `dropped-line` (a stray line that
 * belongs to no value, left out). Of the calendar itself: `invalid-zone` (a
 * `VTIMEZONE` that cannot be read: the objects naming it go without it, and
 * their times are read from the TZID, foundation D32) and
 * `invalid-property` (a calendar property that cannot be read, left out).
 */
export type SplitProblemReason =
  | "no-uid"
  | "invalid"
  | "unterminated"
  | "duplicate"
  | "several-masters"
  | "mixed-kinds"
  | "joined-line"
  | "dropped-line"
  | "invalid-zone"
  | "invalid-property";

export interface SplitProblem {
  /** The component's place among the calendar's components, time zones too, from 0; -1 for the calendar's own properties. */
  readonly index: number;
  /** Its UID as written, a time zone's TZID, or none. */
  readonly uid: string | null;
  /** Its name, upper case: `VEVENT`, `VTIMEZONE`, `VCALENDAR` for the calendar's own properties. */
  readonly component: string;
  readonly reason: SplitProblemReason;
  /** Whether what it says is among the objects all the same. */
  readonly kept: boolean;
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
 * throws `NotCalendarError`. Inside it, trouble is a part's own
 * (`SplitProblem`): a component that cannot be read, or whose END never
 * came, costs that component and no other; a second master or another kind
 * under a UID taken is kept under `<UID>-2`; a component given twice is
 * kept once.
 */
export function splitCalendar(text: string): SplitCalendar {
  const calendars = calendarsOf(lines(text), true);
  if (calendars.length !== 1) throw new NotCalendarError("The text is not one VCALENDAR.");
  return splitOne(calendars[0]!, null);
}

/**
 * Splits a file from the device (import.md D267), forgiving besides what
 * `splitCalendar` forgives several `VCALENDAR`s one after another, lines
 * outside them and a file cut short (what came whole is kept); a component
 * with no UID, or one that had to leave its UID, gets `newUid()`. A text
 * with no `VCALENDAR` throws `NotCalendarError`.
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
const CONTENT_LINE = /^([A-Za-z0-9-]+)[;:]/;

/** The properties of RFC 5545 and its extensions (RFC 7986, 9073, 9074, 6638), and BEGIN and END. */
const PROPERTIES = new Set(
  (
    "BEGIN END VERSION PRODID CALSCALE METHOD NAME DESCRIPTION UID LAST-MODIFIED URL " +
    "REFRESH-INTERVAL SOURCE COLOR IMAGE CONFERENCE ATTACH CATEGORIES CLASS COMMENT GEO " +
    "LOCATION PERCENT-COMPLETE PRIORITY RESOURCES STATUS SUMMARY COMPLETED DTEND DUE " +
    "DTSTART DURATION FREEBUSY TRANSP TZID TZNAME TZOFFSETFROM TZOFFSETTO TZURL TZUNTIL " +
    "TZID-ALIAS-OF ATTENDEE CONTACT ORGANIZER RECURRENCE-ID RELATED-TO EXDATE RDATE RRULE " +
    "EXRULE ACTION REPEAT TRIGGER CREATED DTSTAMP SEQUENCE REQUEST-STATUS ACKNOWLEDGED " +
    "PROXIMITY STRUCTURED-DATA STYLED-DESCRIPTION LOCATION-TYPE CALENDAR-ADDRESS " +
    "PARTICIPANT-TYPE BUSYTYPE"
  ).split(" "),
);

/** Properties whose value is free text, where a line break written as is belongs (RFC 5545 §3.3.11). */
const TEXT = new Set(["SUMMARY", "DESCRIPTION", "LOCATION", "COMMENT", "CONTACT", "RESOURCES"]);
const isText = (name: string) => TEXT.has(name) || name.startsWith("X-");

/** A line of the file, folds apart; `note` says what was done to it. */
interface Line {
  text: string;
  /** `joined`: a line broken without folding was added to it; `dropped`: a stray line, left out. */
  note: "joined" | "dropped" | null;
}

/**
 * The text's lines, folds kept: a byte order mark, LF or CR line ends and
 * blank lines forgiven. A line that is no property of the calendar's
 * (a name not one of iCalendar's, upper case, or no name at all) after a
 * text value is that value's next line, broken without folding (Outlook's
 * descriptions, "Dial-in: 555 0100"): joined to it as the line break it
 * meant. Anywhere else it is a stray line, left out. Either is noted.
 */
function lines(text: string): Line[] {
  const result: Line[] = [];
  /** The last line a property starts on, and its name. */
  let last: { line: Line; name: string } | null = null;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    if (raw.trim() === "") continue;
    if (/^[ \t]/.test(raw)) {
      // A fold: the line before goes on. After a stray line it is stray too.
      if (result.at(-1)?.note === "dropped") result.push({ text: raw, note: "dropped" });
      else if (last) last.line.text += `\r\n${raw}`;
      else result.push({ text: raw, note: "dropped" });
      continue;
    }
    const name = CONTENT_LINE.exec(raw)?.[1];
    const afterText = last !== null && isText(last.name);
    const known =
      name !== undefined &&
      name === name.toUpperCase() &&
      (PROPERTIES.has(name) || name.startsWith("X-"));
    if (name !== undefined && (known || !afterText)) {
      const line: Line = { text: raw, note: null };
      result.push(line);
      last = { line, name: name.toUpperCase() };
    } else if (afterText) {
      last!.line.text += `\\n${raw}`;
      last!.line.note = "joined";
    } else {
      result.push({ text: raw, note: "dropped" });
    }
  }
  return result;
}

/** A component of a calendar file: its place, its name and, if it could be read, itself. */
interface Part {
  readonly index: number;
  readonly name: string;
  /** Its UID (or TZID) as written, for a problem's sake when it cannot be read. */
  readonly uid: string | null;
  readonly component: ICAL.Component | null;
  readonly whole: boolean;
  readonly notes: readonly ("joined" | "dropped")[];
}

interface Calendar {
  readonly root: ICAL.Component;
  readonly zones: readonly Part[];
  readonly parts: readonly Part[];
  readonly problems: readonly SplitProblem[];
}

/** A component's lines; `whole` once its END came. */
interface Block {
  readonly name: string;
  readonly lines: string[];
  readonly notes: ("joined" | "dropped")[];
  whole: boolean;
}

const BEGIN = /^BEGIN:([A-Za-z0-9-]+)[ \t]*$/i;
const END = /^END:([A-Za-z0-9-]+)[ \t]*$/i;

/** The components a calendar holds at its top: one of them begun inside another means that one never ended. */
const TOP = new Set(["VEVENT", "VTODO", "VJOURNAL", "VFREEBUSY", "VTIMEZONE", "VAVAILABILITY"]);

/**
 * The text's `VCALENDAR`s, each component read on its own, so a value
 * ical.js refuses (an `RRULE` it does not know) costs that component only;
 * a component whose END never came ends where the next one begins, or the
 * calendar ends. `strict`: a line outside a calendar or a calendar cut short
 * throws.
 */
function calendarsOf(content: readonly Line[], strict: boolean): Calendar[] {
  const calendars: Calendar[] = [];
  let header: Line[] | null = null;
  let blocks: Block[] = [];
  let block: Block | null = null;
  const close = () => {
    if (header) calendars.push(calendarOf(header, blocks));
    header = null;
    blocks = [];
    block = null;
  };
  for (const line of content) {
    const begin = BEGIN.exec(line.text)?.[1]?.toUpperCase();
    const end = END.exec(line.text)?.[1]?.toUpperCase();
    if (!header) {
      if (begin === "VCALENDAR") header = [];
      else if (strict) throw new NotCalendarError("The text has a line outside a VCALENDAR.");
      continue;
    }
    if (block) {
      if (line.note) block.notes.push(line.note);
      if (line.note === "dropped") continue;
      if (end === block.name) {
        block.lines.push(line.text);
        block.whole = true;
        block = null;
        continue;
      }
      if (!(end === "VCALENDAR" || (begin !== undefined && TOP.has(begin)))) {
        block.lines.push(line.text);
        continue;
      }
      // Its END never came: it ends here, and the line is the calendar's.
      block = null;
    }
    if (end === "VCALENDAR") close();
    else if (begin) {
      block = { name: begin, lines: [line.text], notes: [], whole: false };
      blocks.push(block);
    } else header.push(line);
  }
  if (header) {
    if (strict) throw new NotCalendarError("The VCALENDAR is cut short.");
    // Cut short: what came whole is read, the component cut is not.
    close();
  }
  return calendars;
}

const wrap = (body: readonly string[]) =>
  ["BEGIN:VCALENDAR", ...body, "END:VCALENDAR"].join("\r\n");

function calendarOf(header: readonly Line[], blocks: readonly Block[]): Calendar {
  const problems: SplitProblem[] = [];
  const own = (reason: SplitProblemReason, uid: string | null = null, kept = true) =>
    problems.push({ index: -1, uid, component: "VCALENDAR", reason, kept });
  for (const line of header)
    if (line.note) own(line.note === "joined" ? "joined-line" : "dropped-line");
  const properties = header.filter((line) => line.note !== "dropped").map((line) => line.text);
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(wrap(properties)) as unknown[]);
  } catch {
    // Each property on its own: what can be read is kept, the rest named.
    root = new ICAL.Component("vcalendar");
    for (const property of properties) {
      try {
        const read = new ICAL.Component(ICAL.parse(wrap([property])) as unknown[]);
        for (const one of read.getAllProperties()) root.addProperty(one);
      } catch {
        own("invalid-property", CONTENT_LINE.exec(property)?.[1]?.toUpperCase() ?? null, false);
      }
    }
  }
  // ical.js reads most values when first asked: asked now, what cannot be read is named.
  for (const property of root.getAllProperties()) {
    try {
      property.getValues();
    } catch {
      root.removeProperty(property);
      own("invalid-property", property.name.toUpperCase(), false);
    }
  }
  const zones: Part[] = [];
  const parts: Part[] = [];
  blocks.forEach(({ name, lines: block, whole, notes }, index) => {
    let component: ICAL.Component | null = null;
    try {
      if (whole) {
        component =
          new ICAL.Component(ICAL.parse(wrap(block)) as unknown[]).getAllSubcomponents()[0] ?? null;
      }
    } catch {
      // Left unread: a problem of its own.
    }
    const id = name === "VTIMEZONE" ? /^TZID[;:]/i : /^UID[;:]/i;
    const uid = block.find((line) => id.test(line))?.replace(/^[^:]*:/, "") || null;
    (name === "VTIMEZONE" ? zones : parts).push({ index, name, uid, component, whole, notes });
  });
  return { root, zones, parts, problems };
}

const CALENDAR_ONLY = new Set(["method"]);

/** One object's components, under its UID. */
interface Group {
  readonly uid: string;
  readonly index: number;
  readonly components: ICAL.Component[];
}

function splitOne(calendar: Calendar, newUid: (() => string) | null): SplitCalendar {
  const { root } = calendar;
  // Every property of the calendar goes with each object but METHOD, which a
  // calendar object resource must not have (RFC 4791 §4.1).
  const header = root
    .getAllProperties()
    .filter((property) => !CALENDAR_ONLY.has(property.name))
    .map((property) => property.toJSON());
  const problems: SplitProblem[] = [...calendar.problems];
  const problem = (
    part: { index: number; name: string },
    uid: string | null,
    reason: SplitProblemReason,
    kept: boolean,
  ) => problems.push({ index: part.index, uid, component: part.name, reason, kept });

  const zones = new Map<string, ICAL.Component>();
  for (const zone of calendar.zones) {
    const tzid = zone.component?.getFirstPropertyValue("tzid");
    if (typeof tzid === "string") {
      if (!zones.has(tzid)) zones.set(tzid, zone.component!);
    } else problem(zone, zone.uid, zone.whole ? "invalid-zone" : "unterminated", false);
  }

  const groups = new Map<string, Group>();
  /** Objects of their own under a new UID: a second master, another kind. */
  const apart: Group[] = [];
  /** A UID for what had to leave its own: the caller's, else the same on every run. */
  const taken = new Map<string, number>();
  const another = (uid: string) => {
    if (newUid) return newUid();
    const n = (taken.get(uid) ?? 1) + 1;
    taken.set(uid, n);
    return `${uid}-${n}`;
  };
  for (const part of calendar.parts) {
    const { component } = part;
    if (!component) {
      problem(part, part.uid, part.whole ? "invalid" : "unterminated", false);
      continue;
    }
    for (const note of part.notes)
      problem(part, part.uid, note === "joined" ? "joined-line" : "dropped-line", true);
    let uid = component.getFirstPropertyValue("uid");
    if ((typeof uid !== "string" || uid === "") && newUid) {
      uid = newUid();
      component.updatePropertyWithValue("uid", uid);
    }
    if (typeof uid !== "string" || uid === "") {
      problem(part, null, "no-uid", false);
      continue;
    }
    const group = groups.get(uid);
    if (!group) {
      groups.set(uid, { uid, index: part.index, components: [component] });
      continue;
    }
    const written = JSON.stringify(component.toJSON());
    if (group.components.some((other) => JSON.stringify(other.toJSON()) === written)) {
      problem(part, uid, "duplicate", true);
      continue;
    }
    const master = !component.hasProperty("recurrence-id");
    const reason =
      component.name !== group.components[0]!.name
        ? "mixed-kinds"
        : master && group.components.some((other) => !other.hasProperty("recurrence-id"))
          ? "several-masters"
          : null;
    if (!reason) {
      group.components.push(component);
      continue;
    }
    // Kept, as an object of its own: nothing the file says is lost (D272).
    problem(part, uid, reason, true);
    const own = another(uid);
    component.updatePropertyWithValue("uid", own);
    apart.push({ uid: own, index: part.index, components: [component] });
  }

  const objects: SplitObject[] = [];
  for (const { uid, index, components } of [...groups.values(), ...apart]) {
    const kind = components[0]!.name.toUpperCase();
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
        problems.push({ index, uid, component: kind, reason: "invalid", kept: false });
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
