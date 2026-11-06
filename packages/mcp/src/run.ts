// The tools run over the local store (docs/plans/assistant.md#D307): an
// assistant's change is a change made on this device, as a click would make
// it (foundation D5), the fields it names and nothing else (D7), sent by the
// sync engine like the user's own. Every change is logged with the item
// before and after, to undo (D311).
import {
  CalendarObject,
  completeTask,
  createItem,
  editItem,
  ExpansionLimitError,
  occurrencesBetween,
  timesOf,
  wallClockIn,
  zonedTime,
  type Item,
  type ItemChanges,
  type ItemTime,
  type ItemTimes,
} from "@astrotime/core";
import type { AssistantLog, Calendar, LocalChange, Store, StoredObject } from "@astrotime/storage";

import { isToolName, TOOLS, type ToolInput, type ToolName } from "./tools.ts";

/** A call the store refused, in words for the assistant: no such item, no right to change it. */
export class ToolError extends Error {
  override name = "ToolError";
}

export interface AssistantToolsOptions {
  readonly store: Store;
  /** The user's zone: the days `list_items` reads, and the times given without one. */
  readonly timeZone: string;
  readonly now?: () => number;
  readonly newUid?: () => string;
}

/** A local change with the log beside it, in one transaction. */
type Writing = LocalChange & { readonly log: AssistantLog };

/** The most days `list_items` reads at once, and the most occurrences it answers. */
const MAX_DAYS = 366;
const MAX_OCCURRENCES = 1000;

/**
 * AstroTime's tools over `store`. `call` checks the input against the tool's
 * schema, runs it, and answers with the item as the store holds it after;
 * a refusal is a `ToolError`.
 */
