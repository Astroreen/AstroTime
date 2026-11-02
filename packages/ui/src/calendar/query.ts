// The query path of the views (docs/plans/foundation.md#D5, D42): the visible
// calendars and days → `Store.objectsBetween` → `CalendarObject` →
// `occurrencesBetween` → `layoutDay` / `layoutSpans`. Parsing and expansion
// are kept per object, so a store change re-parses only what changed.
import {
  CalendarObject,
  ExpansionLimitError,
  isDone,
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
  /** The stored object it comes from. */
  readonly objectId: string;
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

/** The stored object's id a draft's entries carry, which no stored object has (design D155). */
export const DRAFT = "draft";

/**
 * The edit dialog's draft as the views take it: what it does to their
 * entries, made in the editor's own chunk, so nothing of it loads before the
 * dialog does (foundation D145).
 */
export interface DrawnDraft {
  /** Its times, so a view brings it into sight when they change, not with each letter typed. */
  readonly when: string;
  /** The entries of `range` with the draft drawn in. */
  readonly apply: (entries: readonly Entry[], range: Range) => readonly Entry[];
}

/** The entries of an object's occurrences in `range`, as the views draw them; none for a series too dense. */
export function expand(
  object: CalendarObject,
  row: Pick<StoredObject, "id" | "calendarId">,
  range: Range,
): Entry[] {
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
    objectId: row.id,
    occurrence,
    object,
    calendarId: row.calendarId,
    done: seriesDone || isDone(occurrence.item),
  }));
}

/** A span of the all-day strip: an entry's, or the "N undone tasks" chip's on today (`entry: null`). */
export interface StripSpan {
  readonly span: Span;
  readonly entry: Entry | null;
}

interface DayColumn {
  readonly day: string;
  readonly timed: readonly { readonly placed: Placed; readonly entry: Entry }[];
}

export interface RangeLayout {
  readonly strip: readonly StripSpan[];
  readonly rows: number;
  readonly columns: readonly DayColumn[];
}

/** What every view's layout needs besides the entries. */
export interface LayoutContext {
  readonly today: string;
  readonly timeZone: string;
  /** How many undone tasks the chip on today stands for (design D51). */
  readonly undone: number;
}

/**
 * The entries the views draw, by occurrence: every one on its own days, an
 * undone task due before today too, which also counts in the chip on today
 * (design D185).
 */
export function byOccurrence(entries: readonly Entry[]): Map<Occurrence, Entry> {
  return new Map(entries.map((entry) => [entry.occurrence, entry]));
}

/**
 * Lays out the visible days. When there are undone tasks due before today,
 * today's strip gets the chip that counts them (design D51, D185), placed
 * where a one-day task with the first title would go: after longer spans
 * and one-day events, before other tasks.
 */
export function layoutRange(
  entries: readonly Entry[],
  days: readonly string[],
  options: LayoutContext,
): RangeLayout {
  const { today, timeZone, undone } = options;
  const shown = byOccurrence(entries);
  const occurrences = [...shown.keys()];
  const chip = undone > 0 && days.includes(today) ? undoneChip(today) : null;
  const strip = layoutSpans(chip ? [...occurrences, chip] : occurrences, days, timeZone).map(
    (span) => ({ span, entry: shown.get(span.occurrence) ?? null }),
  );
  const columns = days.map((day) => ({
    day,
    timed: layoutDay(occurrences, day, { timeZone }).timed.map((placed) => ({
      placed,
      entry: shown.get(placed.occurrence)!,
    })),
  }));
  return { strip, rows: Math.max(0, ...strip.map(({ span }) => span.row + 1)), columns };
}

/** A stand-in task for the "N undone tasks" chip, so the layout engine places it. */
export function undoneChip(today: string): Occurrence {
  const item: Task = {
    kind: "task",
    uid: "",
    recurrenceId: null,
    summary: "",
    description: null,
    location: null,
    geo: null,
    placeLabel: null,
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
    starred: false,
  };
  return {
    item,
    recurrenceId: null,
    start: { type: "date", date: today },
    end: { type: "date", date: addDays(today, 1) },
  };
}
