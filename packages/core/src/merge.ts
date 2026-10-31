import ICAL from "ical.js";

import { CalendarObject } from "./calendar-object.ts";

/**
 * Properties every client rewrites on every save; they never make a conflict.
 * The merged object keeps the newest of each.
 */
const BOOKKEEPING = new Set(["dtstamp", "last-modified", "sequence"]);

export interface Merge {
  /** The merged object, built on the server's version (its time zones, its order). */
  readonly ics: string;
  /** Both sides changed the same property differently; the server's value was kept. */
  readonly conflict: boolean;
}

type Fields = Map<string, string>;

/**
 * Properties that hold a set: values added or removed on each side are
 * combined instead of conflicting (an EXDATE added here, another there).
 */
const SETS = new Set([
  "exdate",
  "rdate",
  "categories",
  "attendee",
  "comment",
  "attach",
  "related-to",
  "contact",
  "resources",
]);

/** A deep copy of jCal, which is plain JSON (`structuredClone` is not in every runtime's types). */
const copy = <T>(jcal: T): T => JSON.parse(JSON.stringify(jcal)) as T;

/** Each item component by its identity: `vevent` or `vevent@<RECURRENCE-ID>`. */
function itemsOf(object: CalendarObject): Map<string, ICAL.Component> {
  const items = new Map<string, ICAL.Component>();
  const { master, exceptions } = object.components;
  for (const component of [master, ...exceptions]) {
    if (!component) continue;
    const recurrenceId = component.getFirstProperty("recurrence-id")?.toICALString() ?? "";
    items.set(`${component.name}@${recurrenceId}`, component);
  }
  return items;
}

/**
 * When an item happens is one field, not four: moving it changes DTSTART and
 * DTEND (or DURATION, or DUE) together, and taking one side's start with the
 * other's end would make a time neither side chose.
 */
const TIME = new Set(["dtstart", "dtend", "duration", "due"]);
const TIME_FIELD = "#time";

/** Separates the values of one field; a content line never holds it. */
const VALUE = "\u0000";

/** A property as one unfolded content line (ical.js folds long ones). */
function line(property: ICAL.Property): string {
  return property.toICALString().replaceAll(/\r?\n[ \t]/g, "");
}

/** A component's fields: each property name with all its values, and its alarms as one field. */
function fieldsOf(component: ICAL.Component): Fields {
  const values = new Map<string, string[]>();
  const add = (name: string, text: string) => values.set(name, [...(values.get(name) ?? []), text]);
  for (const property of component.getAllProperties()) {
    if (BOOKKEEPING.has(property.name)) continue;
    if (SETS.has(property.name))
      for (const single of singles(property)) add(property.name, line(single));
    else add(TIME.has(property.name) ? TIME_FIELD : property.name, line(property));
  }
  for (const sub of component.getAllSubcomponents()) add(`@${sub.name}`, sub.toString());
  return new Map([...values].map(([name, list]) => [name, list.toSorted().join(VALUE)]));
}

function sameFields(a: ICAL.Component, b: ICAL.Component): boolean {
  const fa = fieldsOf(a);
  const fb = fieldsOf(b);
  return fa.size === fb.size && [...fa].every(([name, text]) => fb.get(name) === text);
}

/** Replaces a field of `target` with the one in `source` (or removes it). */
function copyField(target: ICAL.Component, source: ICAL.Component | null, name: string) {
  if (name === TIME_FIELD) {
    for (const time of TIME) copyField(target, source, time);
    return;
  }
  if (name.startsWith("@")) {
    for (const sub of target.getAllSubcomponents(name.slice(1))) target.removeSubcomponent(sub);
    for (const sub of source?.getAllSubcomponents(name.slice(1)) ?? []) {
      target.addSubcomponent(new ICAL.Component(copy(sub.toJSON())));
    }
    return;
  }
  target.removeAllProperties(name);
  for (const property of source?.getAllProperties(name) ?? []) {
    target.addProperty(new ICAL.Property(copy(property.toJSON())));
  }
}

function newest(component: ICAL.Component, sources: readonly (ICAL.Component | undefined)[]) {
  const sequence = Math.max(
    ...sources.map((c) => Number(c?.getFirstPropertyValue("sequence") ?? 0)),
  );
  if (sequence > 0) component.updatePropertyWithValue("sequence", sequence);
  for (const name of ["dtstamp", "last-modified"]) {
    const times = sources
      .map((c) => c?.getFirstPropertyValue(name))
      .filter((t): t is ICAL.Time => t instanceof ICAL.Time);
    const latest = times.toSorted((a, b) => b.compare(a))[0];
    if (latest) component.updatePropertyWithValue(name, latest.clone());
  }
}

/**
 * A three-way merge of one calendar object (docs/plans/foundation.md#D6):
 * `base` is the version both sides started from, `local` ours, `server` the
 * one that refused our write. Each property (all its values together) and
 * each kind of subcomponent (`VALARM`) is a field. A field changed on one
 * side only takes that side; changed on both to the same value, that value;
 * changed on both differently, the server's, and the merge is a conflict.
 * Occurrences (exceptions) added or removed on one side are merged the same
 * way.
 */
