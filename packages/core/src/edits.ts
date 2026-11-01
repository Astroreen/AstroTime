// Creating, editing and deleting events and tasks (docs/plans/foundation.md#D9,
// D10, D11). Each edit parses the object, changes the properties the user
// changed and nothing else, and serializes it (AGENTS.md rule 2, D7), as
// `completeTask` does. An occurrence of a series is edited in one of three
// scopes: this occurrence (its exception, or an EXDATE to delete it), this
// and following (the series ends before it and a new one starts there), or
// all occurrences (the master).
import ICAL from "ical.js";

import { CalendarObject, CalendarObjectError } from "./calendar-object.ts";
import { readItem } from "./item.ts";
import { movedRule, ruleOf, type Repeat } from "./repeat.ts";
import { componentOf, copyOf, exceptionOf, sameTime, touch, utc } from "./task-edits.ts";
import { fromIcalTime, wallClockIn, zonedToEpoch, type ItemTime } from "./time.ts";
import { vtimezone } from "./vtimezone.ts";

/** Which occurrences of a series an edit or a deletion applies to (D11). */
export type Scope = "this" | "following" | "all";

/** When an item is: an event's start and (exclusive) end, or a task's start and due. */
export interface ItemTimes {
  readonly start: ItemTime | null;
  /** An event's `DTEND`, exclusive (the day after for a date); a task's `DUE`. */
  readonly end: ItemTime | null;
}

/** A new reminder, relative to the item's start or end (a task's due). */
export interface NewAlarm {
  readonly relatedTo: "start" | "end";
  /** Negative: before. */
  readonly offsetSeconds: number;
}

export type TaskStatus = "NEEDS-ACTION" | "IN-PROCESS" | "COMPLETED" | "CANCELLED";

/**
 * What the user changed. A field left out is not touched; an empty text
 * removes its property. `time` is one field: an item's start and end move
 * together (D37). For an occurrence of a series it is the occurrence's
 * new time, which the scope carries over to the occurrences it covers.
 */
export interface ItemChanges {
  readonly summary?: string;
  readonly description?: string;
  readonly location?: string;
  readonly time?: ItemTimes;
  /** `null`: the item no longer repeats. */
  readonly repeat?: Repeat | null;
  /** Reminders removed, by their index among the item's `VALARM`s, and added. */
  readonly alarms?: {
    readonly remove: readonly number[];
    readonly add: readonly NewAlarm[];
    /**
     * What a reminder added says when its item has no title (its
     * `DESCRIPTION`), in the user's language: the core holds no UI strings (D103).
     */
    readonly untitled: string;
  };
  /** RFC 7986 `COLOR`, a CSS colour name; `null` takes the calendar's. */
  readonly color?: string | null;
  readonly status?: TaskStatus;
  readonly percentComplete?: number | null;
  /** 1 (highest) to 9; `null` for none. */
  readonly priority?: number | null;
  readonly categories?: readonly string[];
}

/** The PRODID of a calendar object AstroTime makes (RFC 5545 §3.7.3). */
export const PRODID = "-//AstroTime//AstroTime//EN";

/**
 * A new event or task: its UID, `DTSTAMP`, `CREATED`, `LAST-MODIFIED` and
 * `SEQUENCE:0`, then the fields given. Returns the iCalendar text.
 */
export function createItem(
  kind: "event" | "task",
  changes: ItemChanges,
  options: { readonly now: number; readonly uid: string },
): string {
  const root = new ICAL.Component("vcalendar");
  root.addPropertyWithValue("version", "2.0");
  root.addPropertyWithValue("prodid", PRODID);
  root.addPropertyWithValue("calscale", "GREGORIAN");
  const component = new ICAL.Component(kind === "event" ? "vevent" : "vtodo");
  root.addSubcomponent(component);
  const now = utc(options.now);
  component.addPropertyWithValue("uid", options.uid);
  component.addPropertyWithValue("dtstamp", now.clone());
  component.addPropertyWithValue("created", now.clone());
  component.addPropertyWithValue("last-modified", now.clone());
  component.addPropertyWithValue("sequence", 0);
  if (kind === "event" && !changes.time?.start) {
    throw new CalendarObjectError("An event needs a start.");
  }
  apply(component, root, changes, now);
  if (changes.repeat) setRepeat(component, changes.repeat);
  // A new item starts at the first revision, whatever `apply` counted.
  component.updatePropertyWithValue("sequence", 0);
  return serialize(root);
}

/** A VCALENDAR as `CalendarObject.serialize` writes it. */
function serialize(root: ICAL.Component): string {
  return CalendarObject.parse(`${root.toString()}\r\n`).serialize();
}

/**
 * The times of one occurrence, as its item writes them: the exception's own,
 * or the master's moved to the occurrence. `recurrenceId` `null` is the item itself.
 */
