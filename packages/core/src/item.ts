import ICAL from "ical.js";

import { attachmentsOf, type Attachment } from "./attachments.ts";
import { hexColor, nearestColorName } from "./colors.ts";
import { fromIcalTime, keepTzid, type ItemTime } from "./time.ts";

/** A reminder (`VALARM`). */
export interface Alarm {
  readonly action: string;
  readonly description: string | null;
  /** Relative to the item's start or end (`TRIGGER;RELATED=…`), or at a time. */
  readonly trigger:
    | {
        readonly type: "relative";
        readonly relatedTo: "start" | "end";
        readonly offsetSeconds: number;
        /**
         * The weeks and days of the offset, in days, also counted in
         * `offsetSeconds`: RFC 5545 §3.3.6 makes them days of the wall clock,
         * so `-P1D` before a time keeps that time across a DST change.
         */
        readonly offsetDays: number;
      }
    | { readonly type: "absolute"; readonly at: ItemTime };
  /** `REPEAT`: how many more times it fires, every `repeatEverySeconds`; 0 without both. */
  readonly repeat: number;
  /** `DURATION` between repeats; `null` without `REPEAT` and a positive `DURATION`. */
  readonly repeatEverySeconds: number | null;
  /** RFC 9074 `UID`, which identifies the alarm across edits. */
  readonly uid: string | null;
  /**
   * When it was last acknowledged: its RFC 9074 `ACKNOWLEDGED` (Apple), or
   * the item's `X-MOZ-LASTACK` (Thunderbird), whichever is later.
   */
  readonly acknowledged: ItemTime | null;
}

/** A point on the map, WGS-84 degrees (RFC 5545 `GEO`). */
export interface Geo {
  readonly lat: number;
  readonly lon: number;
}

/** An `ATTENDEE` or the `ORGANIZER`. */
export interface Participant {
  /** The calendar user address, usually `mailto:…`. */
  readonly address: string;
  readonly name: string | null;
  readonly role: string | null;
  readonly status: string | null;
}

interface ItemFields {
  readonly uid: string;
  /** Set on an exception: the occurrence of the series it replaces. */
  readonly recurrenceId: ItemTime | null;
  readonly summary: string | null;
  readonly description: string | null;
  readonly location: string | null;
  /**
   * Where `location` is on the map: `GEO`, or Apple's
   * `X-APPLE-STRUCTURED-LOCATION`; none when another client changed the
   * place and kept the old one's point (foundation D176).
   */
  readonly geo: Geo | null;
  /**
   * The place's name and address as Apple's structured location names them
   * (`X-TITLE`, `X-ADDRESS`), beside its point; null without (D176).
   */
  readonly placeLabel: { readonly name: string; readonly address: string } | null;
  readonly status: string | null;
  readonly categories: readonly string[];
  /** `CLASS`: PUBLIC, PRIVATE, CONFIDENTIAL. */
  readonly classification: string | null;
  /**
   * The item's own colour: AstroTime's exact one (`X-ASTROTIME-COLOR`, a
   * hex) while RFC 7986 `COLOR` is still its nearest name, else `COLOR`, a
   * CSS colour name (D174).
   */
  readonly color: string | null;
  readonly url: string | null;
  readonly sequence: number;
  readonly created: ItemTime | null;
  readonly lastModified: ItemTime | null;
  /** Whether the item has `RRULE` or `RDATE`. */
  readonly recurring: boolean;
  readonly alarms: readonly Alarm[];
  /** `ATTACH`: links and inline files (foundation D229). */
  readonly attachments: readonly Attachment[];
}

/** A `VEVENT` (GLOSSARY.md: Event). */
export interface Event extends ItemFields {
  readonly kind: "event";
  readonly start: ItemTime | null;
  /** `DTEND`, or `DTSTART` + `DURATION`, or the RFC 5545 default. Exclusive. */
  readonly end: ItemTime | null;
  /** `TRANSP:TRANSPARENT`: the event does not block time. */
  readonly transparent: boolean;
  readonly organizer: Participant | null;
  readonly attendees: readonly Participant[];
}

/** A `VTODO` (GLOSSARY.md: Task). */
export interface Task extends ItemFields {
  readonly kind: "task";
  readonly start: ItemTime | null;
  /** `DUE`, or `DTSTART` + `DURATION`. */
  readonly due: ItemTime | null;
  readonly completed: ItemTime | null;
  readonly percentComplete: number | null;
  /** 1 (highest) to 9 (lowest); `PRIORITY:0` means none and reads as `null`. */
  readonly priority: number | null;
  /** The parent task's UID (`RELATED-TO`, `RELTYPE=PARENT` or no RELTYPE). */
  readonly parentUid: string | null;
  /** `X-APPLE-SORT-ORDER`, which Nextcloud Tasks and Tasks.org also write. */
  readonly sortOrder: number | null;
  /** `X-OC-HIDESUBTASKS`: Nextcloud Tasks folds the subtasks away. */
  readonly hideSubtasks: boolean;
  /** `X-ASTROTIME-STARRED:TRUE`: starred on the tasks screen (design D52). */
  readonly starred: boolean;
}

