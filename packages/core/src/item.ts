import ICAL from "ical.js";

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
      }
    | { readonly type: "absolute"; readonly at: ItemTime };
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
  readonly status: string | null;
  readonly categories: readonly string[];
  /** `CLASS`: PUBLIC, PRIVATE, CONFIDENTIAL. */
  readonly classification: string | null;
  /** RFC 7986 `COLOR`, a CSS colour name. */
  readonly color: string | null;
  readonly url: string | null;
  readonly sequence: number;
  readonly created: ItemTime | null;
  readonly lastModified: ItemTime | null;
  /** Whether the item has `RRULE` or `RDATE`. */
  readonly recurring: boolean;
  readonly alarms: readonly Alarm[];
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

function alarm(component: ICAL.Component): Alarm {
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
        };
  return {
    action: text(component, "action") ?? "DISPLAY",
    description: text(component, "description"),
    trigger,
  };
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
    status: text(component, "status"),
    categories: component
      .getAllProperties("categories")
      .flatMap((property) => property.getValues().map(String)),
    classification: text(component, "class"),
    color: text(component, "color"),
    url: text(component, "url"),
    sequence: integer(component, "sequence") ?? 0,
    created: time(component, "created"),
    lastModified: time(component, "last-modified"),
    recurring: component.hasProperty("rrule") || component.hasProperty("rdate"),
    alarms: component.getAllSubcomponents("valarm").map(alarm),
  };
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