export function timesOf(object: CalendarObject, recurrenceId: ItemTime | null): ItemTimes {
  const component = occurrenceComponent(object, recurrenceId);
  const item = readItem(component);
  if (item.kind === "event") return { start: item.start, end: item.end };
  return { start: item.start, end: item.due };
}

function occurrenceComponent(object: CalendarObject, recurrenceId: ItemTime | null) {
  const { master, exceptions } = object.components;
  if (recurrenceId !== null) {
    const existing = exceptions.find((component) => {
      const value = component.getFirstPropertyValue("recurrence-id");
      return value instanceof ICAL.Time && sameTime(fromIcalTime(value), recurrenceId);
    });
    if (existing) return existing;
    if (master && isSeries(master)) return exceptionOf(master, recurrenceId);
  }
  const component = master ?? exceptions[0];
  if (!component) throw new CalendarObjectError("The calendar object has no item.");
  return component;
}

/**
 * The object with `changes` made in `scope` (all occurrences by default).
 * "This and following" ends the series before the occurrence and returns
 * the rest as a new series, `split`, under `newUid`; from the first
 * occurrence it is "all". A series with no `recurrenceId` is edited as a
 * whole. Returns the new iCalendar text of each.
 */
export function editItem(
  object: CalendarObject,
  changes: ItemChanges,
  options: {
    readonly now: number;
    readonly scope?: Scope;
    readonly recurrenceId?: ItemTime | null;
    /** The UID of the new series "this and following" starts. */
    readonly newUid?: string;
  },
): { readonly ics: string; readonly split: string | null } {
  const copy = CalendarObject.parse(object.serialize());
  const now = utc(options.now);
  const recurrenceId = options.recurrenceId ?? null;
  const master = copy.components.master;
  const scope = options.scope ?? "all";
  if (!master || !isSeries(master)) {
    // An item that does not repeat, or one exception of a series held without its master.
    const component = master ?? componentOf(copy, recurrenceId);
    apply(component, copy.root, changes, now);
    if (changes.repeat !== undefined && component === master) {
      setRepeat(component, changes.repeat);
      if (changes.repeat === null) dropRecurrence(copy.root, component);
    }
    return { ics: copy.serialize(), split: null };
  }
  if (recurrenceId === null) {
    // The series itself: every occurrence, as its first one moved.
    editSeries(copy.root, changes, null, timesOf(copy, null), now);
    return { ics: copy.serialize(), split: null };
  }

  const shown = timesOf(copy, recurrenceId);
  if (scope === "this") {
    const component = componentOf(copy, recurrenceId);
    apply(component, copy.root, withoutRepeat(changes), now);
    return { ics: copy.serialize(), split: null };
  }
  if (scope === "following" && !isFirst(master, recurrenceId)) {
    if (!options.newUid) throw new Error("A split needs the new series' UID.");
    const rest = splitAt(copy, master, recurrenceId, options.newUid, now);
    editSeries(rest, changes, recurrenceId, shown, now);
    // The new series is a new object: its first revision.
    for (const component of rest.getAllSubcomponents(master.name)) {
      if (!component.hasProperty("recurrence-id")) component.updatePropertyWithValue("sequence", 0);
    }
    return { ics: copy.serialize(), split: serialize(rest) };
  }
  editSeries(copy.root, changes, recurrenceId, shown, now);
  return { ics: copy.serialize(), split: null };
}

/**
 * The object without the occurrences `scope` covers, or `null` when none
 * are left and the object itself goes. This occurrence is an `EXDATE` (its
 * exception, if any, goes); this and following ends the series before it.
 * A series held without its master loses the exception, or each from it on.
 */
export function deleteItem(
  object: CalendarObject,
  options: {
    readonly now: number;
    readonly scope?: Scope;
    readonly recurrenceId?: ItemTime | null;
  },
): string | null {
  const copy = CalendarObject.parse(object.serialize());
  const now = utc(options.now);
  const recurrenceId = options.recurrenceId ?? null;
  const scope = options.scope ?? "all";
  const master = copy.components.master;
  if (recurrenceId === null || scope === "all" || (master && !isSeries(master))) return null;
  if (!master) {
    // Only exceptions are here: the one asked for goes, or each from it on,
    // and the object with the last.
    const at = orderKey(recurrenceId, recurrenceId);
    const { exceptions } = copy.components;
    const gone = exceptions.filter((exception) => {
      const id = recurrenceIdOf(exception);
      if (id === null) return false;
      return scope === "following" ? orderKey(id, recurrenceId) >= at : sameTime(id, recurrenceId);
    });
    for (const exception of gone) copy.root.removeSubcomponent(exception);
    return exceptions.length > gone.length ? copy.serialize() : null;
  }
  if (scope === "following") {
    if (isFirst(master, recurrenceId)) return null;
    endBefore(copy.root, master, recurrenceId, now);
    return copy.serialize();
  }
  for (const exception of exceptionsOf(copy.root, master)) {
    const value = exception.getFirstPropertyValue("recurrence-id");
    if (value instanceof ICAL.Time && sameTime(fromIcalTime(value), recurrenceId)) {
      copy.root.removeSubcomponent(exception);
    }
  }
  const exdate = new ICAL.Property("exdate");
  master.addProperty(exdate);
  setTime(exdate, recurrenceId, anchorTzid(master));
  significant(master, now);
  return copy.serialize();
}