export type Item = Event | Task;

function text(component: ICAL.Component, name: string): string | null {
  const value = component.getFirstPropertyValue(name);
  return typeof value === "string" ? value : null;
}

/** The exact colour while `COLOR` still names it (D174), else `COLOR`. */
function colorOf(component: ICAL.Component): string | null {
  const named = text(component, "color");
  const exact = hexColor(text(component, X_COLOR) ?? "");
  if (exact && named?.trim().toLowerCase() === nearestColorName(exact)) return exact;
  return named;
}

/** AstroTime's exact colour of an item, beside its `COLOR` (D174). */
export const X_COLOR = "x-astrotime-color";

function integer(component: ICAL.Component, name: string): number | null {
  const value = component.getFirstPropertyValue(name);
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function time(component: ICAL.Component, name: string): ItemTime | null {
  const value = component.getFirstPropertyValue(name);
  return value instanceof ICAL.Time ? fromIcalTime(value) : null;
}

function participant(property: ICAL.Property): Participant {
  const param = (name: string) => {
    const value = property.getParameter(name);
    return typeof value === "string" ? value : null;
  };
  return {
    address: String(property.getFirstValue()),
    name: param("cn"),
    role: param("role"),
    status: param("partstat"),
  };
}

function alarm(component: ICAL.Component, lastAck: ItemTime | null): Alarm {
  const property = component.getFirstProperty("trigger");
  const value = property?.getFirstValue();
  const trigger: Alarm["trigger"] =
    value instanceof ICAL.Time
      ? { type: "absolute", at: fromIcalTime(value) }
      : {
          type: "relative",
          relatedTo:
            String(property?.getParameter("related") ?? "").toUpperCase() === "END"
              ? "end"
              : "start",
          offsetSeconds: value instanceof ICAL.Duration ? value.toSeconds() : 0,
          offsetDays:
            value instanceof ICAL.Duration
              ? (value.isNegative ? -1 : 1) * (value.weeks * 7 + value.days) || 0
              : 0,
        };
  const repeat = integer(component, "repeat") ?? 0;
  const every = component.getFirstPropertyValue("duration");
  const everySeconds = every instanceof ICAL.Duration ? every.toSeconds() : 0;
  const repeats = repeat > 0 && everySeconds > 0;
  const acknowledged = utcTime(component, "acknowledged");
  return {
    action: text(component, "action") ?? "DISPLAY",
    description: text(component, "description"),
    trigger,
    repeat: repeats ? repeat : 0,
    repeatEverySeconds: repeats ? everySeconds : null,
    uid: text(component, "uid"),
    acknowledged: later(acknowledged, lastAck),
  };
}

/**
 * A UTC time ical.js reads as text: RFC 9074's `ACKNOWLEDGED`, which it does
 * not know yet, and Thunderbird's `X-MOZ-LASTACK`.
 */
function utcTime(component: ICAL.Component, name: string): ItemTime | null {
  const value = component.getFirstPropertyValue(name);
  if (value instanceof ICAL.Time) return fromIcalTime(value);
  const match = typeof value === "string" ? UTC_TIME.exec(value.trim()) : null;
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return {
    type: "zoned",
    local: `${y}-${mo}-${d}T${h}:${mi}:${s}`,
    timeZone: "UTC",
    epochMs: Date.UTC(+y!, +mo! - 1, +d!, +h!, +mi!, +s!),
  };
}

const UTC_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

/** The later of two times by instant (dates and floating times read in UTC; only a tie-break). */
function later(a: ItemTime | null, b: ItemTime | null): ItemTime | null {
  if (!a || !b) return a ?? b;
  return roughMs(b) > roughMs(a) ? b : a;
}

function roughMs(value: ItemTime): number {
  if (value.type === "zoned") return value.epochMs;
  return Date.parse(`${value.type === "date" ? `${value.date}T00:00:00` : value.local}Z`);
}

/** `start` + `duration`, keeping the TZID (`keepTzid`). */
export function plus(start: ICAL.Time, duration: ICAL.Duration): ICAL.Time {
  const result = start.clone();
  result.addDuration(duration);
  return keepTzid(start, result);
}

/** `start` + `DURATION`, when the component has a start and a duration. */
function startPlusDuration(component: ICAL.Component): ItemTime | null {
  const start = component.getFirstPropertyValue("dtstart");
  const duration = component.getFirstPropertyValue("duration");
  if (!(start instanceof ICAL.Time) || !(duration instanceof ICAL.Duration)) return null;
  return fromIcalTime(plus(start, duration));
}

/** RFC 5545 §3.6.1: no DTEND and no DURATION is one day for a date, zero for a time. */
function defaultEnd(component: ICAL.Component): ItemTime | null {
  const start = component.getFirstPropertyValue("dtstart");
  if (!(start instanceof ICAL.Time)) return null;
  if (!start.isDate) return fromIcalTime(start);
  return fromIcalTime(plus(start, ICAL.Duration.fromData({ days: 1 })));
}

function fields(component: ICAL.Component): ItemFields {
  return {
    uid: text(component, "uid") ?? "",
    recurrenceId: time(component, "recurrence-id"),
    summary: text(component, "summary"),
    description: text(component, "description"),
    location: text(component, "location"),
    ...placeOf(component),
    status: text(component, "status"),
    categories: component
      .getAllProperties("categories")
      .flatMap((property) => property.getValues().map(String)),
    classification: text(component, "class"),
    color: colorOf(component),
    url: text(component, "url"),
    sequence: integer(component, "sequence") ?? 0,
    created: time(component, "created"),
    lastModified: time(component, "last-modified"),
    recurring: component.hasProperty("rrule") || component.hasProperty("rdate"),
    alarms: component
      .getAllSubcomponents("valarm")
      .map((valarm) => alarm(valarm, utcTime(component, "x-moz-lastack"))),
    attachments: attachmentsOf(component),
  };
}

/**
 * A point on the globe, or none: off it, not a number, or exactly 0,0,
 * which some clients write for "no coordinates" (D176).
 */
export const point = (lat: unknown, lon: unknown): Geo | null => {
  const [a, b] = [Number(lat), Number(lon)];
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180)
    return null;
  return a === 0 && b === 0 ? null : { lat: a, lon: b };
};

