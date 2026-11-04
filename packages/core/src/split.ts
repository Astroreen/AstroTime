// One iCalendar file split into calendar objects (RFC 4791 §4.1): a file
// imported from the device (docs/plans/import.md#D267) and a subscription's
// answer (docs/plans/providers.md#D251) hold a whole calendar, the store
// keeps one object per UID. A subpath of its own (`@astrotime/core/split`),
// so the app loads it with the code that needs it, never with the app; it
// imports the modules it needs, not the package's index.
import ICAL from "ical.js";

import { CalendarObject, writeCalendar } from "./calendar-object.ts";
import { colorNameHex, hexColor } from "./colors.ts";
import { vtimezone } from "./vtimezone.ts";

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
 * it). `unterminated`: its `END` never came; kept when what came reads
 * whole. Among them all the same (`kept`): `duplicate` (the same component twice under one UID: one is
 * kept), `several-masters` and `mixed-kinds` (a second master, or a
 * component of another kind, under a UID taken: it becomes an object of its
 * own under a new UID), `joined-line` (a line broken without folding,
 * joined to the text value before it), `dropped-line` (a stray line that
 * belongs to no value, left out), `ambiguous-line` (after a text value, a
 * line that reads as a property iCalendar does not name, "Meeting-ID:123":
 * kept as that property), `stray-end` (an `END` with no `BEGIN`, left
 * out). Of the calendar itself: `invalid-zone` (a `VTIMEZONE` that cannot
 * be read: the objects naming it go without it, and their times are read
 * from the TZID, foundation D32), `conflicting-zone` (a second, different
 * definition of a TZID: the objects take the first) and `invalid-property`
 * (a calendar property that cannot be read, left out).
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
  | "ambiguous-line"
  | "stray-end"
  | "conflicting-zone"
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

/**
 * A content line's start (RFC 5545 §3.1): a name, an iana-token or an
 * x-name (letters, digits, "-", in any case), then its parameters or its
 * value. Any line that starts so is a property, known to AstroTime or not
 * (D7).
 */
const CONTENT_LINE = /^([A-Za-z0-9-]+)[;:]/;

/**
 * The names of RFC 5545's properties and its extensions' (RFC 7986, 7808,
 * 7953, 9073, 9074, 9253, the draft's ESTIMATED-DURATION), and BEGIN and
 * END: only to tell a line that may be a text value's from one that is
 * surely a property. Every content line is kept as a property either way.
 */
const KNOWN = new Set(
  (
    "BEGIN END VERSION PRODID CALSCALE METHOD NAME DESCRIPTION UID LAST-MODIFIED URL " +
    "REFRESH-INTERVAL SOURCE COLOR IMAGE CONFERENCE ATTACH CATEGORIES CLASS COMMENT GEO " +
    "LOCATION PERCENT-COMPLETE PRIORITY RESOURCES STATUS SUMMARY COMPLETED DTEND DUE " +
    "DTSTART DURATION FREEBUSY TRANSP TZID TZNAME TZOFFSETFROM TZOFFSETTO TZURL TZUNTIL " +
    "TZID-ALIAS-OF ATTENDEE CONTACT ORGANIZER RECURRENCE-ID RELATED-TO EXDATE RDATE RRULE " +
    "EXRULE ACTION REPEAT TRIGGER CREATED DTSTAMP SEQUENCE REQUEST-STATUS ACKNOWLEDGED " +
    "PROXIMITY STRUCTURED-DATA STYLED-DESCRIPTION LOCATION-TYPE CALENDAR-ADDRESS " +
    "PARTICIPANT-TYPE RESOURCE-TYPE BUSYTYPE LINK CONCEPT REFID ESTIMATED-DURATION"
  ).split(" "),
);

/** What was done to a line: joined to it, left out, or kept as a property that may not be one. */
type Note = "joined" | "dropped" | "ambiguous" | "end";
const NOTED = {
  joined: "joined-line",
  dropped: "dropped-line",
  ambiguous: "ambiguous-line",
  end: "stray-end",
} as const satisfies Record<Note, SplitProblemReason>;

/** Properties whose value is free text, where a line break written as is belongs (RFC 5545 §3.3.11). */
const TEXT = new Set(["SUMMARY", "DESCRIPTION", "LOCATION", "COMMENT", "CONTACT", "RESOURCES"]);
const isText = (name: string) => TEXT.has(name) || name.startsWith("X-");

/** A line of the file, folds apart; `note` says what was done to it. */
interface Line {
  text: string;
  /** `joined`: a line broken without folding was added to it; `dropped`: a stray line, left out. */
  note: Note | null;
}