// The fields

function apply(
  component: ICAL.Component,
  root: ICAL.Component,
  changes: ItemChanges,
  now: ICAL.Time,
): void {
  if (changes.summary !== undefined) setText(component, "summary", changes.summary);
  if (changes.location !== undefined) setText(component, "location", changes.location);
  if (changes.description !== undefined) {
    // The HTML twins of the old text (Thunderbird's ALTREP, Outlook's
    // X-ALT-DESC) would show instead of the new one: they go with it.
    component.removeAllProperties("x-alt-desc");
    setText(component, "description", changes.description);
    component.getFirstProperty("description")?.removeParameter("altrep");
  }
  if (changes.color !== undefined) setText(component, "color", changes.color ?? "");
  if (changes.categories !== undefined) {
    const params = component.getFirstProperty("categories")?.toJSON()[1] ?? {};
    component.removeAllProperties("categories");
    if (changes.categories.length > 0) {
      component.addProperty(
        new ICAL.Property(["categories", params, "text", ...changes.categories]),
      );
    }
  }
  if (changes.priority !== undefined) {
    if (changes.priority === null) component.removeAllProperties("priority");
    else component.updatePropertyWithValue("priority", changes.priority);
  }
  // The status first: completing sets the progress, which a progress given then overrides.
  if (changes.status !== undefined) setStatus(component, changes.status, now);
  if (changes.percentComplete !== undefined) {
    if (changes.percentComplete === null) component.removeAllProperties("percent-complete");
    else component.updatePropertyWithValue("percent-complete", changes.percentComplete);
  }
  if (changes.alarms) setAlarms(component, changes.alarms);
  if (changes.time) setTimes(component, root, changes.time);
  if (changes.time || changes.repeat !== undefined) significant(component, now);
  touch(component, now);
}

/** The changes but the rule: one occurrence does not change its series' rule. */
function withoutRepeat(changes: ItemChanges): ItemChanges {
  const { repeat, ...rest } = changes;
  void repeat;
  return rest;
}

function setText(component: ICAL.Component, name: string, value: string): void {
  if (value === "") component.removeAllProperties(name);
  else component.updatePropertyWithValue(name, value);
}

/** A task's status, with what Nextcloud Tasks writes beside it (design D94). */
function setStatus(component: ICAL.Component, status: TaskStatus, now: ICAL.Time): void {
  const was = String(component.getFirstPropertyValue("status") ?? "").toUpperCase();
  component.updatePropertyWithValue("status", status);
  if (status === "COMPLETED") {
    if (was !== "COMPLETED" || !component.hasProperty("completed")) {
      component.updatePropertyWithValue("completed", now.clone());
    }
    component.updatePropertyWithValue("percent-complete", 100);
  } else {
    component.removeAllProperties("completed");
    if (was === "COMPLETED") component.updatePropertyWithValue("percent-complete", 0);
  }
}

function setAlarms(component: ICAL.Component, alarms: NonNullable<ItemChanges["alarms"]>): void {
  const existing = component.getAllSubcomponents("valarm");
  for (const index of alarms.remove) {
    const alarm = existing[index];
    if (alarm) component.removeSubcomponent(alarm);
  }
  const summary = String(component.getFirstPropertyValue("summary") ?? "").trim();
  for (const add of alarms.add) {
    const alarm = new ICAL.Component("valarm");
    alarm.addPropertyWithValue("action", "DISPLAY");
    // RFC 5545 §3.6.6: a display alarm has a DESCRIPTION; the item's title says most.
    alarm.addPropertyWithValue("description", summary || alarms.untitled);
    const trigger = new ICAL.Property("trigger");
    if (add.relatedTo === "end") trigger.setParameter("related", "END");
    trigger.setValue(ICAL.Duration.fromSeconds(add.offsetSeconds));
    alarm.addProperty(trigger);
    component.addSubcomponent(alarm);
  }
}

/** `SEQUENCE` goes up on a change RFC 5545 §3.8.7.4 calls significant: the time, the rule, an exclusion. */
function significant(component: ICAL.Component, now: ICAL.Time): void {
  const sequence = Number(component.getFirstPropertyValue("sequence") ?? 0);
  component.updatePropertyWithValue("sequence", (Number.isFinite(sequence) ? sequence : 0) + 1);
  touch(component, now);
}

// Times

/**
 * An event's `DTSTART` and `DTEND`, or a task's `DTSTART` and `DUE`; a
 * `DURATION` goes, since the end is written. Each keeps its other
 * parameters, and the TZID it had when the zone is the same.
 */
