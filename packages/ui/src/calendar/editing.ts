// The edit dialog's form and what saving it writes (docs/plans/foundation.md#D9,
// D10, D11): an item's fields as the form shows them, the changes between
// two forms (only what the user changed reaches `@astrotime/core`'s edit, so
// nothing else is rewritten, D7), the scopes an occurrence's edit may take,
// and the writes through the local store (D5) that the sync engine uploads.
import {
  createItem,
  deleteItem,
  editItem,
  repeatOf,
  timesOf,
  wallClockIn,
  weekdayOf,
  zonedTime,
  type Alarm,
  type CalendarObject,
  type Item,
  type ItemChanges,
  type ItemTime,
  type ItemTimes,
  type NewAlarm,
  type Repeat,
  type Scope,
  type TaskStatus,
} from "@astrotime/core";
import type { Calendar, Store } from "@astrotime/storage";

import { addDays } from "./dates.ts";

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
  readonly allDay: boolean;
  /** `YYYY-MM-DD`; a task's is `""` when it has no start. */
  readonly startDate: string;
  /** `HH:MM`. */
  readonly startTime: string;
  /** An event's last day (inclusive) or end date; a task's due date, `""` for none. */
  readonly endDate: string;
  readonly endTime: string;
  /** The IANA zone the times are in; `null` for a floating item. */
  readonly zone: string | null;
  /** A time written in UTC (as Nextcloud Tasks writes) stays UTC, though edited in `zone`. */
  readonly utc: boolean;
  readonly repeat: RepeatChoice;
  readonly alarms: readonly AlarmChoice[];
  readonly location: string;
  readonly description: string;
  /** RFC 7986 `COLOR`; `null` for the calendar's. */
  readonly color: string | null;
  readonly status: TaskStatus;
  readonly priority: number | null;
  readonly percent: number | null;
  /** The categories, comma-separated. */
  readonly categories: string;
}