/**
 * The text's lines, folds kept: a byte order mark, LF or CR line ends and
 * blank lines forgiven. A line that is no content line (`CONTENT_LINE`)
 * after a text value is that value's next line, broken without folding
 * (Outlook's descriptions: "PIN 1234", "Dial in: 555 0100"): joined to it
 * as the line break it meant. Anywhere else it is a stray line, left out.
 * Either is noted.
 */
function lines(text: string): Line[] {
  const result: Line[] = [];
  /** The last line a property starts on, which a fold goes on. */
  let last: Line | null = null;
  /** The text value a line broken without folding goes on: the last, past lines that may be its. */
  let value: Line | null = null;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/)) {
    if (raw.trim() === "") continue;
    if (/^[ \t]/.test(raw)) {
      // A fold: the line before goes on. After a stray line it is stray too.
      if (result.at(-1)?.note === "dropped" || !last) result.push({ text: raw, note: "dropped" });
      else last.text += `\r\n${raw}`;
      continue;
    }
    const name = CONTENT_LINE.exec(raw)?.[1]?.toUpperCase();
    if (name !== undefined) {
      // After a text value, a name iCalendar does not have may be that
      // value's line ("Meeting-ID:123"): kept as the property it reads as, and said.
      const ambiguous = value !== null && !KNOWN.has(name) && !name.startsWith("X-");
      const line: Line = { text: raw, note: ambiguous ? "ambiguous" : null };
      result.push(line);
      last = line;
      if (!ambiguous) value = isText(name) ? line : null;
    } else if (value) {
      value.text += `\\n${raw}`;
      if (!value.note) value.note = "joined";
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
  readonly notes: readonly Note[];
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
  readonly notes: Note[];
  whole: boolean;
  /** Cut by the file's end, not by the next component. */
  atEnd?: boolean;
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
    } else if (end) {
      // An END with no BEGIN before it: said as one, not read as a property.
      header.push({ text: line.text, note: "end" });
    } else header.push(line);
  }
  if (header) {
    if (strict) throw new NotCalendarError("The VCALENDAR is cut short.");
    // Cut short: what came whole is read, the component cut is not.
    if (block) (block as Block).atEnd = true;
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
  for (const line of header) if (line.note) own(NOTED[line.note]);
  const properties = header
    .filter((line) => line.note !== "dropped" && line.note !== "end")
    .map((line) => line.text);
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(wrap(properties)) as unknown[]);
  } catch {
    // Each property on its own: what can be read is kept, the rest named.
    root = new ICAL.Component("vcalendar");
    for (const property of properties) {
      try {
        const read = new ICAL.Component(ICAL.parse(wrap([property])) as unknown[]);
        for (const one of read.getAllProperties().slice()) root.addProperty(one);
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
  blocks.forEach(({ name, lines: block, whole, atEnd, notes }, index) => {
    let component: ICAL.Component | null = null;
    try {
      // One whose END never came but whose next one began is read as if it
      // had: what it says may be whole. Cut by the file's end, its last line may not be.
      if (whole || !atEnd) {
        const body = whole ? block : [...block, `END:${name}`];
        component =
          new ICAL.Component(ICAL.parse(wrap(body)) as unknown[]).getAllSubcomponents()[0] ?? null;
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

  // A TZID defined twice: the first definition is the one every object
  // takes, the same on every run; a different second one is said.
  const zones = new Map<string, ICAL.Component>();
  for (const zone of calendar.zones) {
    const tzid = zone.component?.getFirstPropertyValue("tzid");
    if (typeof tzid !== "string") {
      problem(zone, zone.uid, zone.whole ? "invalid-zone" : "unterminated", false);
      continue;
    }
    if (!zone.whole) problem(zone, tzid, "unterminated", true);
    const first = zones.get(tzid);
    if (!first) zones.set(tzid, zone.component!);
    else if (canonical(first) !== canonical(zone.component!))
      problem(zone, tzid, "conflicting-zone", false);
  }

  const groups = new Map<string, Group>();
  /** Objects of their own under a new UID: a second master, another kind. */
  const apart: Group[] = [];
  /** Per UID of the file, the objects that left it, and every component seen under it. */
  const families = new Map<string, { apart: Group[]; seen: Set<string> }>();
  /** Every UID of the file, so one made for what left its own is none of them. */
  const uids = new Set(
    calendar.parts.map((part) => part.component?.getFirstPropertyValue("uid")).filter(Boolean),
  );
  /** A UID for what had to leave its own: the caller's, else the same on every run. */
  const another = (uid: string) => {
    if (newUid) return newUid();
    let n = 2;
    while (uids.has(`${uid}-${n}`)) n++;
    uids.add(`${uid}-${n}`);
    return `${uid}-${n}`;
  };
  const isMaster = (component: ICAL.Component) => !component.hasProperty("recurrence-id");
  /** Each component's place in the file, for a problem of its own. */
  const placeOf = new Map<ICAL.Component, number>();
  for (const part of calendar.parts) {
    const { component } = part;
    if (!component) {
      problem(part, part.uid, part.whole ? "invalid" : "unterminated", false);
      continue;
    }
    placeOf.set(component, part.index);
    if (!part.whole) problem(part, part.uid, "unterminated", true);
    for (const note of part.notes) problem(part, part.uid, NOTED[note], true);
    let uid = component.getFirstPropertyValue("uid");
    if ((typeof uid !== "string" || uid === "") && newUid) {
      uid = newUid();
      component.updatePropertyWithValue("uid", uid);
    }
    if (typeof uid !== "string" || uid === "") {
      problem(part, null, "no-uid", false);
      continue;
    }
    const written = JSON.stringify(component.toJSON());
    const group = groups.get(uid);
    if (!group) {
      groups.set(uid, { uid, index: part.index, components: [component] });
      families.set(uid, { apart: [], seen: new Set([written]) });
      continue;
    }
    const family = families.get(uid)!;
    // Given twice, under its own UID or as one that left it: kept once.
    if (family.seen.has(written)) {
      problem(part, uid, "duplicate", true);
      continue;
    }
    family.seen.add(written);
    // Its object: the first of its kind that takes it (an exception, or a
    // master where there is none yet), the file's own first.
    const home = [group, ...family.apart].find(
      (one) =>
        one.components[0]!.name === component.name &&
        (!isMaster(component) || !one.components.some(isMaster)),
    );
    const reason = component.name !== group.components[0]!.name ? "mixed-kinds" : "several-masters";
    if (home === group) {
      group.components.push(component);
      continue;
    }
    // Kept, as an object of its own: nothing the file says is lost (D272).
    problem(part, uid, reason, true);
    if (home) {
      component.updatePropertyWithValue("uid", home.uid);
      home.components.push(component);
      continue;
    }
    const own = { uid: another(uid), index: part.index, components: [component] };
    component.updatePropertyWithValue("uid", own.uid);
    family.apart.push(own);
    apart.push(own);
  }

  const objects: SplitObject[] = [];
  const textOfObject = (components: readonly ICAL.Component[]) => {
    const used = new Set(components.flatMap(tzidsOf));
    const own = [...zones].filter(([tzid]) => used.has(tzid)).map(([, zone]) => zone.toJSON());
    return writeCalendar(
      new ICAL.Component([
        "vcalendar",
        header,
        [...own, ...components.map((component) => component.toJSON())],
      ]),
    );
  };
  const readable = (ics: string) => {
    try {
      CalendarObject.parse(ics);
      return true;
    } catch {
      // What ical.js cannot read of a value throws its own errors, not only ours.
      return false;
    }
  };
  // In the order the file gives them, a UID's first component's place.
  for (const { uid, components: all } of [...groups.values(), ...apart].toSorted(
    (a, b) => a.index - b.index,
  )) {
    const kind = all[0]!.name.toUpperCase();
    let components = all;
    if ((kind === "VEVENT" || kind === "VTODO") && !readable(textOfObject(all))) {
      // One unreadable exception costs itself, not its series: each read alone.
      const unread = all.filter((component) => !readable(textOfObject([component])));
      for (const component of unread) {
        problems.push({
          index: placeOf.get(component)!,
          uid,
          component: kind,
          reason: "invalid",
          kept: false,
        });
      }
      components = all.filter((component) => !unread.includes(component));
      if (components.length > 0 && !readable(textOfObject(components))) {
        for (const component of components) {
          problems.push({
            index: placeOf.get(component)!,
            uid,
            component: kind,
            reason: "invalid",
            kept: false,
          });
        }
        components = [];
      }
      if (components.length === 0) continue;
    }
    objects.push({ uid, kind, ics: textOfObject(components) });
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

/** What an occurrence says, its bookkeeping (`SEQUENCE`, `DTSTAMP`, `LAST-MODIFIED`) aside. */
function meaning(component: ICAL.Component): string {
  const copy = new ICAL.Component(JSON.parse(JSON.stringify(component.toJSON())) as unknown[]);
  for (const name of ["sequence", "dtstamp", "last-modified"]) copy.removeAllProperties(name);
  return canonical(copy);
}

/**
 * A component's meaning as one string: its properties and subcomponents in
 * an order of their own, so two definitions written in another order (a
 * `VTIMEZONE`'s observances, its lines) compare the same.
 */
function canonical(component: ICAL.Component): string {
  const [name, properties, components] = component.toJSON() as [string, unknown[], unknown[]];
  const sorted = (items: readonly string[]) => items.toSorted().join("|");
  return JSON.stringify([
    name,
    sorted(properties.map((property) => JSON.stringify(property))),
    sorted(components.map((child) => canonical(new ICAL.Component(child as unknown[])))),
  ]);
}

/**
 * An object's text with every component under another UID: an imported
 * item kept as a copy beside the one already there (import.md D270). A
 * `RELATED-TO` naming a UID in `related` (another item copied with it, a
 * subtask's parent) names its copy instead.
 */
export function withUid(
  ics: string,
  uid: string,
  related: ReadonlyMap<string, string> = new Map(),
): string {
  const root = new ICAL.Component(ICAL.parse(ics) as unknown[]);
  for (const component of root.getAllSubcomponents()) {
    if (component.name === "vtimezone") continue;
    component.updatePropertyWithValue("uid", uid);
    for (const property of component.getAllProperties("related-to")) {
      const copy = related.get(String(property.getFirstValue()));
      if (copy) property.setValue(copy);
    }
  }
  return writeCalendar(root);
}

/**
 * The file's object over the one stored (import.md D270, "Use the file's version").
 * The file says what the item is: every property and component iCalendar
 * names (its times, `DTEND` or `DURATION`, its rule, its exceptions, its
 * guests) is the file's, and what the file leaves out is gone. The stored
 * copy gives only what a file from another app cannot know of it
 * (foundation D7): its `X-` properties the file does not have, and its
 * alarms and its attachments when the file has none of them. An exception
 * the file does not have goes: the file's series is the series.
 */
export function overlay(stored: string, incoming: string): string {
  const base = new ICAL.Component(ICAL.parse(stored) as unknown[]);
  const over = new ICAL.Component(ICAL.parse(incoming) as unknown[]);
  const occurrence = (component: ICAL.Component) =>
    `${component.name}|${component.getFirstProperty("recurrence-id")?.toICALString() ?? ""}`;
  const old = new Map(
    base
      .getAllSubcomponents()
      .filter((component) => component.name !== "vtimezone")
      .map((component) => [occurrence(component), component] as const),
  );
  // Copies of ical.js's lists (`slice`): adding an item to one component takes it from the other.
  for (const component of over.getAllSubcomponents().slice()) {
    if (component.name === "vtimezone") continue;
    const before = old.get(occurrence(component));
    if (!before) continue;
    // What it said, read before what it keeps moves over to the file's.
    const was = meaning(before);
    const has = new Set(component.getAllProperties().map((property) => property.name));
    for (const property of before.getAllProperties().slice()) {
      const keep =
        (property.name.startsWith("x-") && !has.has(property.name)) ||
        (property.name === "attach" && !has.has("attach"));
      if (keep) component.addProperty(property);
    }
    if (component.getAllSubcomponents("valarm").length === 0)
      for (const alarm of before.getAllSubcomponents("valarm").slice())
        component.addSubcomponent(alarm);
    // SEQUENCE past both versions' where the occurrence changed, so a
    // scheduling client sees it as newer (RFC 5546 §2.1.4); one the file
    // gives again as it was keeps the stored one's.
    const sequence = (one: ICAL.Component) =>
      Number(one.getFirstPropertyValue("sequence") ?? 0) || 0;
    if (meaning(component) !== was)
      component.updatePropertyWithValue(
        "sequence",
        Math.max(sequence(before), sequence(component)) + 1,
      );
    else if (before.hasProperty("sequence"))
      component.updatePropertyWithValue("sequence", sequence(before));
    else component.removeAllProperties("sequence");
  }
  // A zone the result names that the file does not define: the stored one's.
  const defined = new Set(
    over.getAllSubcomponents("vtimezone").map((zone) => String(zone.getFirstPropertyValue("tzid"))),
  );
  const named = new Set(over.getAllSubcomponents().flatMap(tzidsOf));
  for (const zone of base.getAllSubcomponents("vtimezone").slice()) {
    const tzid = String(zone.getFirstPropertyValue("tzid"));
    if (named.has(tzid) && !defined.has(tzid)) over.addSubcomponent(zone);
  }
  return writeCalendar(over);
}

/**
 * A `VTIMEZONE` for an IANA zone, as text, its observances from the year
 * before `year` (foundation D104): for a converted file whose local times
 * are written in it (a vCalendar's, a CSV's), so each object defines the
 * zone it names.
 */
export function zoneText(timeZone: string, year: number): string {
  return vtimezone(timeZone, year).toString();
}