function setTimes(component: ICAL.Component, root: ICAL.Component, times: ItemTimes): void {
  const event = component.name === "vevent";
  if (event && !times.start) throw new CalendarObjectError("An event needs a start.");
  const tzids = zonesOf(component);
  const write = (name: string, time: ItemTime | null) => {
    if (time === null) {
      component.removeAllProperties(name);
      return;
    }
    let property = component.getFirstProperty(name);
    if (!property) {
      property = new ICAL.Property(name);
      component.addProperty(property);
    }
    setTime(property, time, tzidFor(time, tzids, root));
  };
  component.removeAllProperties("duration");
  write("dtstart", times.start);
  write(event ? "dtend" : "due", times.end);
}

/** The TZIDs a component writes, by the IANA zone each stands for. */
function zonesOf(component: ICAL.Component): Map<string, string> {
  const zones = new Map<string, string>();
  for (const name of ["dtstart", "dtend", "due", "recurrence-id", "exdate", "rdate"]) {
    for (const property of component.getAllProperties(name)) {
      const tzid = property.getParameter("tzid");
      const value = property.getFirstValue();
      if (typeof tzid !== "string" || !(value instanceof ICAL.Time)) continue;
      const time = fromIcalTime(value);
      if (time.type === "zoned" && !zones.has(time.timeZone)) zones.set(time.timeZone, tzid);
    }
  }
  return zones;
}

/**
 * The TZID to write a zoned time with: one the component already writes for
 * that zone (`W. Europe Standard Time` stays), else the IANA name, with a
 * VTIMEZONE for it if the object has none (RFC 5545 §3.6.5).
 */
function tzidFor(time: ItemTime, known: Map<string, string>, root: ICAL.Component): string | null {
  if (time.type !== "zoned" || time.timeZone === "UTC") return null;
  const tzid = known.get(time.timeZone);
  if (tzid) return tzid;
  const defined = root
    .getAllSubcomponents("vtimezone")
    .some((zone) => zone.getFirstPropertyValue("tzid") === time.timeZone);
  if (!defined) root.addSubcomponent(vtimezone(time.timeZone, Number(time.local.slice(0, 4))));
  known.set(time.timeZone, time.timeZone);
  return time.timeZone;
}

/** Writes a time as a property's value: its type, its TZID; its other parameters stay. */
function setTime(property: ICAL.Property, time: ItemTime, tzid: string | null): void {
  property.removeParameter("tzid");
  if (time.type === "date") {
    property.resetType("date");
    property.setValue(time.date);
    return;
  }
  property.resetType("date-time");
  if (time.type === "zoned" && time.timeZone === "UTC") {
    property.setValue(`${time.local}Z`);
    return;
  }
  // The TZID first: the value is read in its zone.
  if (time.type === "zoned") property.setParameter("tzid", tzid ?? time.timeZone);
  property.setValue(time.local);
}

/** The TZID the series' start is written with, for an EXDATE or a RECURRENCE-ID like it. */
function anchorTzid(master: ICAL.Component): string | null {
  const anchor = master.getFirstProperty("dtstart") ?? master.getFirstProperty("due");
  const tzid = anchor?.getParameter("tzid");
  return typeof tzid === "string" ? tzid : null;
}

function anchorOf(component: ICAL.Component): ItemTime | null {
  const value =
    component.getFirstPropertyValue("dtstart") ?? component.getFirstPropertyValue("due");
  return value instanceof ICAL.Time ? fromIcalTime(value) : null;
}

const dayOf = (time: ItemTime) => (time.type === "date" ? time.date : time.local.slice(0, 10));

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** A wall clock in the zone (and kind) of `template`. */
function withLocal(template: ItemTime, local: string): ItemTime {
  if (template.type === "date") return { type: "date", date: local.slice(0, 10) };
  if (template.type === "floating") return { type: "floating", local };
  return {
    type: "zoned",
    local,
    timeZone: template.timeZone,
    epochMs: epochOf(local, template.timeZone),
  };
}

const epochOf = (local: string, timeZone: string) =>
  timeZone === "UTC" ? Date.parse(`${local}Z`) : zonedToEpoch(local, timeZone);

/** A time's wall clock as milliseconds, read as if it were UTC; a date at its midnight. */
const wallMs = (time: ItemTime) =>
  Date.parse(`${time.type === "date" ? `${time.date}T00:00:00` : time.local}Z`);

/**
 * Moves times as an occurrence moved from `from` to `to`: by the same
 * wall-clock time, in `to`'s zone and kind. So a series moved from 9:00 to
 * 10:00 has its start, its RDATE at 14:00, its EXDATEs and RECURRENCE-IDs an
 * hour later on the wall clock (the RDATE at 15:00), across a DST change too.
 * Made all-day, each moves by whole days; made timed, each date takes `to`'s
 * time of day.
 */
