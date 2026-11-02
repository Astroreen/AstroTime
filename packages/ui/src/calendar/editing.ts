// The edit dialog's form and what saving it writes (docs/plans/foundation.md#D9,
// D10, D11): an item's fields as the form shows them, the changes between
// two forms (only what the user changed reaches `@astrotime/core`'s edit, so
// nothing else is rewritten, D7), the scopes an occurrence's edit may take,
// and the writes through the local store (D5) that the sync engine uploads.
import {
  ALL_RIGHTS,
  CalendarObject,
  createItem,
  deleteItem,
  editItem,
  hasOccurrence,
  movedRepeat,
  placeText,
  repeatOf,
  timesOf,
  wallClockIn,
  WEEKDAYS,
  zonedTime,
  type Alarm,
  type CalendarRights,
  type Place,
  type Geo,
  type Item,
  type ItemChanges,
  type ItemTime,
  type ItemTimes,
  type NewAlarm,
  type Repeat,
  type Scope,
} from "@astrotime/core";
import {
  CommitInDoubtError,
  HandOverError,
  type Calendar,
  type LocalChange,
  type Store,
} from "@astrotime/storage";

import { nameAndAddress } from "../places/map.ts";
import { addDays, daysBetween } from "./dates.ts";
import { rightsOf } from "./rights.ts";

/** An item opened from a view, a search or the tasks screen: one occurrence of a stored object. */
export interface Target {
  readonly objectId: string;
  readonly calendarId: string;
  readonly object: CalendarObject;
  /** The occurrence's identity in its series; `null` for an item that does not recur. */
  readonly recurrenceId: ItemTime | null;
  /** What shows: the master, or the occurrence's exception. */
  readonly item: Item;
}

/** A reminder in the form: one the item has (by its index among its `VALARM`s), or a new one. */
export type AlarmChoice =
  | { readonly kind: "existing"; readonly index: number; readonly alarm: Alarm }
  | ({ readonly kind: "new" } & NewAlarm);

/**
 * How the item repeats in the form: a `Repeat`, `null` for not at all, or
 * `"kept"` for another client's rule beyond the presets, which stays as written.
 */
export type RepeatChoice = Repeat | null | "kept";

export interface Form {
  readonly kind: "event" | "task";
  readonly calendarId: string;
  readonly summary: string;
  /** A task's start and due alike (design D159). */
  readonly allDay: boolean;
  /**
   * `YYYY-MM-DD`. A task always has one (design D159): one opened without a
   * start shows its due's, or today's without either, written only with a
   * change of its times (foundation D7).
   */
  readonly startDate: string;
  /**
   * A task opened without a start (design D160): the form shows one, its
   * due's (following it) or today's, and writes none until the user sets it.
   */
  readonly startless?: boolean;
  /** `HH:MM`. */
  readonly startTime: string;
  /** An event's last day (inclusive) or end date; a task's due date, `""` for none. */
  readonly endDate: string;
  readonly endTime: string;
  /**
   * A task's due of another kind than its start, as another client wrote it
   * (a date after a timed start, or a time after a date start): it stays so
   * until "All day" is switched (design D160, foundation D7).
   */
  readonly dueKind?: "date" | "time";
  /** The IANA zone the times are in; `null` for a floating item. */
  readonly zone: string | null;
  /** A time written in UTC (as Nextcloud Tasks writes) stays UTC, though edited in `zone`. */
  readonly utc: boolean;
  readonly repeat: RepeatChoice;
  readonly alarms: readonly AlarmChoice[];
  readonly location: string;
  /**
   * The place `location` names on the map: picked from the place search, or
   * the item's own; `null` for free text (design D175).
   */
  readonly place: Place | null;
  readonly description: string;
  /** RFC 7986 `COLOR`; `null` for the calendar's. */
  readonly color: string | null;
  /**
   * While creating, an event switched to a task: how many days after its
   * start it ended, and at what time; switched back, it has them again.
   */
  readonly asEvent?: { readonly days: number; readonly endTime: string };
}