export function assistantTools(options: AssistantToolsOptions) {
  const { store, timeZone } = options;
  const now = options.now ?? Date.now;
  const newUid = options.newUid ?? (() => crypto.randomUUID());

  /** Runs a change in one transaction and logs it there (foundation D99, D311). */
  const change = <T>(work: (local: Writing) => Promise<T>) =>
    store.changeLocal((local, entries) => work({ ...local, log: entries }));

  async function log(
    local: Writing,
    tool: ToolName,
    calendarId: string,
    before: string | null,
    after: string | null,
  ) {
    const object = CalendarObject.parse((after ?? before)!);
    await local.log.add({
      at: now(),
      tool,
      calendarId,
      uid: object.uid,
      kind: object.kind,
      summary: shownItem(object)?.summary ?? null,
      beforeIcs: before,
      afterIcs: after,
    });
  }

  /** The object `id` and its calendar, with the right `right` there; a `ToolError` otherwise. */
  async function editable(local: Writing, id: string, right: "edit" | "delete") {
    const stored = await local.object(id);
    if (!stored || stored.pending === "delete") throw new ToolError(`No item ${id}.`);
    const calendar = (await local.calendars()).find((one) => one.id === stored.calendarId);
    if (!calendar?.rights[right]) {
      throw new ToolError(
        `The user may not ${right} items in ${calendar?.name ?? "its calendar"}.`,
      );
    }
    return { stored, object: CalendarObject.parse(stored.ics), calendar };
  }

  async function creatable(local: Writing, calendarId: string, kind: "event" | "task") {
    const calendar = (await local.calendars()).find((one) => one.id === calendarId);
    if (!calendar) throw new ToolError(`No calendar ${calendarId}.`);
    if (!calendar.components.includes(kind === "event" ? "VEVENT" : "VTODO")) {
      throw new ToolError(`${calendar.name} holds no ${kind}s.`);
    }
    if (!calendar.rights.create)
      throw new ToolError(`The user may not create items in ${calendar.name}.`);
    return calendar;
  }

  /** Saves the new text of an object and logs it; answers the item as stored. */
  async function saved(local: Writing, tool: ToolName, stored: StoredObject, ics: string) {
    const after = await local.save(stored.calendarId, ics, stored.href);
    await log(local, tool, stored.calendarId, stored.ics, after.ics);
    return itemView(after);
  }

  const run: { [Name in ToolName]: (input: ToolInput<Name>) => Promise<unknown> } = {
    async list_calendars() {
      const [calendars, accounts] = await Promise.all([store.calendars(), store.accounts()]);
      const names = new Map(accounts.map((account) => [account.id, account]));
      return {
        calendars: calendars.map((calendar) => ({
          id: calendar.id,
          name: calendar.name,
          account: accountOf(names.get(calendar.accountId)),
          color: calendar.color,
          holds: holds(calendar),
          canCreate: calendar.rights.create,
          canEdit: calendar.rights.edit,
          canDelete: calendar.rights.delete,
        })),
      };
    },

    async search_items({ text, calendarIds, limit }) {
      const found = await store.search(await calendarsAmong(calendarIds), text, limit ?? 50);
      return { items: found.map((stored) => itemView(stored, false)) };
    },

    async list_items({ from, to, calendarIds }) {
      checkDay(from);
      checkDay(to);
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
      if (!(days >= 0)) throw new ToolError("`to` is before `from`.");
      if (days >= MAX_DAYS) throw new ToolError(`At most ${MAX_DAYS} days at once.`);
      const range = { from, to: addDays(to, 1), timeZone };
      const objects = await store.objectsBetween(await calendarsAmong(calendarIds), range);
      const occurrences = objects.flatMap((stored) => {
        try {
          return occurrencesBetween(CalendarObject.parse(stored.ics), range).map((occurrence) =>
            Object.assign(
              {
                id: stored.id,
                calendarId: stored.calendarId,
                kind: occurrence.item.kind,
                summary: occurrence.item.summary,
              },
              occurrence.recurrenceId ? { occurrenceOf: timeText(occurrence.recurrenceId) } : {},
              span(occurrence.item.kind, occurrence.start, occurrence.end),
              occurrence.item.kind === "task" ? { done: occurrence.item.completed !== null } : {},
            ),
          );
        } catch (error) {
          // A series too dense to walk is left out, as the views leave it.
          if (error instanceof ExpansionLimitError) return [];
          throw error;
        }
      });
      const at = (one: { start?: string; due?: string }) => one.start ?? one.due ?? "";
      occurrences.sort((a, b) => at(a).localeCompare(at(b)));
      return {
        occurrences: occurrences.slice(0, MAX_OCCURRENCES),
        ...(occurrences.length > MAX_OCCURRENCES ? { truncated: true } : {}),
      };
    },

    async get_item({ id }) {
      const stored = await store.object(id);
      if (!stored || stored.pending === "delete") throw new ToolError(`No item ${id}.`);
      return itemView(stored);
    },

    create_event: (input) =>
      change(async (local) => {
        const calendar = await creatable(local, input.calendarId, "event");
        const zone = zoneOf(input.timeZone, timeZone);
        const start = timeOf(input.start, zone);
        const end = input.end ? endOf(input.end, zone) : defaultEnd(start, zone);
        checkOrder(start, end);
        const ics = createItem(
          "event",
          {
            summary: input.summary,
            time: { start, end },
            ...(input.location ? { location: input.location } : {}),
            ...(input.description ? { description: input.description } : {}),
          },
          { now: now(), uid: newUid() },
        );
        const stored = await local.save(calendar.id, ics);
        await log(local, "create_event", calendar.id, null, stored.ics);
        return itemView(stored);
      }),

    create_task: (input) =>
      change(async (local) => {
        const calendar = await creatable(local, input.calendarId, "task");
        const zone = zoneOf(input.timeZone, timeZone);
        const ics = createItem(
          "task",
          {
            summary: input.summary,
            ...(input.due ? { time: { start: null, end: timeOf(input.due, zone) } } : {}),
            ...(input.description ? { description: input.description } : {}),
            ...(input.priority ? { priority: input.priority } : {}),
          },
          { now: now(), uid: newUid() },
        );
        const stored = await local.save(calendar.id, ics);
        await log(local, "create_task", calendar.id, null, stored.ics);
        return itemView(stored);
      }),

    change_item: (input) =>
      change(async (local) => {
        const { stored, object } = await editable(local, input.id, "edit");
        const zone = zoneOf(input.timeZone, timeZone);
        if (input.priority !== undefined && object.kind !== "task") {
          throw new ToolError("Only a task has a priority.");
        }
        const changes: ItemChanges = {
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.categories !== undefined ? { categories: input.categories } : {}),
          ...(input.start !== undefined || input.end !== undefined
            ? { time: movedTimes(object, input.start, input.end, zone) }
            : {}),
        };
        // Its exceptions name occurrences by their old times: moving the
        // series would leave them behind, so its times stay the user's to move.
        if (changes.time && object.master?.recurring && object.exceptions.length > 0) {
          throw new ToolError(
            "This repeating item has occurrences changed on their own; its times are changed in AstroTime.",
          );
        }
        if (Object.keys(changes).length === 0) throw new ToolError("Name a field to change.");
        return saved(local, "change_item", stored, editItem(object, changes, { now: now() }).ics);
      }),

    complete_task: ({ id, done }) =>
      change(async (local) => {
        const { stored, object } = await editable(local, id, "edit");
        if (object.kind !== "task") throw new ToolError(`${id} is an event, not a task.`);
        return saved(
          local,
          "complete_task",
          stored,
          completeTask(object, done ?? true, { now: now() }),
        );
      }),

    add_attachment: ({ id, name, type, content }) =>
      change(async (local) => {
        const { stored, object } = await editable(local, id, "edit");
        let ics: string;
        try {
          ics = editItem(
            object,
            { attachments: { remove: [], add: [{ content, name, type: type ?? null }] } },
            { now: now() },
          ).ics;
        } catch (error) {
          if (error instanceof RangeError) throw new ToolError(error.message);
          throw error;
        }
        return saved(local, "add_attachment", stored, ics);
      }),

    delete_item: ({ id }) =>
      change(async (local) => {
        const { stored } = await editable(local, id, "delete");
        await local.delete(stored.id);
        await log(local, "delete_item", stored.calendarId, stored.ics, null);
        return { deleted: id };
      }),
  };

  /** The calendars asked for, or every one. */
  async function calendarsAmong(ids: readonly string[] | undefined): Promise<string[]> {
    const all = (await store.calendars()).map((calendar) => calendar.id);
    return ids ? all.filter((id) => ids.includes(id)) : all;
  }

  return {
    /** Runs the tool `name` with `args`, checked against its schema first. */
    async call(name: string, args: unknown): Promise<unknown> {
      if (!isToolName(name)) throw new ToolError(`No tool ${name}.`);
      const checked = TOOLS[name].input.safeParse(args ?? {});
      if (!checked.success) throw new ToolError(checked.error.message);
      try {
        return await (run[name] as (input: unknown) => Promise<unknown>)(checked.data);
      } catch (error) {
        // What the core refuses before writing (a colour, a link) is the call's fault.
        if (error instanceof RangeError) throw new ToolError(error.message);
        throw error;
      }
    },
  };
}