function mover(from: ItemTime, to: ItemTime): (time: ItemTime) => ItemTime {
  if (to.type === "date") {
    const days = daysBetween(dayOf(from), dayOf(to));
    return (time) => ({ type: "date", date: addDays(dayOf(time), days) });
  }
  const delta = wallMs(to) - wallMs(from);
  return (time) => withLocal(to, new Date(wallMs(time) + delta).toISOString().slice(0, 19));
}

/**
 * `move` for a time that names an occurrence (a RECURRENCE-ID, an EXDATE, an
 * RDATE) written as another kind of time than the series' start `from`
 * (D35): it keeps its kind, so it still names its occurrence. A date moves
 * by the whole days its occurrence moved; a floating or zoned time by as
 * much wall-clock time, on its own clock. Made all-day, each is a date.
 */
function inKind(
  move: (time: ItemTime) => ItemTime,
  from: ItemTime,
  to: ItemTime,
): (time: ItemTime) => ItemTime {
  return (time) => {
    if (time.type === from.type || to.type === "date" || from.type === "date") return move(time);
    if (time.type === "date") {
      return { type: "date", date: dayOf(move(occurrenceAt(time, from))) };
    }
    const moved = move(time);
    return moved.type === "date" ? moved : withLocal(time, moved.local);
  };
}

/** An occurrence's times moved together from where `from` is to where `to` is, on `from`'s clock. */
function translated(times: ItemTimes, from: ItemTime, to: ItemTime): ItemTimes {
  const move = mover(from, to);
  const moved = (time: ItemTime | null) => time && move(inFrameOf(time, from));
  return { start: moved(times.start), end: moved(times.end) };
}

/** A time on the series' wall clock: a RECURRENCE-ID in UTC read in the series' zone. */
function inFrameOf(time: ItemTime, frame: ItemTime): ItemTime {
  if (time.type !== "zoned" || frame.type !== "zoned" || time.timeZone === frame.timeZone)
    return time;
  return {
    type: "zoned",
    local: wallClockIn(time.epochMs, frame.timeZone),
    timeZone: frame.timeZone,
    epochMs: time.epochMs,
  };
}

/** Sorts times on the series' wall clock. */
function orderKey(time: ItemTime, frame: ItemTime | null): string {
  if (time.type === "date") return `${time.date}T00:00:00`;
  if (time.type === "zoned" && frame?.type === "zoned" && frame.timeZone !== time.timeZone) {
    return wallClockIn(time.epochMs, frame.timeZone);
  }
  return time.local;
}

/** The occurrence a time names on a timed series: a date, at the start's time of day (D35). */
function occurrenceAt(time: ItemTime, anchor: ItemTime): ItemTime {
  if (time.type !== "date" || anchor.type === "date") return time;
  return withLocal(anchor, `${time.date}T${anchor.local.slice(11)}`);
}

/** A time names its occurrence by day when it or the series' start is a date (D35). */
const byDay = (time: ItemTime, anchor: ItemTime) => time.type === "date" || anchor.type === "date";

/** The last moment on the series' wall clock a time may name: a date, its whole day. */
const reachOf = (time: ItemTime, anchor: ItemTime) =>
  time.type === "date" ? `${time.date}T23:59:59` : orderKey(time, anchor);

/** Whether two times name the same occurrence of the series: on its wall clock, or by day (D35). */
function sameOccurrence(a: ItemTime, b: ItemTime, anchor: ItemTime): boolean {
  if (byDay(a, anchor) || byDay(b, anchor)) {
    return dayOf(inFrameOf(a, anchor)) === dayOf(inFrameOf(b, anchor));
  }
  return orderKey(a, anchor) === orderKey(b, anchor);
}

// Series

function isSeries(component: ICAL.Component): boolean {
  return component.hasProperty("rrule") || component.hasProperty("rdate");
}

function isFirst(master: ICAL.Component, recurrenceId: ItemTime): boolean {
  const anchor = anchorOf(master);
  return anchor !== null && orderKey(recurrenceId, anchor) <= orderKey(anchor, anchor);
}

function exceptionsOf(root: ICAL.Component, master: ICAL.Component): ICAL.Component[] {
  return root.getAllSubcomponents(master.name).filter((c) => c.hasProperty("recurrence-id"));
}

function recurrenceIdOf(component: ICAL.Component): ItemTime | null {
  const value = component.getFirstPropertyValue("recurrence-id");
  return value instanceof ICAL.Time ? fromIcalTime(value) : null;
}

/** Every value of a component's EXDATEs or RDATEs, one property per value. */
function datesOf(component: ICAL.Component, name: "exdate" | "rdate"): ItemTime[] {
  return component
    .getAllProperties(name)
    .flatMap((property) => property.getValues())
    .filter((value): value is ICAL.Time => value instanceof ICAL.Time)
    .map(fromIcalTime);
}

function setDates(
  component: ICAL.Component,
  name: "exdate" | "rdate",
  times: readonly ItemTime[],
  tzid: string | null,
): void {
  component.removeAllProperties(name);
  for (const time of times) {
    const property = new ICAL.Property(name);
    component.addProperty(property);
    setTime(property, time, tzid);
  }
}