export function mergeObjects(base: string, local: string, server: string): Merge {
  const b = itemsOf(CalendarObject.parse(base));
  const l = itemsOf(CalendarObject.parse(local));
  const serverObject = CalendarObject.parse(server);
  const s = itemsOf(serverObject);
  const root = serverObject.root;
  let conflict = false;

  for (const key of new Set([...b.keys(), ...l.keys(), ...s.keys()])) {
    const [bc, lc, sc] = [b.get(key), l.get(key), s.get(key)];
    if (!lc && !sc) continue;
    // Added or removed on one side only.
    if (!bc && lc && !sc) {
      root.addSubcomponent(new ICAL.Component(copy(lc.toJSON())));
      continue;
    }
    if (bc && !lc && sc) {
      if (sameFields(bc, sc)) root.removeSubcomponent(sc);
      else conflict = true;
      continue;
    }
    if (bc && lc && !sc) {
      if (!sameFields(bc, lc)) conflict = true;
      continue;
    }
    if (!lc || !sc) continue;

    const [bf, lf, sf] = [
      bc ? fieldsOf(bc) : new Map<string, string>(),
      fieldsOf(lc),
      fieldsOf(sc),
    ];
    for (const name of new Set([...bf.keys(), ...lf.keys(), ...sf.keys()])) {
      const [bv, lv, sv] = [bf.get(name), lf.get(name), sf.get(name)];
      if (lv === sv || lv === bv) continue;
      if (sv === bv) copyField(sc, lc, name);
      else if (SETS.has(name))
        conflict = mergeSet(sc, name, valuesOf(bv), valuesOf(lv)) || conflict;
      else conflict = true;
    }
    newest(sc, [bc, lc, sc]);
  }

  addMissingTimezones(root, CalendarObject.parse(local).root);
  return { ics: serverObject.serialize(), conflict };
}

function valuesOf(field: string | undefined): Set<string> {
  return new Set(field ? field.split(VALUE) : []);
}

/**
 * What identifies a value in a set: an attendee is their address (changing
 * their PARTSTAT is the same attendee); any other value is its whole line.
 */
function identity(name: string, text: string): string {
  if (name !== "attendee") return text;
  const parsed = new ICAL.Component(ICAL.parse(`BEGIN:X\r\n${text}\r\nEND:X`) as unknown[]);
  return String(parsed.getFirstProperty("attendee")?.getFirstValue() ?? text).toLowerCase();
}

/**
 * A set property one value per line: `EXDATE:20260101,20260108` is two
 * values, and each side may add or remove one of them.
 */
function singles(property: ICAL.Property): ICAL.Property[] {
  const values = property.getValues();
  if (values.length <= 1) return [property];
  return values.map((value) => {
    const single = new ICAL.Property(copy(property.toJSON()));
    single.setValue(value);
    return single;
  });
}

/**
 * The server's set, plus what we added since the base, minus what we
 * removed, with what we changed. A value both sides changed differently
 * keeps the server's, and is a conflict.
 */
function mergeSet(
  target: ICAL.Component,
  name: string,
  base: Set<string>,
  local: Set<string>,
): boolean {
  // The server's lines split the same way, so one value can be taken out.
  for (const property of target.getAllProperties(name)) {
    const split = singles(property);
    if (split.length === 1) continue;
    target.removeProperty(property);
    for (const single of split) target.addProperty(single);
  }
  const byId = (values: Iterable<string>) =>
    new Map([...values].map((text) => [identity(name, text), text]));
  const [b, l] = [byId(base), byId(local)];
  const server = new Map(
    target.getAllProperties(name).map((property) => [identity(name, line(property)), property]),
  );
  let conflict = false;
  const put = (text: string) => {
    const parsed = new ICAL.Component(ICAL.parse(`BEGIN:X\r\n${text}\r\nEND:X`) as unknown[]);
    for (const property of parsed.getAllProperties())
      target.addProperty(new ICAL.Property(copy(property.toJSON())));
  };
  for (const [id, text] of b) {
    if (l.has(id)) continue;
    // Removed here: removed there too, unless the server changed it meanwhile.
    const theirs = server.get(id);
    if (!theirs) continue;
    if (line(theirs) === text) target.removeProperty(theirs);
    else conflict = true;
  }
  for (const [id, text] of l) {
    const was = b.get(id);
    if (was === text) continue;
    const theirs = server.get(id);
    if (!theirs) {
      // Added here, or changed here and removed there: ours stands.
      if (was === undefined) put(text);
      else conflict = true;
      continue;
    }
    const theirText = line(theirs);
    if (theirText === text) continue;
    // Added on both sides or changed on both sides, differently.
    if (was === undefined || theirText !== was) {
      conflict = true;
      continue;
    }
    target.removeProperty(theirs);
    put(text);
  }
  return conflict;
}

/**
 * Fields copied from our side may name a TZID the server's version does not
 * define; its VTIMEZONE comes along, or the zone would be lost (D7).
 */
function addMissingTimezones(root: ICAL.Component, from: ICAL.Component) {
  const defined = new Set(
    root.getAllSubcomponents("vtimezone").map((tz) => String(tz.getFirstPropertyValue("tzid"))),
  );
  const used = new Set<string>();
  const visit = (component: ICAL.Component) => {
    for (const property of component.getAllProperties()) {
      const tzid = property.getParameter("tzid");
      if (typeof tzid === "string") used.add(tzid);
    }
    for (const sub of component.getAllSubcomponents()) if (sub.name !== "vtimezone") visit(sub);
  };
  visit(root);
  for (const tz of from.getAllSubcomponents("vtimezone")) {
    const tzid = String(tz.getFirstPropertyValue("tzid"));
    if (used.has(tzid) && !defined.has(tzid))
      root.addSubcomponent(new ICAL.Component(copy(tz.toJSON())));
  }
}

/** Whether two versions of an object hold the same items, field for field (bookkeeping aside). */
export function sameObjects(a: string, b: string): boolean {
  const ia = itemsOf(CalendarObject.parse(a));
  const ib = itemsOf(CalendarObject.parse(b));
  return (
    ia.size === ib.size &&
    [...ia].every(([key, component]) => {
      const other = ib.get(key);
      return other !== undefined && sameFields(component, other);
    })
  );
}
