// Completing and starring a task, the only edits the tasks screen makes
// (design D52). Each writes the few properties it must and leaves every other
// one as it was (AGENTS.md rule 2, docs/plans/foundation.md#D7).
import ICAL from "ical.js";

import { CalendarObject, CalendarObjectError } from "./calendar-object.ts";
import { plus } from "./item.ts";
import { lengthOf } from "./occurrences.ts";
import { fromIcalTime, keepTzid, type ItemTime } from "./time.ts";

/**
 * The task completed or not, as Nextcloud Tasks writes it: completed is
 * `STATUS:COMPLETED`, `COMPLETED` at `now` in UTC and `PERCENT-COMPLETE:100`;
 * not completed is `STATUS:NEEDS-ACTION`, no `COMPLETED` and
 * `PERCENT-COMPLETE:0`. `LAST-MODIFIED` and `DTSTAMP` become `now`
 * (RFC 5545 §3.8.7.2, §3.8.7.3). One occurrence of a series (`recurrenceId`)
 * is completed in its exception, made from the master if it has none yet;
 * the series itself is not changed. Returns the new iCalendar text.
 */
export function completeTask(
  object: CalendarObject,
  done: boolean,
  options: { readonly now: number; readonly recurrenceId?: ItemTime | null },
): string {
  const copy = CalendarObject.parse(object.serialize());
  const component = componentOf(copy, options.recurrenceId ?? null);
  const now = utc(options.now);
  if (done) {
    component.updatePropertyWithValue("status", "COMPLETED");
    component.updatePropertyWithValue("completed", now);
    component.updatePropertyWithValue("percent-complete", 100);
  } else {
    component.updatePropertyWithValue("status", "NEEDS-ACTION");
    component.removeAllProperties("completed");
    component.updatePropertyWithValue("percent-complete", 0);
  }
  touch(component, now);
  return copy.serialize();
}

/**
 * The task starred or not: `X-ASTROTIME-STARRED:TRUE` on the master, or no
 * such property (design D52). The task's own `PRIORITY` is never touched.
 * Returns the new iCalendar text.
 */
export function starTask(object: CalendarObject, starred: boolean, now: number): string {
  const copy = CalendarObject.parse(object.serialize());
  const component = componentOf(copy, null);
  if (starred) component.updatePropertyWithValue("x-astrotime-starred", "TRUE");
  else component.removeAllProperties("x-astrotime-starred");
  touch(component, utc(now));
  return copy.serialize();
}

const utc = (epochMs: number) => ICAL.Time.fromJSDate(new Date(epochMs), true);

function touch(component: ICAL.Component, now: ICAL.Time): void {
  component.updatePropertyWithValue("last-modified", now.clone());
  component.updatePropertyWithValue("dtstamp", now.clone());
}

/** A deep copy of jCal, which is plain JSON. */
const copyOf = <T>(jcal: T): T => JSON.parse(JSON.stringify(jcal)) as T;

/** The component to change: the master, or the exception of one occurrence. */
function componentOf(object: CalendarObject, recurrenceId: ItemTime | null): ICAL.Component {
  const { master, exceptions } = object.components;
  if (recurrenceId === null) {
    // A server may hold only exceptions of a series; the first stands for it.
    const component = master ?? exceptions[0];
    if (!component) throw new CalendarObjectError("The calendar object has no task.");
    return component;
  }
  const existing = exceptions.find((component) => {
    const value = component.getFirstPropertyValue("recurrence-id");
    return value instanceof ICAL.Time && sameTime(fromIcalTime(value), recurrenceId);
  });
  if (existing) return existing;
  if (!master) throw new CalendarObjectError("The series has no master to make an exception of.");
  const exception = exceptionOf(master, recurrenceId);
  object.root.addSubcomponent(exception);
  return exception;
}

function sameTime(a: ItemTime, b: ItemTime): boolean {
  if (a.type === "zoned" && b.type === "zoned") return a.epochMs === b.epochMs;
  if (a.type === "date" && b.type === "date") return a.date === b.date;
  return a.type === "floating" && b.type === "floating" && a.local === b.local;
}

/**
 * A new exception for one occurrence (RFC 5545 §3.8.4.4): a copy of the
 * master without its recurrence, moved to the occurrence. A task's
 * occurrences are anchored at `DTSTART`, else at `DUE` (as
 * `occurrencesBetween` places them); a `DUE` after a `DTSTART` keeps its distance.
 */
function exceptionOf(master: ICAL.Component, recurrenceId: ItemTime): ICAL.Component {
  const exception = new ICAL.Component(copyOf(master.toJSON()));
  for (const name of ["rrule", "rdate", "exdate"]) exception.removeAllProperties(name);
  const start = exception.getFirstProperty("dtstart");
  const due = exception.getFirstProperty("due");
  const anchor = start ?? due;
  const from = anchor?.getFirstValue();
  if (!anchor || !(from instanceof ICAL.Time)) {
    throw new CalendarObjectError("A task with neither DTSTART nor DUE has no occurrences.");
  }
  const at = like(from, recurrenceId);
  const dueValue = due?.getFirstValue();
  if (start && due && dueValue instanceof ICAL.Time) {
    due.setValue(plus(at, lengthOf({ start: from, end: dueValue })));
  }
  anchor.setValue(at);
  // RECURRENCE-ID is written as the anchor is: its TZID, or a date.
  const id = copyOf(anchor.toJSON());
  id[0] = "recurrence-id";
  exception.addProperty(new ICAL.Property(id));
  return exception;
}

/** `time` as an ical.js time in the zone (and kind) of `template`. */
function like(template: ICAL.Time, time: ItemTime): ICAL.Time {
  const local = time.type === "date" ? `${time.date}T00:00:00` : time.local;
  const [year, month, day, hour, minute, second] = (local.match(/\d+/g) ?? []).map(Number);
  const result = ICAL.Time.fromData(
    { year, month, day, hour, minute, second, isDate: template.isDate },
    template.zone ?? undefined,
  );
  return keepTzid(template, result);
}