function setRepeat(master: ICAL.Component, repeat: Repeat | null): void {
  master.removeAllProperties("rrule");
  if (repeat === null) return;
  const anchor = anchorOf(master);
  if (!anchor) throw new CalendarObjectError("A series needs a start or a due.");
  master.addPropertyWithValue("rrule", ruleOf(repeat, anchor));
}

/** No longer a series: its other dates and its exceptions go with the rule. */
function dropRecurrence(root: ICAL.Component, master: ICAL.Component): void {
  master.removeAllProperties("rdate");
  master.removeAllProperties("exdate");
  for (const exception of exceptionsOf(root, master)) root.removeSubcomponent(exception);
}

/**
 * Whether a time names one of the series' occurrences by its RRULE and
 * RDATE, without its EXDATEs, up to `last` on its wall clock: on that wall
 * clock, or by day when the time or the start is a date (D35). `null` if
 * that is more than a series may be walked through (then nothing is dropped).
 */
function occurrencesUpTo(
  master: ICAL.Component,
  last: string,
): ((time: ItemTime) => boolean) | null {
  const anchor = anchorOf(master);
  if (!anchor) return null;
  const bare = new ICAL.Component(copyOf(master.toJSON()));
  bare.removeAllProperties("exdate");
  const start = bare.getFirstPropertyValue("dtstart") ?? bare.getFirstPropertyValue("due");
  if (!(start instanceof ICAL.Time)) return null;
  const expansion = new ICAL.RecurExpansion({ component: bare, dtstart: start });
  const keys = new Set<string>();
  const days = new Set<string>();
  const named = (time: ItemTime) =>
    byDay(time, anchor)
      ? days.has(dayOf(inFrameOf(time, anchor)))
      : keys.has(orderKey(time, anchor));
  for (let step = 0; step < 50_000; step++) {
    const next = expansion.next();
    if (!next) return named;
    const key = orderKey(fromIcalTime(next), anchor);
    if (key > last) return named;
    keys.add(key);
    days.add(key.slice(0, 10));
  }
  return null;
}

/**
 * Edits every occurrence through the master. A new time moves the series
 * as the occurrence `shown` moved (`mover`): its start, the days and hours
 * its rule names (`movedRule`), its RDATEs and EXDATEs and the
 * RECURRENCE-IDs of its exceptions; an exception not moved on its own
 * follows, one moved keeps its time. A changed field reaches each exception
 * that had the master's value; one changed on its own keeps it. The
 * occurrence edited (`recurrenceId`; `null` for the series itself) gets the
 * changes as given. Exceptions and EXDATEs that no longer name an occurrence
 * of the new rule go.
 */
function editSeries(
  root: ICAL.Component,
  changes: ItemChanges,
  recurrenceId: ItemTime | null,
  shown: ItemTimes,
  now: ICAL.Time,
): void {
  const master = root
    .getAllSubcomponents()
    .find((c) => (c.name === "vevent" || c.name === "vtodo") && !c.hasProperty("recurrence-id"))!;
  const before = readItem(master);
  const oldAnchor = anchorOf(master)!;
  const exceptions = exceptionsOf(root, master);
  const opened = exceptions.find((c) => {
    const id = recurrenceIdOf(c);
    return id !== null && recurrenceId !== null && sameTime(id, recurrenceId);
  });
  const others = exceptions.filter((c) => c !== opened);
  const beforeOthers = others.map(readItem);
  const followers = new Set(
    others.filter((exception) => {
      const id = recurrenceIdOf(exception);
      const anchor = anchorOf(exception);
      return id !== null && anchor !== null && sameTime(anchor, id);
    }),
  );

  // The series moves as the occurrence shown moved, on the series' wall
  // clock; the master and each exception that follows take the new times,
  // placed where each is as the occurrence's are where it is.
  let move: ((time: ItemTime) => ItemTime) | null = null;
  // A RECURRENCE-ID, EXDATE or RDATE moves in its own kind (D35).
  let moveNamed: ((time: ItemTime) => ItemTime) | null = null;
  let timesAt: ((at: ItemTime) => ItemTimes) | null = null;
  if (changes.time) {
    const times = changes.time;
    const shownAnchor = shown.start ?? shown.end;
    const newAnchor = times.start ?? times.end;
    if (!shownAnchor || !newAnchor) {
      throw new CalendarObjectError("A series needs a start or a due.");
    }
    const to = inFrameOf(newAnchor, oldAnchor);
    const byOccurrence = mover(inFrameOf(shownAnchor, oldAnchor), to);
    move = (time) => byOccurrence(inFrameOf(time, oldAnchor));
    moveNamed = inKind(move, oldAnchor, to);
    timesAt = (at) => translated(times, to, at);
    const anchor = move(oldAnchor);
    apply(master, root, { ...changes, time: timesAt(anchor) }, now);
    // The days and hours the rule names move with it, unless a new rule is given.
    if (changes.repeat === undefined) followRule(master, oldAnchor, anchor);
  } else {
    apply(master, root, changes, now);
  }
  if (changes.repeat !== undefined) {
    setRepeat(master, changes.repeat);
    if (changes.repeat === null) {
      dropRecurrence(root, master);
      return;
    }
  }

  const tzid = anchorTzid(master);
  if (moveNamed) {
    const moveDates = (name: "exdate" | "rdate") => {
      const dates = datesOf(master, name);
      if (dates.length > 0) setDates(master, name, dates.map(moveNamed!), tzid);
    };
    moveDates("exdate");
    moveDates("rdate");
    for (const exception of exceptions) {
      const id = recurrenceIdOf(exception)!;
      const moved = moveNamed(id);
      setTime(exception.getFirstProperty("recurrence-id")!, moved, tzid);
      if (followers.has(exception)) {
        setTimes(exception, root, timesAt!(moved));
        significant(exception, now);
      } else touch(exception, now);
    }
  }

  // A field the user changed reaches the exceptions that had the master's value.
  for (const [index, exception] of others.entries()) {
    const own = beforeOthers[index]!;
    const follow: Record<string, unknown> = {};
    for (const key of ["summary", "description", "location", "color"] as const) {
      if (changes[key] !== undefined && (own[key] ?? "") === (before[key] ?? ""))
        follow[key] = changes[key];
    }
    if (changes.categories && own.categories.join() === before.categories.join()) {
      follow["categories"] = changes.categories;
    }
    if (
      changes.priority !== undefined &&
      own.kind === "task" &&
      before.kind === "task" &&
      own.priority === before.priority
    ) {
      follow["priority"] = changes.priority;
    }
    if (changes.alarms && JSON.stringify(own.alarms) === JSON.stringify(before.alarms)) {
      follow["alarms"] = changes.alarms;
    }
    if (Object.keys(follow).length > 0) apply(exception, root, follow, now);
  }
  if (opened) apply(opened, root, withoutRepeat(changes), now);

  if (move || changes.repeat !== undefined) dropStale(root, master);
}

