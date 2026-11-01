import ICAL from "ical.js";

import { readItem, type Item } from "./item.ts";

const ITEM_COMPONENTS = ["vevent", "vtodo"] as const;

// ical.js folds after `foldLength` octets but counts a continuation line's
// leading space on top, so 75 writes 76-octet lines; RFC 5545 §3.1 allows 75.
const FOLD_LENGTH = 74;

/**
 * One calendar object resource (RFC 4791 §4.1): a `VCALENDAR` with the
 * components of one UID — a master and its exceptions — and their time zones.
 *
 * It keeps the parsed iCalendar whole, so `serialize` writes back every
 * property and parameter, including ones AstroTime does not understand
 * (docs/plans/foundation.md#D7, AGENTS.md rule 2).
 */
export class CalendarObject {
  readonly kind: Item["kind"];
  readonly uid: string;
  /** The item without `RECURRENCE-ID`; `null` when a server holds only exceptions. */
  readonly master: Item | null;
  /** Items with `RECURRENCE-ID`, each replacing one occurrence of the series. */
  readonly exceptions: readonly Item[];

  /** @internal The parsed iCalendar; only `@astrotime/core` reads it. */
  readonly root: ICAL.Component;
  /** @internal The components of `master` and `exceptions`, in the same order. */
  readonly components: {
    readonly master: ICAL.Component | null;
    readonly exceptions: readonly ICAL.Component[];
  };

  private constructor(root: ICAL.Component) {
    shareTimeZones(root);
    const items = ITEM_COMPONENTS.flatMap((name) => root.getAllSubcomponents(name));
    const first = items[0];
    if (!first) throw new CalendarObjectError("The calendar object has no VEVENT or VTODO.");
    if (items.some((component) => component.name !== first.name)) {
      throw new CalendarObjectError("The calendar object mixes VEVENT and VTODO.");
    }
    const uids = new Set(items.map((component) => component.getFirstPropertyValue("uid")));
    if (uids.has(null) || uids.has("")) throw new CalendarObjectError("A component has no UID.");
    if (uids.size !== 1)
      throw new CalendarObjectError("The calendar object holds more than one UID.");

    const masters = items.filter((component) => !component.hasProperty("recurrence-id"));
    if (masters.length > 1)
      throw new CalendarObjectError("The calendar object has more than one master.");
    const master = masters[0] ?? null;
    const exceptions = items.filter((component) => component !== master);
    this.root = root;
    this.components = { master, exceptions };
    this.kind = first.name === "vevent" ? "event" : "task";
    this.uid = String(first.getFirstPropertyValue("uid") ?? "");
    this.master = master ? readItem(master) : null;
    this.exceptions = exceptions.map(readItem);
  }

  /** Parses the body of a calendar object resource. */
  static parse(ics: string): CalendarObject {
    let jcal: unknown;
    try {
      jcal = ICAL.parse(ics);
    } catch (error) {
      throw new CalendarObjectError("The calendar object is not valid iCalendar.", {
        cause: error,
      });
    }
    if (!Array.isArray(jcal) || jcal[0] !== "vcalendar") {
      throw new CalendarObjectError("The calendar object is not one VCALENDAR.");
    }
    return new CalendarObject(new ICAL.Component(jcal));
  }

  /** The iCalendar text, with CRLF line endings as RFC 5545 requires. */
  serialize(): string {
    // `foldLength` is ical.js's global; it is set only while this object is written.
    const previous = ICAL.foldLength;
    ICAL.foldLength = FOLD_LENGTH;
    try {
      return `${this.root.toString()}\r\n`;
    } finally {
      ICAL.foldLength = previous;
    }
  }
}

/**
 * ical.js zones already made from a VTIMEZONE, by its exact content. Each
 * zone works out its changes of offset from its first observance (1970 for
 * most clients) when a time in it is first read: shared by every object with
 * the same definition, that is done once, not once per object read
 * (docs/plans/foundation.md#D118). An object whose VTIMEZONE differs in any
 * way gets its own (D32). Bounded: past the limit the oldest goes.
 */
const sharedZones = new Map<string, ICAL.Timezone>();
const SHARED_ZONES = 200;

/** Puts the shared zones for a calendar's VTIMEZONEs where ical.js looks for them first. */
function shareTimeZones(root: ICAL.Component): void {
  // ical.js keeps a calendar's zones by TZID on its root, made when a time first needs one.
  const cache: unknown = Reflect.get(root, "_timezoneCache");
  if (!(cache instanceof Map)) return;
  for (const component of root.getAllSubcomponents("vtimezone")) {
    const tzid = component.getFirstPropertyValue("tzid");
    if (typeof tzid !== "string" || cache.has(tzid)) continue;
    const content = JSON.stringify(component.toJSON());
    let zone = sharedZones.get(content);
    if (!zone) {
      // A copy of its own: the zone keeps no calendar it came from alive.
      zone = new ICAL.Timezone({ component: new ICAL.Component(JSON.parse(content)), tzid });
      if (sharedZones.size >= SHARED_ZONES) sharedZones.delete(sharedZones.keys().next().value!);
      sharedZones.set(content, zone);
    }
    cache.set(tzid, zone);
  }
}

export class CalendarObjectError extends Error {
  override name = "CalendarObjectError";
}