const holds = (calendar: Calendar) =>
  calendar.components.map((component) => (component === "VEVENT" ? "events" : "tasks"));

function accountOf(account: { name: string; provider: string } | undefined) {
  if (!account) return null;
  return account.provider === "local" ? "this device" : account.name;
}

/** What shows of an object: its master, or its first exception held without one. */
const shownItem = (object: CalendarObject): Item | null =>
  object.master ?? object.exceptions[0] ?? null;

/** The item as the store holds it, in words an assistant reads; `full` with its notes and files. */
export function itemView(stored: StoredObject, full = true) {
  const object = CalendarObject.parse(stored.ics);
  const item = shownItem(object);
  if (!item) return { id: stored.id, calendarId: stored.calendarId, kind: object.kind };
  const times = timesOf(object, null);
  const base = {
    id: stored.id,
    calendarId: stored.calendarId,
    kind: item.kind,
    summary: item.summary,
    ...(times.start || times.end
      ? span(item.kind, times.start ?? times.end!, times.end ?? times.start!, times.start === null)
      : {}),
    ...(item.location ? { location: item.location } : {}),
    ...(item.recurring ? { repeats: true } : {}),
    ...(item.kind === "task"
      ? { done: item.completed !== null || item.status === "COMPLETED", priority: item.priority }
      : {}),
    // Waiting for the sync engine to send it.
    ...(stored.pending !== "none" ? { notSynced: true } : {}),
  };
  if (!full) return base;
  return {
    ...base,
    ...(item.description ? { description: item.description } : {}),
    ...(item.status ? { status: item.status } : {}),
    ...(item.categories.length > 0 ? { categories: item.categories } : {}),
    ...(item.color ? { color: item.color } : {}),
    ...(item.url ? { url: item.url } : {}),
    reminders: item.alarms.length,
    attachments: item.attachments.map(({ name, type, size, uri }) =>
      uri ? { name, type, size, link: uri } : { name, type, size, inline: true },
    ),
  };
}

/**
 * An item's times in words: a day for an all-day item (an event's last day
 * itself, not the day after), or the wall clock and its zone. `dueOnly`: a
 * task with a due and no start.
 */
function span(kind: "event" | "task", start: ItemTime, end: ItemTime, dueOnly = false) {
  const zone = start.type === "zoned" ? start.timeZone : end.type === "zoned" ? end.timeZone : null;
  if (kind === "task") {
    return {
      ...(dueOnly ? {} : { start: timeText(start) }),
      due: timeText(end),
      allDay: end.type === "date",
      ...(zone ? { timeZone: zone } : {}),
    };
  }
  const allDay = start.type === "date";
  const last =
    allDay && end.type === "date" && end.date > start.date ? addDays(end.date, -1) : null;
  return {
    start: timeText(start),
    end: last ?? timeText(end),
    allDay,
    ...(zone ? { timeZone: zone } : {}),
  };
}