/** The master's rules moved with its start (`movedRule`), each only where that changes it. */
function followRule(master: ICAL.Component, from: ItemTime, to: ItemTime): void {
  for (const property of master.getAllProperties("rrule")) {
    const rule = property.getFirstValue();
    if (!(rule instanceof ICAL.Recur)) continue;
    const moved = movedRule(rule, from, to);
    if (moved.toString() !== rule.toString()) property.setValue(moved);
  }
}

/**
 * Whether a series still has the occurrence `recurrenceId` names: an
 * exception for it, or one its rule or RDATEs make that no EXDATE removes. A
 * series too dense to walk through is taken to have it.
 */
export function hasOccurrence(object: CalendarObject, recurrenceId: ItemTime): boolean {
  const { master, exceptions } = object.components;
  const named = (component: ICAL.Component) => {
    const id = recurrenceIdOf(component);
    return id !== null && sameTime(id, recurrenceId);
  };
  if (exceptions.some(named)) return true;
  const anchor = master && isSeries(master) ? anchorOf(master) : null;
  if (!master || !anchor) return false;
  if (datesOf(master, "exdate").some((time) => sameOccurrence(time, recurrenceId, anchor))) {
    return false;
  }
  const has = occurrencesUpTo(master, reachOf(recurrenceId, anchor));
  return has === null || has(recurrenceId);
}

/** Exceptions and EXDATEs that name no occurrence of the series any more. */
function dropStale(root: ICAL.Component, master: ICAL.Component): void {
  const anchor = anchorOf(master);
  if (!anchor) return;
  const exceptions = exceptionsOf(root, master);
  const exdates = datesOf(master, "exdate");
  const named = [...exceptions.map((c) => recurrenceIdOf(c)!), ...exdates];
  if (named.length === 0) return;
  const last = named
    .map((time) => reachOf(time, anchor))
    .toSorted()
    .at(-1)!;
  const has = occurrencesUpTo(master, last);
  if (!has) return;
  for (const exception of exceptions) {
    if (!has(recurrenceIdOf(exception)!)) root.removeSubcomponent(exception);
  }
  const kept = exdates.filter((time) => has(time));
  if (kept.length !== exdates.length) setDates(master, "exdate", kept, anchorTzid(master));
}

/**
 * Ends the series before `recurrenceId` (RFC 5545 §3.3.10: `UNTIL` a date
 * for a series of dates, a UTC time for a zoned one, a wall clock for a
 * floating one; a `COUNT` becomes an `UNTIL`), and drops what came after:
 * its exceptions, EXDATEs and RDATEs.
 */