/** The form's view of a wall clock: its date and its `HH:MM`. */
function split(time: ItemTime, zone: string | null): { date: string; time: string } {
  if (time.type === "date") return { date: time.date, time: "" };
  const local = time.type === "zoned" && zone ? wallClockIn(time.epochMs, zone) : time.local;
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/** The zone an item's times are edited in: its own, or the user's for UTC and dates. */
function zoneOf(times: ItemTimes, timeZone: string): { zone: string | null; utc: boolean } {
  // The first time with a clock: a timed due after a date start keeps its own zone (D7).
  const time = [times.start, times.end].find((t) => t && t.type !== "date") ?? null;
  if (!time || time.type === "date") return { zone: timeZone, utc: false };
  if (time.type === "floating") return { zone: null, utc: false };
  if (time.timeZone === "UTC") return { zone: timeZone, utc: true };
  return { zone: time.timeZone, utc: false };
}

/** Times as the form shows them in `zone`: dates and clocks, an all-day event's end its last day. */
function formTimes(kind: "event" | "task", times: ItemTimes, zone: string | null) {
  const first = times.start ?? times.end;
  // A task with neither a start nor a due is a day's, as one made today (design D159).
  const allDay = first ? first.type === "date" : kind === "task";
  const start = times.start ? split(times.start, zone) : { date: "", time: "" };
  let end = times.end ? split(times.end, zone) : { date: "", time: "" };
  // A task's due date after a timed start (another client's) shows at the
  // start's time on its day, so a new start moves it by whole days (design D160).
  if (kind === "task" && !allDay && end.date && !end.time) end = { ...end, time: start.time };
  // An all-day event's DTEND is the day after its last; the form shows the last.
  if (kind === "event" && allDay && times.end) end = { date: addDays(end.date, -1), time: "" };
  return { allDay, start, end };
}

/**
 * The form for an item opened: the occurrence's times, the item's fields. A
 * task without a start starts at its due, or today without one (design
 * D159); the form holds it from the first, so it is written only when the
 * user changes the times (foundation D7).
 */
export function formOf(target: Target, timeZone: string, today: string): Form {
  const { item, object } = target;
  const times = timesOf(object, target.recurrenceId);
  const { zone, utc } = zoneOf(times, timeZone);
  const { allDay, start, end } = formTimes(item.kind, times, zone);
  const rule = repeatOf(object);
  const task = item.kind === "task" ? item : null;
  const from = task && !start.date ? (end.date ? end : { date: today, time: "" }) : start;
  const due = task && start.date ? times.end : null;
  const dueKind = due && (due.type === "date") !== allDay ? (allDay ? "time" : "date") : null;
  return {
    kind: item.kind,
    calendarId: target.calendarId,
    summary: item.summary ?? "",
    allDay,
    startDate: from.date,
    startTime: from.time || "09:00",
    ...(task && !start.date ? { startless: true } : {}),
    endDate: end.date,
    endTime: end.time || "10:00",
    ...(dueKind ? { dueKind } : {}),
    zone,
    utc,
    repeat: rule ? (rule.exact ? rule.repeat : "kept") : null,
    alarms: item.alarms.map((alarm, index) => ({ kind: "existing", index, alarm })),
    location: item.location ?? "",
    // The point with the very text it belongs to, so a copy writes both (D176).
    place: item.geo ? placeOfItem(item.location ?? "", item.geo, item.placeLabel) : null,
    description: item.description ?? "",
    color: item.color,
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A new item's form, as Google prefills it: on `day` from the next half
 * hour after `minutes` (or at `at`, a tapped slot), or all day; an event an
 * hour long (or `length` minutes, a press dragged over the grid), a task
 * at that start with no due (design D159).
 */
export function newForm(
  kind: "event" | "task",
  options: {
    readonly calendarId: string;
    readonly day: string;
    /** Minutes past midnight now; the item starts at the next half hour. */
    readonly minutes: number;
    /** Minutes past midnight of a tapped slot: the item starts there. */
    readonly at?: number;
    /** Minutes the event lasts; an hour by default. */
    readonly length?: number;
    /** On the day, with no time: the tasks screen's new task. */
    readonly allDay?: boolean;
    readonly timeZone: string;
  },
): Form {
  const allDay = options.allDay ?? false;
  const startMinutes = options.at ?? Math.ceil((options.minutes + 1) / 30) * 30;
  const startDay = allDay ? options.day : addDays(options.day, Math.floor(startMinutes / 1440));
  const endMinutes = startMinutes + (options.length ?? 60);
  const endDay = allDay ? options.day : addDays(options.day, Math.floor(endMinutes / 1440));
  return {
    kind,
    calendarId: options.calendarId,
    summary: "",
    allDay,
    startDate: startDay,
    startTime: clockOf(startMinutes),
    endDate: kind === "event" ? endDay : "",
    endTime: clockOf(endMinutes),
    zone: options.timeZone,
    utc: false,
    repeat: null,
    alarms: [],
    location: "",
    place: null,
    description: "",
    color: null,
  };
}

/**
 * The form switched to the other kind while creating: the same title, start
 * and all-day state (design D159). A task has no due to begin with; the
 * event it was keeps its days and end time, and has them again switched
 * back (D143). A task made an event otherwise lasts an hour, or its one day.
 */
export function switchKind(form: Form, kind: "event" | "task"): Form {
  if (form.kind === kind) return form;
  if (kind === "task") {
    const days = form.endDate ? daysBetween(form.startDate, form.endDate) : 0;
    return { ...form, kind, endDate: "", asEvent: { days, endTime: form.endTime } };
  }
  const { asEvent, ...task } = form;
  const event: Form = { ...task, kind };
  if (asEvent) {
    const back = {
      ...event,
      endDate: addDays(form.startDate, asEvent.days),
      endTime: asEvent.endTime,
    };
    // An end the start has passed meanwhile is the start's hour, as a new event's.
    if (form.allDay || back.endDate > back.startDate || back.endTime >= back.startTime) return back;
  }
  if (form.allDay) return { ...event, endDate: form.startDate };
  const end = minutesOf(form.startTime) + 60;
  return {
    ...event,
    endDate: addDays(form.startDate, Math.floor(end / 1440)),
    endTime: clockOf(end),
  };
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const clockOf = (minutes: number) =>
  `${pad(Math.floor((minutes % 1440) / 60))}:${pad(minutes % 60)}`;

/**
 * A new start time: a timed event keeps its length, as Google moves its end
 * with it, over midnight too (design D108); a task's due moves with its
 * start the same way (design D159).
 */
export function withStartTime(given: Form, startTime: string): Form {
  const form = started(given);
  // A due date stays on its day when only the start's clock changes (design D160).
  if (form.allDay || !form.startDate || !form.endDate || dueIsDate(form)) {
    return { ...form, startTime };
  }
  const days = daysBetween(form.startDate, form.endDate);
  const length = days * 1440 + minutesOf(form.endTime) - minutesOf(form.startTime);
  // No length (no DTEND) is a length too: the end moves with the start.
  if (length < 0) return { ...form, startTime };
  const end = minutesOf(startTime) + length;
  return {
    ...form,
    startTime,
    endDate: addDays(form.startDate, Math.floor(end / 1440)),
    endTime: clockOf(end),
  };
}

/** The start date moved: an event keeps its length in days, a task its due as many days after. */
export function withStartDate(given: Form, startDate: string): Form {
  const form = started(given);
  if (!form.startDate || !form.endDate) return { ...form, startDate };
  return {
    ...form,
    startDate,
    endDate: addDays(startDate, daysBetween(form.startDate, form.endDate)),
  };
}

/**
 * A task's due set or cleared (design D159): set, on its start's day, an
 * hour after its start when it has a time (the next day's past midnight).
 */
export function withDue(form: Form, due: boolean): Form {
  // A task without a start keeps the one shown once its due goes: it needs a time.
  if (!due) {
    const { dueKind: _, ...rest } = started(form);
    return { ...rest, endDate: "" };
  }
  if (form.allDay) return withDueAt(form, { endDate: form.startDate });
  const end = minutesOf(form.startTime) + 60;
  return withDueAt(form, {
    endDate: addDays(form.startDate, Math.floor(end / 1440)),
    endTime: clockOf(end),
  });
}

/**
 * A task's due day or time changed; one without a start shows its start
 * there too, as the calendar will show it (design D160).
 */
export function withDueAt(form: Form, due: { endDate?: string; endTime?: string }): Form {
  const next = { ...form, ...due };
  return next.startless ? { ...next, startDate: next.endDate, startTime: next.endTime } : next;
}

/**
 * The reminders changed. A task with no time written gets its start shown
 * written with a new reminder, which counts from it (RFC 5545 §3.6.6 wants
 * a `DTSTART` for `RELATED=START`; design D160).
 */
export function withAlarms(form: Form, alarms: readonly AlarmChoice[]): Form {
  const added = alarms.some((alarm) => alarm.kind === "new");
  const timeless = form.startless && !form.endDate;
  return { ...(added && timeless ? started(form) : form), alarms };
}

/** Whether a task's due is a date: as its start, unless another client wrote it otherwise. */
export function dueIsDate(form: Form): boolean {
  return form.dueKind ? form.dueKind === "date" : form.allDay;
}

/** All day or not, the start's and the due's alike: the start shown is written from then on (design D160). */
export function withAllDay(form: Form, allDay: boolean): Form {
  const { dueKind: _, ...both } = started(form);
  return { ...both, allDay };
}

/** The form with its start set by the user: written from now on (design D160). */
function started(form: Form): Form {
  if (!form.startless) return form;
  const { startless: _, ...rest } = form;
  return rest;
}

/** The day an item's occurrences are counted from: its start (a task always has one, design D159). */
const anchorDay = (form: Form) => form.startDate || form.endDate;

/** A rule moved with its item from day `from` to day `to`, as `@astrotime/core` moves the RRULE (D105). */
function repeatMoved(repeat: RepeatChoice, from: string, to: string): RepeatChoice {
  return repeat && repeat !== "kept" && from && to ? movedRepeat(repeat, from, to) : repeat;
}

/**
 * The form after a change: an item moved to another day takes its rule along
 * unless the rule changed too (a weekly rule's weekdays shift, a monthly
 * rule on the nth weekday names the new day's), so the dialog says what
 * saving writes (D105).
 */
export function followed(previous: Form, next: Form): Form {
  const from = anchorDay(previous);
  const to = anchorDay(next);
  if (from === to || next.repeat !== previous.repeat) return next;
  return { ...next, repeat: repeatMoved(next.repeat, from, to) };
}

/** A form's date and time as an `ItemTime` in its zone (UTC when it was). */
function timeOf(form: Form, date: string, time: string, allDay = form.allDay): ItemTime {
  if (allDay) return { type: "date", date };
  const local = `${date}T${time}:00`;
  if (form.zone === null) return { type: "floating", local };
  const zoned = zonedTime(local, form.zone);
  return form.utc ? zonedTime(wallClockIn(zoned.epochMs, "UTC"), "UTC") : zoned;
}

/** When the form says the item is. */
export function timesOfForm(form: Form): ItemTimes {
  if (form.kind === "event") {
    return {
      start: timeOf(form, form.startDate, form.startTime),
      end: form.allDay
        ? { type: "date", date: addDays(form.endDate, 1) }
        : timeOf(form, form.endDate, form.endTime),
    };
  }
  return {
    start: form.startDate && !form.startless ? timeOf(form, form.startDate, form.startTime) : null,
    end: form.endDate ? timeOf(form, form.endDate, form.endTime, dueIsDate(form)) : null,
  };
}

export type Problem = "endBeforeStart" | "dueBeforeStart" | "untilBeforeStart" | "noDate";

const localOf = (time: ItemTime) => (time.type === "date" ? `${time.date}T00:00:00` : time.local);

/** Later (positive), earlier or the same: instants when both have one, else wall clocks. */
function compare(a: ItemTime, b: ItemTime): number {
  if (a.type === "zoned" && b.type === "zoned") return a.epochMs - b.epochMs;
  return localOf(a).localeCompare(localOf(b));
}

/**
 * Why a form cannot be saved, as a catalog key; `null` when it can. An event
 * lasts, unless it already had no length (no `DTEND`, as RFC 5545 allows,
 * from another client): moved, it keeps none; a task may be due when it
 * starts.
 */
export function problemOf(form: Form, initial: Form | null = null): Problem | null {
  if (!form.startDate || (form.kind === "event" && !form.endDate)) return "noDate";
  const { start, end } = timesOfForm(form);
  if (start && end && form.kind === "event") {
    const length = compare(end, start);
    if (length < 0 || (length === 0 && !(initial && hasNoLength(initial)))) {
      return "endBeforeStart";
    }
  }
  if (start && end && form.kind === "task" && compare(end, start) < 0) return "dueBeforeStart";
  const repeat = form.repeat;
  const first = form.startDate || form.endDate;
  if (repeat && repeat !== "kept" && repeat.end.type === "until" && repeat.end.until < first) {
    return "untilBeforeStart";
  }
  return null;
}

/** An event that ends when it starts. */
function hasNoLength(form: Form): boolean {
  const { start, end } = timesOfForm(form);
  return form.kind === "event" && start !== null && end !== null && compare(end, start) === 0;
}

/** The same rule: weekdays in any order are the same days. */
function sameRepeat(a: RepeatChoice, b: RepeatChoice): boolean {
  const days = (r: RepeatChoice) =>
    r && r !== "kept" ? { ...r, weekdays: WEEKDAYS.filter((day) => r.weekdays.includes(day)) } : r;
  return JSON.stringify(days(a)) === JSON.stringify(days(b));
}

/** Whether the user changed the rule, beyond its moving with the item's day. */
function ruleChanged(initial: Form, form: Form): boolean {
  const moved = repeatMoved(initial.repeat, anchorDay(initial), anchorDay(form));
  return !sameRepeat(moved, form.repeat);
}

/** An item's place: its name, address and point, with the text it was written as. */
function placeOfItem(location: string, geo: Geo, label: Item["placeLabel"]): Place {
  const { name, address } = nameAndAddress(location, label);
  return { name, address, geo, written: { text: location, name, address } };
}

/** Two places alike: the same text on the same point, however each form was made. */
const samePlace = (a: Place | null, b: Place | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    placeText(a) === placeText(b) &&
    a.geo.lat === b.geo.lat &&
    a.geo.lon === b.geo.lon);

/**
 * What the user changed from `initial` to `form`; for a new item, everything
 * it holds. `untitled` is what a reminder added to an item without a title
 * says, in the user's language (foundation D103).
 */
export function changesOf(initial: Form | null, form: Form, untitled: string): ItemChanges {
  const changes: { -readonly [K in keyof ItemChanges]: ItemChanges[K] } = {};
  const was = initial;
  const differs = <K extends keyof Form>(key: K) => !was || was[key] !== form[key];
  if (differs("summary") && (was || form.summary.trim())) changes.summary = form.summary.trim();
  if (
    (differs("location") || !samePlace(was?.place ?? null, form.place)) &&
    (was || form.location.trim())
  ) {
    // A place picked is written with its point while its text stays as picked (D176).
    const text = form.location.trim();
    changes.location = form.place && placeText(form.place) === text ? form.place : text;
  }
  if (differs("description") && (was || form.description.trim()))
    changes.description = form.description.trim();
  // The clock matters only for a timed item; a new item always has a start (design D159).
  const timeChanged = was
    ? was.allDay !== form.allDay ||
      // A start shown, now to be written (design D160).
      Boolean(was.startless) !== Boolean(form.startless) ||
      was.startDate !== form.startDate ||
      was.endDate !== form.endDate ||
      was.dueKind !== form.dueKind ||
      (!form.allDay && was.startTime !== form.startTime) ||
      (!dueIsDate(form) && was.endTime !== form.endTime)
    : true;
  if (timeChanged) changes.time = timesOfForm(form);
  // A rule only moved with the item's day is the core's to move (D105).
  if (form.repeat !== "kept" && (was ? ruleChanged(was, form) : form.repeat)) {
    changes.repeat = form.repeat;
  }
  const kept = new Set(form.alarms.flatMap((a) => (a.kind === "existing" ? [a.index] : [])));
  const remove = (was?.alarms ?? []).flatMap((a) =>
    a.kind === "existing" && !kept.has(a.index) ? [a.index] : [],
  );
  const add = form.alarms.flatMap((a) =>
    a.kind === "new" ? [{ relatedTo: a.relatedTo, offsetSeconds: a.offsetSeconds }] : [],
  );
  if (remove.length > 0 || add.length > 0) changes.alarms = { remove, add, untitled };
  if (differs("color") && (was || form.color)) changes.color = form.color;
  return changes;
}

/** Whether an item is an occurrence of a series, whose edits ask for a scope (D11). */
export function isOccurrence(target: Target): boolean {
  return target.recurrenceId !== null && repeatsOrHasDates(target.object);
}

function repeatsOrHasDates(object: CalendarObject): boolean {
  return object.master?.recurring ?? false;
}

/**
 * The scopes an occurrence's edit may take, as Google offers them: a new
 * rule is not one occurrence's; a new day is not every occurrence's (a rule
 * that only moved with the day is no new rule); a move to another calendar
 * takes the whole series. "This and following" splits the series, a new item
 * in its calendar (D105), so only a calendar that takes new items offers it
 * (D37). Empty: no question to ask; `null`: only a split could save it, and
 * its calendar takes none.
 */
export function scopesFor(
  target: Target | null,
  initial: Form | null,
  form: Form,
  rights: CalendarRights = ALL_RIGHTS,
): Scope[] | null {
  if (!target || !initial || !isOccurrence(target)) return [];
  if (initial.calendarId !== form.calendarId) return [];
  // Nothing to save asks nothing, as a drop that changes nothing (D111).
  if (Object.keys(changesOf(initial, form, "")).length === 0) return [];
  const day = initial.startDate !== form.startDate || initial.endDate !== form.endDate;
  return allowed(scopesOf(ruleChanged(initial, form), day), rights);
}

/**
 * The scopes an occurrence moved or resized to `times` may take (a drag or
 * a key, foundation D113), by the dialog's rule: its rule stays, so a new
 * day is not every occurrence's, and "this occurrence" is always one, so
 * there is always one to take. Empty: no question to ask.
 */
export function scopesForTimes(
  target: Target,
  times: ItemTimes,
  timeZone: string,
  rights: CalendarRights = ALL_RIGHTS,
): Scope[] {
  if (!isOccurrence(target)) return [];
  const days = (of: ItemTimes) => {
    const { start, end } = formTimes(target.item.kind, of, zoneOf(of, timeZone).zone);
    return `${start.date}/${end.date}`;
  };
  const day = days(timesOf(target.object, target.recurrenceId)) !== days(times);
  return allowed(scopesOf(false, day), rights) ?? ["this"];
}

function scopesOf(repeat: boolean, day: boolean): Scope[] {
  if (repeat && day) return ["following"];
  if (repeat) return ["following", "all"];
  if (day) return ["this", "following"];
  return ["this", "following", "all"];
}

/** The scopes a calendar's rights allow: a split is a new item (D105, D37); `null` for none. */
function allowed(scopes: Scope[], rights: CalendarRights): Scope[] | null {
  const kept = scopes.filter((scope) => scope !== "following" || rights.create);
  return kept.length > 0 ? kept : null;
}

/**
 * The scopes a deletion may take in a calendar with these rights (D37,
 * D105): one occurrence, or it and the following ones, change the series (an
 * edit); all of them delete it, as a deletion of an item that does not
 * repeat does. A series held without its master loses one exception, an
 * edit, unless it is the last, which deletes the object. Empty: it cannot be
 * deleted.
 */
export function deleteScopes(target: Target, rights: CalendarRights): Scope[] {
  if (!target.object.master && target.recurrenceId !== null) {
    const last = target.object.exceptions.length <= 1;
    return (last ? rights.delete : rights.edit) ? ["this"] : [];
  }
  if (!isOccurrence(target)) return rights.delete ? ["all"] : [];
  // From the first occurrence "this and following" deletes the whole series.
  const following = isFirstOccurrence(target) ? rights.delete : rights.edit;
  return [
    ...(rights.edit ? (["this"] as const) : []),
    ...(following ? (["following"] as const) : []),
    ...(rights.delete ? (["all"] as const) : []),
  ];
}

/** Whether an occurrence is its series' first (its start is the series'). */
function isFirstOccurrence(target: Target): boolean {
  const start = target.object.master?.start;
  const at = target.recurrenceId;
  if (!start || !at) return false;
  if (start.type === "date" || at.type === "date") {
    const day = (time: typeof at) => (time.type === "date" ? time.date : time.local.slice(0, 10));
    return day(start) === day(at);
  }
  if (start.type === "zoned" && at.type === "zoned") return start.epochMs === at.epochMs;
  return start.local === at.local;
}

/**
 * The calendars an item of this kind can be saved in, holding its component
 * (D37): for a new item, those that take new items; for one in `from`, that
 * calendar, and the others that take new items only when `from` lets it go,
 * since a move is a creation there and a deletion here (D106).
 */
export function calendarsFor(
  calendars: readonly Calendar[],
  kind: "event" | "task",
  from?: Calendar,
): Calendar[] {
  const component = kind === "event" ? "VEVENT" : "VTODO";
  return calendars.filter((c) => {
    if (!c.components.includes(component)) return false;
    if (c.id === from?.id) return rightsOf(c).edit;
    return rightsOf(c).create && (from === undefined || rightsOf(from).delete);
  });
}

/**
 * The calendar a new item goes to by default: the first that takes it,
 * visible before hidden, in the order the calendars are listed. The edit
 * dialog's choice and the save's fallback are this one list (D122).
 */
export function firstCalendarFor(
  calendars: readonly Calendar[],
  kind: "event" | "task",
  hidden: ReadonlySet<string> = new Set(),
): Calendar | undefined {
  const list = calendarsFor(calendars, kind);
  return list.find((calendar) => !hidden.has(calendar.id)) ?? list[0];
}

/**
 * Where a new item goes, from the calendar its form names and the calendars
 * as they are (foundation D122): that one while it takes the item; that one
 * still, but `refused`, while it is there and no longer takes it (read-only
 * now, its components changed: the dialog keeps showing it, and the user
 * picks again); else, when it is gone, the first that takes the item; none
 * when no calendar does. The dialog's field shows this, and the save uses it.
 */
export function newItemCalendar(
  calendars: readonly Calendar[],
  form: Pick<Form, "kind" | "calendarId">,
  hidden?: ReadonlySet<string>,
): { readonly calendar: Calendar; readonly refused: boolean } | null {
  const chosen = calendars.find((calendar) => calendar.id === form.calendarId);
  if (chosen) return { calendar: chosen, refused: calendarsFor([chosen], form.kind).length === 0 };
  const first = firstCalendarFor(calendars, form.kind, hidden);
  return first ? { calendar: first, refused: false } : null;
}

interface Writes {
  readonly now: number;
  /** A new UID, for a new item or the series "this and following" starts. */
  readonly uid: () => string;
}

/** The item opened, or its occurrence, is no longer there: deleted here, in another tab or by a sync. */
export class GoneError extends Error {
  override name = "GoneError";
}

/**
 * The calendar chosen for a new item is still there but no longer takes it
 * (read-only now, or its components changed): nothing is saved, and the
 * dialog stays open for another calendar (foundation D122).
 */
export class RefusedError extends Error {
  override name = "RefusedError";
}

/** No calendar takes a new item now: nothing is saved (foundation D122). */
export class NowhereError extends Error {
  override name = "NowhereError";
}

/** The store's leader went as a change committed, and the change is not there to read (D99). */
export class InDoubtError extends Error {
  override name = "InDoubtError";
}

/**
 * Runs a change made here in one store transaction (`Store.changeLocal`,
 * D99), so it applies to what the store holds now and lands whole. A
 * `HandOverError` means nothing was written: it runs once more. A
 * `CommitInDoubtError` is answered by reading again: done if what it wrote is
 * there, else an `InDoubtError` for the user to look.
 */
export async function changeLocal(
  store: Store,
  change: (local: LocalChange) => Promise<void>,
): Promise<void> {
  let written: { id: string; ics: string | null }[] = [];
  const attempt = () => {
    written = [];
    return store.changeLocal((local) =>
      change({
        object: (id) => local.object(id),
        calendars: () => local.calendars(),
        async save(calendarId, ics, href) {
          const row = await local.save(calendarId, ics, href);
          written.push({ id: row.id, ics });
          return row;
        },
        async delete(id) {
          await local.delete(id);
          written.push({ id, ics: null });
        },
      }),
    );
  };
  for (let tries = 1; ; tries++) {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof CommitInDoubtError) {
        if (await landed(store, written)) return;
        throw new InDoubtError("The change may not have been saved.", { cause: error });
      }
      if (!(error instanceof HandOverError) || tries > 1) throw error;
    }
  }
}

/** Whether the store holds what a change wrote: each object saved as it was, each deleted gone. */
async function landed(
  store: Store,
  written: readonly { id: string; ics: string | null }[],
): Promise<boolean> {
  for (const { id, ics } of written) {
    const row = await store.object(id);
    const there = ics === null ? !row || row.pending === "delete" : row?.ics === ics;
    if (!there) return false;
  }
  return true;
}

/** The object opened, as the store holds it now, with the occurrence opened still in it. */
async function current(local: LocalChange, target: Target) {
  const stored = await local.object(target.objectId);
  if (!stored || stored.pending === "delete") throw new GoneError("The item was deleted.");
  const object = CalendarObject.parse(stored.ics);
  if (target.recurrenceId !== null && !hasOccurrence(object, target.recurrenceId)) {
    throw new GoneError("The occurrence is no longer in its series.");
  }
  return { stored, object };
}

/** What shows of an occurrence: its exception, or the master. */
export function itemOf(object: CalendarObject, recurrenceId: ItemTime | null): Item | null {
  const id = recurrenceId && JSON.stringify(recurrenceId);
  const exception = id && object.exceptions.find((e) => JSON.stringify(e.recurrenceId) === id);
  return exception || object.master || object.exceptions[0] || null;
}

/**
 * The changes with the reminders removed found again, by what they are, in
 * the item as the store holds it now: one another device took away meanwhile
 * is no longer there to remove, and the others may sit elsewhere in the list.
 */
function againstCurrent(changes: ItemChanges, target: Target, object: CalendarObject) {
  if (!changes.alarms || changes.alarms.remove.length === 0) return changes;
  const now = (itemOf(object, target.recurrenceId)?.alarms ?? []).map((a) => JSON.stringify(a));
  const taken = new Set<number>();
  const remove = changes.alarms.remove.flatMap((index) => {
    const alarm = JSON.stringify(target.item.alarms[index]);
    const at = now.findIndex((other, i) => !taken.has(i) && other === alarm);
    if (at < 0) return [];
    taken.add(at);
    return [at];
  });
  return { ...changes, alarms: { ...changes.alarms, remove } };
}

/**
 * Saves the form through the local store as pending changes (D5): a new
 * item under `<uid>.ics` in its calendar, an edit in its scope (a split
 * series' second half as a new item), a move to another calendar as a new
 * item there and a deletion here, since the provider has no MOVE. An edit
 * applies what the user changed to the object as the store holds it at
 * saving, not as it was when the dialog opened: a sync or another tab may
 * have changed it meanwhile, and that change stays (D7). An item or an
 * occurrence gone meanwhile is a `GoneError`.
 */
export async function saveForm(
  store: Store,
  request: {
    readonly target: Target | null;
    readonly initial: Form | null;
    readonly form: Form;
    readonly scope: Scope;
    /** What a reminder added to an item without a title says, in the user's language. */
    readonly untitled: string;
    /** The calendars hidden from the views, which a new item's fallback passes over first. */
    readonly hidden?: ReadonlySet<string>;
  },
  writes: Writes,
): Promise<void> {
  const { target, initial, form, untitled } = request;
  if (!target || !initial) {
    const ics = createItem(form.kind, changesOf(null, form, untitled), {
      now: writes.now,
      uid: writes.uid(),
    });
    await changeLocal(store, async (local) => {
      // The calendars as they are now, in this transaction: the screen's
      // list may not have caught up (foundation D122). Where it goes is what
      // the dialog shows (`newItemCalendar`, the same rule and list).
      const into = newItemCalendar(await local.calendars(), form, request.hidden);
      if (!into) throw new NowhereError("No calendar takes this item now.");
      if (into.refused) throw new RefusedError("The calendar chosen no longer takes this item.");
      await local.save(into.calendar.id, ics);
    });
    return;
  }
  await saveChanges(
    store,
    {
      target,
      changes: changesOf(initial, form, untitled),
      calendarId: form.calendarId,
      scope: request.scope,
    },
    writes,
  );
}

/**
 * Saves what the user changed of an item, in `scope`, into `calendarId`:
 * the edit dialog's save, and a drag's or a key's new times (D113).
 * Nothing changed, nothing is written.
 */
export async function saveChanges(
  store: Store,
  request: {
    readonly target: Target;
    readonly changes: ItemChanges;
    readonly calendarId: string;
    readonly scope: Scope;
  },
  writes: Writes,
): Promise<void> {
  const { target, changes, calendarId } = request;
  const moving = calendarId !== target.calendarId;
  if (!moving && Object.keys(changes).length === 0) return;
  const newUid = writes.uid();
  await changeLocal(store, async (local) => {
    const { stored, object } = await current(local, target);
    const edit = againstCurrent(changes, target, object);
    if (moving) {
      // The whole series moves; a new time moves it as the occurrence moved (D105).
      const { ics } = editItem(object, edit, {
        now: writes.now,
        scope: "all",
        recurrenceId: target.recurrenceId,
      });
      await local.save(calendarId, ics);
      await local.delete(stored.id);
      return;
    }
    // A series held without its master has each exception edited on its own.
    const { ics, split: rest } = editItem(object, edit, {
      now: writes.now,
      scope: request.scope,
      recurrenceId: target.recurrenceId,
      newUid,
    });
    await local.save(stored.calendarId, ics, stored.href);
    if (rest) await local.save(stored.calendarId, rest);
  });
}

/**
 * Deletes an item, or the occurrences `scope` covers, through the local
 * store, from the object as it holds it now. One already gone needs nothing.
 */
export async function deleteTarget(
  store: Store,
  target: Target,
  scope: Scope,
  now: number,
): Promise<void> {
  await changeLocal(store, async (local) => {
    const stored = await local.object(target.objectId);
    if (!stored || stored.pending === "delete") return;
    const object = CalendarObject.parse(stored.ics);
    const id = target.recurrenceId;
    if (id !== null && scope === "this" && !hasOccurrence(object, id)) return;
    // A series held without its master loses only the exception asked for.
    const ics = deleteItem(object, {
      now,
      scope: object.master ? scope : "this",
      recurrenceId: id,
    });
    if (ics === null) await local.delete(stored.id);
    else await local.save(stored.calendarId, ics, stored.href);
  });
}

/**
 * Writes one change of the item opened (a task's completion or star) onto
 * the object as the store holds it now, through `changeLocal`: an item or an
 * occurrence gone meanwhile is a `GoneError`, as for saving the form.
 */
export async function rewriteTarget(
  store: Store,
  target: Target,
  ics: (object: CalendarObject) => string,
): Promise<void> {
  await changeLocal(store, async (local) => {
    const { stored, object } = await current(local, target);
    await local.save(stored.calendarId, ics(object), stored.href);
  });
}

/**
 * What the user is told when a change made outside the edit dialog did not
 * land (D99, D103), or a place's address could not be copied (design D177).
 */
export type Notice =
  | "gone"
  | "inDoubt"
  | "failed"
  | "deleteInDoubt"
  | "deleteFailed"
  | "copyFailed";

/** The notice for a change that failed; a deletion of an item gone already never does. */
export function noticeOf(error: unknown, action: "change" | "delete"): Notice | null {
  if (action === "delete") {
    // Gone already (deleted elsewhere, or no longer in its series): what was asked is done.
    if (error instanceof GoneError) return null;
    return error instanceof InDoubtError ? "deleteInDoubt" : "deleteFailed";
  }
  return error instanceof GoneError ? "gone" : error instanceof InDoubtError ? "inDoubt" : "failed";
}
