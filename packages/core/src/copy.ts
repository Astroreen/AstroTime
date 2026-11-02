// A copy of an item (design D164): one occurrence as a new item of its own,
// and "Copy to…"'s new item from it. Apart from the edits every view needs,
// so the web app loads it with the details' menu, not at once
// (docs/plans/foundation.md#D145).
import ICAL from "ical.js";

import { CalendarObject } from "./calendar-object.ts";
import { editItem, occurrenceComponent, PRODID, serialize, type ItemChanges } from "./edits.ts";
import { copyOf, utc } from "./task-edits.ts";
import type { ItemTime } from "./time.ts";

/**
 * A copy of one occurrence as a new item of its own (design D164): the
 * occurrence as it shows (its exception, or the master moved to it), with
 * every property kept (D7) but what makes it another item: a new `UID`,
 * `DTSTAMP`, `CREATED` and `LAST-MODIFIED` at `now`, `SEQUENCE:0`; no
 * recurrence (`RRULE`, `RDATE`, `EXDATE`, `RECURRENCE-ID`), so a copy of an
 * occurrence of a series is that one occurrence; no `ORGANIZER` or
 * `ATTENDEE`, so a server that schedules sends no invitation for it and
 * nobody's answer is copied; a task not done (`STATUS:NEEDS-ACTION`, no
 * `COMPLETED`, `PERCENT-COMPLETE:0` when it had one); its reminders without
 * their identity (`UID`, Apple's `X-WR-ALARMUID`) and `ACKNOWLEDGED`, and no
 * `X-MOZ-LASTACK` or `X-MOZ-SNOOZE-TIME*` (Thunderbird's), and no snooze
 * `VALARM` (RFC 9074 §7, `RELATED-TO;RELTYPE=SNOOZE`): the original's reminders were
 * seen or put off, not the copy's, which are fresh. The calendar's other components and
 * properties (its `VTIMEZONE`s) come along. Returns the iCalendar text.
 */
export function copyItem(
  object: CalendarObject,
  recurrenceId: ItemTime | null,
  options: { readonly now: number; readonly uid: string },
): string {
  const component = new ICAL.Component(copyOf(occurrenceComponent(object, recurrenceId).toJSON()));
  const root = new ICAL.Component(copyOf(object.root.toJSON()));
  for (const name of ["vevent", "vtodo"]) root.removeAllSubcomponents(name);
  root.updatePropertyWithValue("prodid", PRODID);
  root.addSubcomponent(component);
  for (const name of ["rrule", "rdate", "exdate", "recurrence-id", "organizer", "attendee"]) {
    component.removeAllProperties(name);
  }
  // What says the original's reminders were seen or put off: not the copy's.
  component.removeAllProperties("x-moz-lastack");
  const snoozes = component
    .getAllProperties()
    .filter((property) => property.name.startsWith("x-moz-snooze-time"));
  for (const property of snoozes) component.removeProperty(property);
  if (component.name === "vtodo") {
    component.removeAllProperties("completed");
    if (component.hasProperty("status")) {
      component.updatePropertyWithValue("status", "NEEDS-ACTION");
    }
    if (component.hasProperty("percent-complete")) {
      component.updatePropertyWithValue("percent-complete", 0);
    }
  }
  for (const alarm of component.getAllSubcomponents("valarm")) {
    // A snooze (RFC 9074 §7: RELATED-TO;RELTYPE=SNOOZE, to the alarm put
    // off) belongs to the original's reminder, which the copy's never rang:
    // it goes whole. An alarm related to another in any other way stays.
    if (isSnooze(alarm)) {
      component.removeSubcomponent(alarm);
      continue;
    }
    for (const name of ["uid", "x-wr-alarmuid", "acknowledged"]) alarm.removeAllProperties(name);
  }
  const now = utc(options.now);
  component.updatePropertyWithValue("uid", options.uid);
  component.updatePropertyWithValue("dtstamp", now.clone());
  component.updatePropertyWithValue("created", now.clone());
  component.updatePropertyWithValue("last-modified", now.clone());
  component.updatePropertyWithValue("sequence", 0);
  return serialize(root);
}

/**
 * A new item from a copy (`copyItem`) with what the user changed: "Copy
 * to…" (design D164). Its first revision, `SEQUENCE:0`, as a new UID's is,
 * however many changes it took. Returns the iCalendar text.
 */
export function createFromCopy(
  copy: string,
  changes: ItemChanges,
  options: { readonly now: number },
): string {
  const object = CalendarObject.parse(editItem(CalendarObject.parse(copy), changes, options).ics);
  const { master, exceptions } = object.components;
  for (const component of [master, ...exceptions]) {
    component?.updatePropertyWithValue("sequence", 0);
  }
  return object.serialize();
}

/** A snooze alarm, as RFC 9074 §7 writes one: `RELATED-TO;RELTYPE=SNOOZE`. */
function isSnooze(alarm: ICAL.Component): boolean {
  return alarm
    .getAllProperties("related-to")
    .some((property) => String(property.getParameter("reltype") ?? "").toUpperCase() === "SNOOZE");
}