function endBefore(
  root: ICAL.Component,
  master: ICAL.Component,
  recurrenceId: ItemTime,
  now: ICAL.Time,
): void {
  const anchor = anchorOf(master)!;
  const split = orderKey(recurrenceId, anchor);
  for (const property of master.getAllProperties("rrule")) {
    const rule = property.getFirstValue() as ICAL.Recur;
    const until = untilBefore(recurrenceId, anchor);
    if (rule.until && rule.until.compare(until) <= 0) continue;
    rule.count = null;
    rule.until = until;
    property.setValue(rule);
  }
  for (const name of ["exdate", "rdate"] as const) {
    const dates = datesOf(master, name);
    const kept = dates.filter((time) => orderKey(time, anchor) < split);
    if (kept.length !== dates.length) setDates(master, name, kept, anchorTzid(master));
  }
  for (const exception of exceptionsOf(root, master)) {
    if (orderKey(recurrenceIdOf(exception)!, anchor) >= split) root.removeSubcomponent(exception);
  }
  significant(master, now);
}

/**
 * The last moment before an occurrence, in the type `UNTIL` must be written
 * in: a date or a floating time naming an occurrence of a zoned series
 * (D35) is read in the series' zone, its `UNTIL` in UTC all the same.
 */
function untilBefore(recurrenceId: ItemTime, anchor: ItemTime): ICAL.Time {
  const at = inFrameOf(recurrenceId, anchor);
  if (anchor.type === "date") {
    const [year, month, day] = addDays(dayOf(at), -1).split("-").map(Number);
    return ICAL.Time.fromData({ year, month, day, isDate: true });
  }
  const local = at.type === "date" ? `${at.date}T00:00:00` : at.local;
  if (anchor.type === "floating") {
    const time = ICAL.Time.fromDateTimeString(local);
    time.adjust(0, 0, 0, -1);
    return time;
  }
  return utc((at.type === "zoned" ? at.epochMs : epochOf(local, anchor.timeZone)) - 1000);
}

/**
 * Splits the series at an occurrence: the object keeps what comes before;
 * the rest is a new object under `uid` (its own CREATED, DTSTAMP and
 * SEQUENCE:0) with the master moved to that occurrence, a COUNT left as
 * the occurrences remaining, and the exceptions, EXDATEs and RDATEs from
 * there on.
 */
function splitAt(
  object: CalendarObject,
  master: ICAL.Component,
  recurrenceId: ItemTime,
  uid: string,
  now: ICAL.Time,
): ICAL.Component {
  const anchor = anchorOf(master)!;
  const split = orderKey(recurrenceId, anchor);
  const rest = new ICAL.Component(copyOf(object.root.toJSON()));
  for (const component of rest.getAllSubcomponents(master.name)) rest.removeSubcomponent(component);

  const next = exceptionOf(master, occurrenceAt(recurrenceId, anchor));
  next.removeAllProperties("recurrence-id");
  for (const name of ["rrule", "rdate", "exdate"]) {
    for (const property of master.getAllProperties(name)) {
      next.addProperty(new ICAL.Property(copyOf(property.toJSON())));
    }
  }
  // Each rule's COUNT counts its own occurrences (RFC 5545 allows one rule; another client may write more).
  for (const property of next.getAllProperties("rrule")) {
    const rule = property.getFirstValue() as ICAL.Recur;
    if (rule.count) {
      rule.count = Math.max(1, rule.count - countBefore(master, rule, recurrenceId));
      property.setValue(rule);
    }
  }
  for (const name of ["exdate", "rdate"] as const) {
    const dates = datesOf(next, name);
    const kept = dates.filter((time) => orderKey(time, anchor) >= split);
    if (kept.length !== dates.length) setDates(next, name, kept, anchorTzid(master));
  }
  next.updatePropertyWithValue("uid", uid);
  next.updatePropertyWithValue("created", now.clone());
  next.updatePropertyWithValue("sequence", 0);
  touch(next, now);
  rest.addSubcomponent(next);
  for (const exception of exceptionsOf(object.root, master)) {
    if (orderKey(recurrenceIdOf(exception)!, anchor) < split) continue;
    const moved = new ICAL.Component(copyOf(exception.toJSON()));
    moved.updatePropertyWithValue("uid", uid);
    rest.addSubcomponent(moved);
  }
  endBefore(object.root, master, recurrenceId, now);
  return rest;
}

/** How many occurrences `rule` makes before `recurrenceId` (COUNT counts excluded ones too). */
function countBefore(master: ICAL.Component, rule: ICAL.Recur, recurrenceId: ItemTime): number {
  const anchor = anchorOf(master)!;
  const start = master.getFirstPropertyValue("dtstart") ?? master.getFirstPropertyValue("due");
  if (!(start instanceof ICAL.Time)) return 0;
  const split = orderKey(recurrenceId, anchor);
  const iterator = rule.iterator(start);
  let count = 0;
  for (let step = 0; step < 50_000; step++) {
    const next = iterator.next();
    if (!next) break;
    if (orderKey(fromIcalTime(next), anchor) >= split) break;
    count++;
  }
  return count;
}