/** Text compared as a reader sees it: case and runs of spaces aside. */
const loosely = (words: string) => words.replaceAll(/\s+/g, " ").trim().toLocaleLowerCase();

/** A point's two parts as text: none when either is empty, as in a cut-off "52.5;". */
const pointOf = (lat: string | undefined, lon: string | undefined): Geo | null =>
  lat?.trim() && lon?.trim() ? point(lat, lon) : null;

/**
 * The item's point and Apple's name for it (foundation D176). Apple's
 * structured location names the place it is for (`X-TITLE`): when
 * `LOCATION` no longer holds that name, case and spaces aside, another
 * client changed the place and kept the old point, so there is none, `GEO`
 * neither (AstroTime writes both). Apple's name and address go with Apple's
 * point only, never with a `GEO` read in its stead.
 */
function placeOf(component: ICAL.Component): Pick<Item, "geo" | "placeLabel"> {
  const apple = component.getFirstProperty("x-apple-structured-location");
  if (apple) {
    const title = apple.getParameter("x-title");
    const location = loosely(text(component, "location") ?? "");
    if (typeof title === "string" && loosely(title) && !location.includes(loosely(title)))
      return { geo: null, placeLabel: null };
    // RFC 5870: geo:lat,lon[,alt][;param…]; latitude and longitude alone count.
    const uri = /^geo:([^,;]*),([^,;]*)(?:,[^;]*)?(?:;.*)?$/i.exec(
      String(apple.getFirstValue() ?? ""),
    );
    const geo = uri ? pointOf(uri[1], uri[2]) : null;
    if (geo) {
      const address = apple.getParameter("x-address");
      const placeLabel =
        typeof title === "string" && title.trim()
          ? { name: title.trim(), address: typeof address === "string" ? address.trim() : "" }
          : null;
      return { geo, placeLabel };
    }
  }
  // A lone GEO is trusted as it is (D176); ical.js reads it as two
  // numbers, another value type as its text "lat;lon".
  const geo = component.getFirstPropertyValue("geo");
  const part = (value: unknown) =>
    typeof value === "number" || typeof value === "string" ? String(value) : undefined;
  const [lat, lon] = Array.isArray(geo)
    ? geo.map(part)
    : typeof geo === "string"
      ? geo.split(";")
      : [];
  return { geo: pointOf(lat, lon), placeLabel: null };
}

function parentUid(component: ICAL.Component): string | null {
  for (const property of component.getAllProperties("related-to")) {
    const type = property.getParameter("reltype");
    if (type === undefined || String(type).toUpperCase() === "PARENT")
      return String(property.getFirstValue());
  }
  return null;
}

/** Reads one `VEVENT` or `VTODO`. The component itself is never changed. */
export function readItem(component: ICAL.Component): Item {
  if (component.name === "vevent") {
    const organizer = component.getFirstProperty("organizer");
    return {
      kind: "event",
      ...fields(component),
      start: time(component, "dtstart"),
      end: time(component, "dtend") ?? startPlusDuration(component) ?? defaultEnd(component),
      transparent: text(component, "transp")?.toUpperCase() === "TRANSPARENT",
      organizer: organizer ? participant(organizer) : null,
      attendees: component.getAllProperties("attendee").map(participant),
    };
  }
  const priority = integer(component, "priority");
  return {
    kind: "task",
    ...fields(component),
    start: time(component, "dtstart"),
    due: time(component, "due") ?? startPlusDuration(component),
    completed: time(component, "completed"),
    percentComplete: integer(component, "percent-complete"),
    priority: priority === null || priority === 0 ? null : priority,
    parentUid: parentUid(component),
    sortOrder: integer(component, "x-apple-sort-order"),
    hideSubtasks: text(component, "x-oc-hidesubtasks") === "1",
    starred: text(component, "x-astrotime-starred")?.toUpperCase() === "TRUE",
  };
}