/** The form's view of a wall clock: its date and its `HH:MM`. */
function split(time: ItemTime, zone: string | null): { date: string; time: string } {
  if (time.type === "date") return { date: time.date, time: "" };
  const local = time.type === "zoned" && zone ? wallClockIn(time.epochMs, zone) : time.local;
  return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

const STATUSES: readonly TaskStatus[] = ["NEEDS-ACTION", "IN-PROCESS", "COMPLETED", "CANCELLED"];

/** The zone an item's times are edited in: its own, or the user's for UTC and dates. */
function zoneOf(times: ItemTimes, timeZone: string): { zone: string | null; utc: boolean } {
  const time = times.start ?? times.end;
  if (!time || time.type === "date") return { zone: timeZone, utc: false };
  if (time.type === "floating") return { zone: null, utc: false };
  if (time.timeZone === "UTC") return { zone: timeZone, utc: true };
  return { zone: time.timeZone, utc: false };
}

/** The form for an item opened: the occurrence's times, the item's fields. */
export function formOf(target: Target, timeZone: string): Form {
  const { item, object } = target;
  const times = timesOf(object, target.recurrenceId);
  const { zone, utc } = zoneOf(times, timeZone);
  const allDay = (times.start ?? times.end)?.type === "date";
  const start = times.start ? split(times.start, zone) : { date: "", time: "" };
  let end = times.end ? split(times.end, zone) : { date: "", time: "" };
  // An all-day event's DTEND is the day after its last; the form shows the last.
  if (item.kind === "event" && allDay && times.end) end = { date: addDays(end.date, -1), time: "" };
  const rule = repeatOf(object);
  const task = item.kind === "task" ? item : null;
  return {
    kind: item.kind,
    calendarId: target.calendarId,
    summary: item.summary ?? "",
    allDay,
    startDate: start.date,
    startTime: start.time || "09:00",
    endDate: end.date,
    endTime: end.time || "10:00",
    zone,
    utc,
    repeat: rule ? (rule.exact ? rule.repeat : "kept") : null,
    alarms: item.alarms.map((alarm, index) => ({ kind: "existing", index, alarm })),
    location: item.location ?? "",
    description: item.description ?? "",
    color: item.color,
    status: STATUSES.find((s) => s === task?.status?.toUpperCase()) ?? "NEEDS-ACTION",
    priority: task?.priority ?? null,
    percent: task?.percentComplete ?? null,
    categories: item.categories.join(", "),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A new item's form, as Google prefills it: an event on `day` from the next
 * half hour after `minutes` (or at `at`, a tapped slot), an hour long; a task
 * due on `day`, all day, or undated without one.
 */
export function newForm(
  kind: "event" | "task",
  options: {
    readonly calendarId: string;
    readonly day: string | null;
    /** Minutes past midnight now; the event starts at the next half hour. */
    readonly minutes: number;
    /** Minutes past midnight of a tapped slot: the event starts there. */
    readonly at?: number;
    readonly timeZone: string;
  },
): Form {
  const startMinutes = options.at ?? Math.ceil((options.minutes + 1) / 30) * 30;
  const day = options.day ?? "";
  const startDay = addDays(day || "2000-01-01", Math.floor(startMinutes / 1440));
  const endMinutes = startMinutes + 60;
  const endDay = addDays(day || "2000-01-01", Math.floor(endMinutes / 1440));
  const clock = (m: number) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
  const event = kind === "event";
  return {
    kind,
    calendarId: options.calendarId,
    summary: "",
    allDay: !event,
    startDate: event ? startDay : "",
    startTime: clock(startMinutes),
    endDate: event ? endDay : day,
    endTime: clock(endMinutes),
    zone: options.timeZone,
    utc: false,
    repeat: null,
    alarms: [],
    location: "",
    description: "",
    color: null,
    status: "NEEDS-ACTION",
    priority: null,
    percent: null,
    categories: "",
  };
}

/** The form switched to the other kind while creating: the same day and title. */
export function switchKind(form: Form, kind: "event" | "task"): Form {
  if (form.kind === kind) return form;
  if (kind === "task") {
    return { ...form, kind, allDay: true, endDate: form.startDate || form.endDate, startDate: "" };
  }
  const day = form.endDate || form.startDate;
  return {
    ...form,
    kind,
    allDay: false,
    startDate: day,
    endDate: day,
    startTime: form.startTime,
    endTime: form.endTime > form.startTime ? form.endTime : form.startTime,
  };
}

/** The start date moved: a weekly rule on the old start's weekday follows it (Google's editor). */
export function withStartDate(form: Form, startDate: string): Form {
  const next: Form = { ...form, startDate };
  if (form.kind === "event" && form.startDate && form.endDate) {
    // The event keeps its length in days.
    const days = Math.round(
      (Date.parse(`${form.endDate}T00:00:00Z`) - Date.parse(`${form.startDate}T00:00:00Z`)) /
        86_400_000,
    );
    Object.assign(next, { endDate: addDays(startDate, days) });
  }
  const repeat = form.repeat;
  if (repeat && repeat !== "kept" && repeat.frequency === "WEEKLY" && form.startDate) {
    const was = weekdayOf({ type: "date", date: form.startDate });
    if (repeat.weekdays.length === 1 && repeat.weekdays[0] === was) {
      Object.assign(next, {
        repeat: { ...repeat, weekdays: [weekdayOf({ type: "date", date: startDate })] },
      });
    }
  }
  return next;
}

/** A form's date and time as an `ItemTime` in its zone (UTC when it was). */
function timeOf(form: Form, date: string, time: string): ItemTime {
  if (form.allDay) return { type: "date", date };
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
    start: form.startDate ? timeOf(form, form.startDate, form.startTime) : null,
    end: form.endDate ? timeOf(form, form.endDate, form.endTime) : null,
  };
}

export type Problem = "endBeforeStart" | "dueBeforeStart" | "untilBeforeStart" | "noDate";

const localOf = (time: ItemTime) => (time.type === "date" ? `${time.date}T00:00:00` : time.local);

/** Later (positive), earlier or the same: instants when both have one, else wall clocks. */
function compare(a: ItemTime, b: ItemTime): number {
  if (a.type === "zoned" && b.type === "zoned") return a.epochMs - b.epochMs;
  return localOf(a).localeCompare(localOf(b));
}

/** Why a form cannot be saved, as a catalog key; `null` when it can. */
export function problemOf(form: Form): Problem | null {
  if (form.kind === "event" && (!form.startDate || !form.endDate)) return "noDate";
  const { start, end } = timesOfForm(form);
  // An event lasts; a task may be due when it starts.
  if (start && end && form.kind === "event" && compare(end, start) <= 0) return "endBeforeStart";
  if (start && end && form.kind === "task" && compare(end, start) < 0) return "dueBeforeStart";
  const repeat = form.repeat;
  const first = form.startDate || form.endDate;
  if (repeat && repeat !== "kept" && repeat.end.type === "until" && repeat.end.until < first) {
    return "untilBeforeStart";
  }
  return null;
}

const sameRepeat = (a: RepeatChoice, b: RepeatChoice) => JSON.stringify(a) === JSON.stringify(b);

const categoriesOf = (text: string) =>
  text
    .split(",")
    .map((category) => category.trim())
    .filter(Boolean);

/** What the user changed from `initial` to `form`; for a new item, everything it holds. */
export function changesOf(initial: Form | null, form: Form): ItemChanges {
  const changes: { -readonly [K in keyof ItemChanges]: ItemChanges[K] } = {};
  const was = initial;
  const differs = <K extends keyof Form>(key: K) => !was || was[key] !== form[key];
  if (differs("summary") && (was || form.summary.trim())) changes.summary = form.summary.trim();
  if (differs("location") && (was || form.location.trim())) changes.location = form.location.trim();
  if (differs("description") && (was || form.description.trim()))
    changes.description = form.description.trim();
  // The clock matters only for a timed item; an undated new task has no time at all.
  const timeChanged = was
    ? was.allDay !== form.allDay ||
      was.startDate !== form.startDate ||
      was.endDate !== form.endDate ||
      (!form.allDay && (was.startTime !== form.startTime || was.endTime !== form.endTime))
    : form.kind === "event" || form.startDate !== "" || form.endDate !== "";
  if (timeChanged) changes.time = timesOfForm(form);
  if (form.repeat !== "kept" && (was ? !sameRepeat(was.repeat, form.repeat) : form.repeat)) {
    changes.repeat = form.repeat;
  }
  const kept = new Set(form.alarms.flatMap((a) => (a.kind === "existing" ? [a.index] : [])));
  const remove = (was?.alarms ?? []).flatMap((a) =>
    a.kind === "existing" && !kept.has(a.index) ? [a.index] : [],
  );
  const add = form.alarms.flatMap((a) =>
    a.kind === "new" ? [{ relatedTo: a.relatedTo, offsetSeconds: a.offsetSeconds }] : [],
  );
  if (remove.length > 0 || add.length > 0) changes.alarms = { remove, add };
  if (differs("color") && (was || form.color)) changes.color = form.color;
  if (form.kind === "task") {
    if (was ? was.status !== form.status : form.status !== "NEEDS-ACTION")
      changes.status = form.status;
    if (differs("priority") && (was || form.priority !== null)) changes.priority = form.priority;
    if (differs("percent") && (was || form.percent !== null))
      changes.percentComplete = form.percent;
    if ((was ? categoriesOf(was.categories).join() : "") !== categoriesOf(form.categories).join()) {
      changes.categories = categoriesOf(form.categories);
    }
  }
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
 * rule is not one occurrence's; a new day is not every occurrence's; a move
 * to another calendar takes the whole series. Empty: no question to ask.
 */
export function scopesFor(target: Target | null, initial: Form | null, form: Form): Scope[] {
  if (!target || !initial || !isOccurrence(target)) return [];
  if (initial.calendarId !== form.calendarId) return [];
  const repeat = !sameRepeat(initial.repeat, form.repeat);
  const day = initial.startDate !== form.startDate || initial.endDate !== form.endDate;
  if (repeat) return ["following", "all"];
  if (day) return ["this", "following"];
  return ["this", "following", "all"];
}

/** The calendars an item of this kind can be written to: writable, holding its component. */
export function writableFor(calendars: readonly Calendar[], kind: "event" | "task"): Calendar[] {
  const component = kind === "event" ? "VEVENT" : "VTODO";
  return calendars.filter((c) => !c.readOnly && c.components.includes(component));
}

interface Writes {
  readonly now: number;
  /** A new UID, for a new item or the series "this and following" starts. */
  readonly uid: () => string;
}

/**
 * Saves the form through the local store as pending changes (D5): a new
 * item under `<uid>.ics` in its calendar, an edit in its scope (a split
 * series' second half as a new item), a move to another calendar as a new
 * item there and a deletion here, since the provider has no MOVE.
 */
export async function saveForm(
  store: Store,
  request: {
    readonly target: Target | null;
    readonly initial: Form | null;
    readonly form: Form;
    readonly scope: Scope;
  },
  writes: Writes,
): Promise<void> {
  const { target, initial, form } = request;
  if (!target || !initial) {
    const ics = createItem(form.kind, changesOf(null, form), {
      now: writes.now,
      uid: writes.uid(),
    });
    await store.saveLocal(form.calendarId, ics);
    return;
  }
  const changes = changesOf(initial, form);
  const stored = await store.object(target.objectId);
  if (!stored) throw new Error("The item is no longer on this device.");
  if (form.calendarId !== target.calendarId) {
    const { ics } = editItem(target.object, changes, { now: writes.now });
    await store.saveLocal(form.calendarId, ics);
    await store.deleteLocal(stored.id);
    return;
  }
  if (Object.keys(changes).length === 0) return;
  const { ics, split: rest } = editItem(target.object, changes, {
    now: writes.now,
    scope: request.scope,
    recurrenceId: isOccurrence(target) ? target.recurrenceId : null,
    newUid: writes.uid(),
  });
  await store.saveLocal(stored.calendarId, ics, stored.href);
  if (rest) await store.saveLocal(stored.calendarId, rest);
}

/** Deletes an item, or the occurrences `scope` covers, through the local store. */
export async function deleteTarget(
  store: Store,
  target: Target,
  scope: Scope,
  now: number,
): Promise<void> {
  const stored = await store.object(target.objectId);
  if (!stored) return;
  const ics = deleteItem(target.object, {
    now,
    scope,
    recurrenceId: isOccurrence(target) ? target.recurrenceId : null,
  });
  if (ics === null) await store.deleteLocal(stored.id);
  else await store.saveLocal(stored.calendarId, ics, stored.href);
}