/** A time as written: the day, or the wall clock to the minute (seconds when there are any). */
function timeText(time: ItemTime): string {
  if (time.type === "date") return time.date;
  return time.local.endsWith(":00") ? time.local.slice(0, 16) : time.local;
}

/** `days` after a day, `YYYY-MM-DD`. */
function addDays(date: string, days: number): string {
  const at = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000);
  return at.toISOString().slice(0, 10);
}

function isZone(name: string): boolean {
  try {
    return new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions().timeZone !== "";
  } catch {
    return false;
  }
}

/** The zone asked for, one `Intl` knows, or the user's. */
function zoneOf(asked: string | undefined, user: string): string {
  if (!asked) return user;
  if (!isZone(asked)) throw new ToolError(`No time zone ${asked}.`);
  return asked;
}

/** A day, or a wall clock in `zone`, as the core's time; a day that is no day is refused. */
/** A day that is one: `2026-13-45` is refused. */
function checkDay(date: string): void {
  if (Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || addDays(date, 0) !== date) {
    throw new ToolError(`No day ${date}.`);
  }
}

function timeOf(value: string, zone: string): ItemTime {
  const date = value.slice(0, 10);
  checkDay(date);
  if (value.length === 10) return { type: "date", date };
  const local = value.length === 16 ? `${value}:00` : value;
  return zonedTime(local, zone);
}

/** An event's end as given: a last day is the exclusive day after it (RFC 5545's `DTEND`). */
function endOf(value: string, zone: string): ItemTime {
  const end = timeOf(value, zone);
  return end.type === "date" ? { type: "date", date: addDays(end.date, 1) } : end;
}

/** A timed event's hour, an all-day event's day. */
function defaultEnd(start: ItemTime, zone: string): ItemTime {
  if (start.type === "date") return { type: "date", date: addDays(start.date, 1) };
  const epochMs = orderOf(start) + 3_600_000;
  // A floating time an hour later on its own wall clock.
  if (start.type === "floating")
    return { type: "floating", local: new Date(epochMs).toISOString().slice(0, 19) };
  return zonedTime(wallClockIn(epochMs, zone), zone);
}

/** An end before its start, or a day with a time, is refused. */
function checkOrder(start: ItemTime, end: ItemTime) {
  if ((start.type === "date") !== (end.type === "date")) {
    throw new ToolError("The start and the end are both days, or both times.");
  }
  if (orderOf(end) < orderOf(start)) throw new ToolError("The end is before the start.");
}

const orderOf = (time: ItemTime) =>
  time.type === "date"
    ? Date.parse(`${time.date}T00:00:00Z`)
    : time.type === "zoned"
      ? time.epochMs
      : Date.parse(`${time.local}Z`);

/**
 * The item's times with a new start, end or due: an event's new start alone
 * keeps its length, a task's start and due move each on their own.
 */
function movedTimes(
  object: CalendarObject,
  start: string | undefined,
  end: string | undefined,
  zone: string,
): ItemTimes {
  const current = timesOf(object, null);
  if (object.kind === "task") {
    const next = {
      start: start !== undefined ? timeOf(start, zone) : current.start,
      end: end !== undefined ? timeOf(end, zone) : current.end,
    };
    if (next.start && next.end) checkOrder(next.start, next.end);
    return next;
  }
  const from = start !== undefined ? timeOf(start, zone) : current.start;
  if (!from) throw new ToolError("The event has no start; give one.");
  let to: ItemTime;
  if (end !== undefined) to = endOf(end, zone);
  else if (
    current.start &&
    current.end &&
    (current.start.type === "date") === (from.type === "date")
  ) {
    to = shifted(current.end, orderOf(from) - orderOf(current.start), zone);
  } else to = defaultEnd(from, zone);
  checkOrder(from, to);
  return { start: from, end: to };
}

/** A time moved by `ms`, as its kind writes it. */
function shifted(time: ItemTime, ms: number, zone: string): ItemTime {
  if (time.type === "date")
    return { type: "date", date: addDays(time.date, Math.round(ms / 86_400_000)) };
  const epochMs = orderOf(time) + ms;
  if (time.type === "floating")
    return { type: "floating", local: new Date(epochMs).toISOString().slice(0, 19) };
  // In the end's own zone, where `Intl` knows it.
  const kept = time.type === "zoned" && isZone(time.timeZone) ? time.timeZone : zone;
  return zonedTime(wallClockIn(epochMs, kept), kept);
}
