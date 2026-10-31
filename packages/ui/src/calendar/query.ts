// The query path of the views (docs/plans/foundation.md#D5, D42): the visible
// calendars and days → `Store.objectsBetween` → `CalendarObject` →
// `occurrencesBetween` → `layoutDay` / `layoutSpans`. Parsing and expansion
// are kept per object, so a store change re-parses only what changed.
import {
  CalendarObject,
  ExpansionLimitError,
  isDone,
  isUndoneBefore,
  layoutDay,
  layoutSpans,
  occurrencesBetween,
  type Occurrence,
  type Placed,
  type Range,
  type Span,
  type Task,
} from "@astrotime/core";
import type { StoredObject } from "@astrotime/storage";

import { addDays } from "./dates.ts";

/** One occurrence on the views, with what drawing it needs. */
export interface Entry {
  /** Unique among the entries: the stored object and the occurrence. */
  readonly key: string;
  readonly occurrence: Occurrence;
  readonly object: CalendarObject;
  readonly calendarId: string;
  /** A completed or cancelled task (design D51). */
  readonly done: boolean;
}

interface Cached {
  readonly ics: string;
  readonly object: CalendarObject | null;
  range?: string;
  entries?: readonly Entry[];
}

/** How many objects the cache keeps beyond those on screen. */
const CACHE_LIMIT = 5000;

/**
 * Parsed objects and their occurrences in the last range asked, by object
 * id. An object is parsed again only when its iCalendar changed.
 */
export class ObjectCache {
  readonly #byId = new Map<string, Cached>();

  entries(rows: readonly StoredObject[], range: Range): Entry[] {
    const rangeKey = `${range.from}/${range.to}/${range.timeZone}`;
    const result: Entry[] = [];
    for (const row of rows) {
      let cached = this.#byId.get(row.id);
      if (!cached || cached.ics !== row.ics) {
        cached = { ics: row.ics, object: parse(row.ics) };
      }
      // Most recently used last, so the oldest go first when the cache is full.
      this.#byId.delete(row.id);
      this.#byId.set(row.id, cached);
      if (cached.range !== rangeKey) {
        cached.range = rangeKey;
        cached.entries = cached.object ? expand(cached.object, row, range) : [];
      }
      result.push(...cached.entries!);
    }
    for (const id of this.#byId.keys()) {
      if (this.#byId.size <= Math.max(CACHE_LIMIT, rows.length)) break;
      this.#byId.delete(id);
    }
    return result;
  }
}

function parse(ics: string): CalendarObject | null {
  try {
    return CalendarObject.parse(ics);
  } catch {
    // The store holds only valid objects (D36); one it cannot read is not drawn.
    return null;
  }
}

function expand(object: CalendarObject, row: StoredObject, range: Range): Entry[] {
  let occurrences: Occurrence[];
  try {
    occurrences = occurrencesBetween(object, range);
  } catch (error) {
    // A series too dense to expand is left out, not the whole view (D33).
    if (error instanceof ExpansionLimitError) return [];
    throw error;
  }
  const seriesDone = object.master !== null && isDone(object.master);
  return occurrences.map((occurrence) => ({
    key: `${row.id}/${JSON.stringify(occurrence.recurrenceId)}`,
    occurrence,
    object,
    calendarId: row.calendarId,
    done: seriesDone || isDone(occurrence.item),
  }));
}

/** A span of the all-day strip: an entry, or the "N undone tasks" chip on today. */
export interface StripSpan extends Omit<Span, "occurrence"> {
  readonly entry: Entry | null;
}

export interface DayColumn {
  readonly day: string;
  readonly timed: readonly (Omit<Placed, "occurrence"> & { readonly entry: Entry })[];
}

export interface RangeLayout {
  readonly strip: readonly StripSpan[];
  readonly rows: number;
  readonly columns: readonly DayColumn[];
}

/**
 * Lays out the visible days. Undone tasks due before today leave their days
 * (design D51); when there are any, today's strip gets the chip that stands
 * for them, placed where a one-day task with the first title would go: after
 * longer spans and one-day events, before other tasks.
 */
export function layoutRange(
  entries: readonly Entry[],
  days: readonly string[],
  options: { readonly today: string; readonly timeZone: string; readonly undone: number },
): RangeLayout {
  const { today, timeZone, undone } = options;
  const byOccurrence = new Map<Occurrence, Entry>();
  for (const entry of entries) {
    if (isUndoneBefore(entry.object, entry.occurrence, today, timeZone)) continue;
    byOccurrence.set(entry.occurrence, entry);
  }
  const occurrences = [...byOccurrence.keys()];
  const chip = undone > 0 && days.includes(today) ? undoneChip(today) : null;
  const strip = layoutSpans(chip ? [...occurrences, chip] : occurrences, days, timeZone).map(
    ({ occurrence, ...span }) => ({ ...span, entry: byOccurrence.get(occurrence) ?? null }),
  );
  const columns = days.map((day) => ({
    day,
    timed: layoutDay(occurrences, day, { timeZone }).timed.map(({ occurrence, ...placed }) => ({
      ...placed,
      entry: byOccurrence.get(occurrence)!,
    })),
  }));
  return { strip, rows: Math.max(0, ...strip.map((span) => span.row + 1)), columns };
}

/** A stand-in task for the "N undone tasks" chip, so the layout engine places it. */
function undoneChip(today: string): Occurrence {
  const item: Task = {
    kind: "task",
    uid: "",
    recurrenceId: null,
    summary: "",
    description: null,
    location: null,
    status: null,
    categories: [],
    classification: null,
    color: null,
    url: null,
    sequence: 0,
    created: null,
    lastModified: null,
    recurring: false,
    alarms: [],
    start: null,
    due: { type: "date", date: today },
    completed: null,
    percentComplete: null,
    priority: null,
    parentUid: null,
    sortOrder: null,
    hideSubtasks: false,
  };
  return {
    item,
    recurrenceId: null,
    start: { type: "date", date: today },
    end: { type: "date", date: addDays(today, 1) },
  };
}
