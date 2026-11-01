// The tasks screen's lists (design D52): each list's tasks from the local
// store in the order the user picked, subtasks under their parent
// (`RELATED-TO`), and the completed ones apart. A series shows once, by its
// earliest occurrence that is not done, as Google Tasks shows a repeating
// task's current one; completing it brings the next.
import {
  CalendarObject,
  ExpansionLimitError,
  isDone,
  occurrencesBetween,
  wallClockOf,
  type ItemTime,
  type Occurrence,
  type Task,
} from "@astrotime/core";
import type { StoredObject } from "@astrotime/storage";

import { addDays } from "./dates.ts";

export const SORTS = ["mine", "date", "starred"] as const;
/** My order (`X-APPLE-SORT-ORDER`, as Nextcloud Tasks), by due date, or starred first. */
export type Sort = (typeof SORTS)[number];

export function isSort(value: string | null): value is Sort {
  return (SORTS as readonly (string | null)[]).includes(value);
}

/** One task as the tasks screen shows it. */
export interface TaskRow {
  readonly stored: StoredObject;
  readonly object: CalendarObject;
  /** The item shown: the task, or the exception of the occurrence it shows by. */
  readonly task: Task;
  /** The due of the occurrence shown (its start when it has no due); `null`: undated. */
  readonly due: ItemTime | null;
  /** The occurrence completing changes; `null`: the task itself. */
  readonly recurrenceId: ItemTime | null;
  readonly done: boolean;
  /** Starring is the task's, not an occurrence's: read from the master. */
  readonly starred: boolean;
  readonly recurring: boolean;
}

export interface TaskNode {
  readonly row: TaskRow;
  readonly children: readonly TaskNode[];
}

export interface TaskList {
  /** Undone tasks as a tree: each subtask under its parent. */
  readonly undone: readonly TaskNode[];
  readonly undoneCount: number;
  /** Completed tasks, the most recently completed first. */
  readonly completed: readonly TaskRow[];
}

/** How far ahead a series is walked for an occurrence not done. */
const LOOKAHEAD_DAYS = 400;

/** Parsed rows by object id, made again only when the iCalendar or today changes. */
export class TaskCache {
  readonly #byId = new Map<string, { ics: string; day: string; row: TaskRow | null }>();

  rows(stored: readonly StoredObject[], today: string, timeZone: string): TaskRow[] {
    const result: TaskRow[] = [];
    const seen = new Set<string>();
    for (const object of stored) {
      seen.add(object.id);
      let cached = this.#byId.get(object.id);
      if (!cached || cached.ics !== object.ics || cached.day !== today) {
        cached = { ics: object.ics, day: today, row: rowOf(object, today, timeZone) };
        this.#byId.set(object.id, cached);
      }
      // The row keeps the latest stored object (its href, its pending state).
      if (cached.row) result.push({ ...cached.row, stored: object });
    }
    for (const id of this.#byId.keys()) if (!seen.has(id)) this.#byId.delete(id);
    return result;
  }
}

function rowOf(stored: StoredObject, today: string, timeZone: string): TaskRow | null {
  let object: CalendarObject;
  try {
    object = CalendarObject.parse(stored.ics);
  } catch {
    // The store holds only valid objects (D36); one it cannot read is not shown.
    return null;
  }
  const { master } = object;
  const task = master ?? object.exceptions[0];
  if (!task || task.kind !== "task") return null;
  const starred = task.starred;
  if (!master || !master.recurring || isDone(master)) {
    return {
      stored,
      object,
      task,
      due: task.due ?? task.start,
      recurrenceId: master ? null : task.recurrenceId,
      done: isDone(task),
      starred,
      recurring: false,
    };
  }
  let occurrences: Occurrence[];
  try {
    occurrences = occurrencesBetween(object, {
      from: "0001-01-01",
      to: addDays(today, LOOKAHEAD_DAYS),
      timeZone,
    });
  } catch (error) {
    if (!(error instanceof ExpansionLimitError)) throw error;
    // Too dense to walk (D33): shown as the series, undated.
    occurrences = [];
  }
  const current = occurrences.find((occurrence) => !isDone(occurrence.item));
  // Every occurrence done: the series shows as completed, by its last one.
  const shown = current ?? occurrences.at(-1);
  return {
    stored,
    object,
    task: (shown?.item as Task | undefined) ?? task,
    due: shown ? dueOf(shown) : null,
    recurrenceId: shown?.recurrenceId ?? null,
    done: !current && occurrences.length > 0,
    starred,
    recurring: true,
  };
}

/** An occurrence's due: its end, the due day itself for a date (ends are exclusive). */
function dueOf(occurrence: Occurrence): ItemTime {
  const { end } = occurrence;
  return end.type === "date" ? { type: "date", date: addDays(end.date, -1) } : end;
}

/** Seconds from 2001-01-01, the epoch of `X-APPLE-SORT-ORDER`. */
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);

/**
 * A task's place in "my order": `X-APPLE-SORT-ORDER`, or, as Nextcloud Tasks
 * reads a task without one, its creation in seconds from 2001.
 */
function myOrder(task: Task): number {
  if (task.sortOrder !== null) return task.sortOrder;
  if (task.created?.type === "zoned") return (task.created.epochMs - APPLE_EPOCH_MS) / 1000;
  return 0;
}

/** The task lists by calendar id, sorted as `sort` asks. */
export function taskLists(
  rows: readonly TaskRow[],
  options: { readonly sort: Sort; readonly collator: Intl.Collator; readonly timeZone: string },
): Map<string, TaskList> {
  const { sort, collator, timeZone } = options;
  const title = (row: TaskRow) => row.task.summary ?? "";
  const mine = (a: TaskRow, b: TaskRow) =>
    myOrder(a.task) - myOrder(b.task) || collator.compare(title(a), title(b));
  const dueKey = (row: TaskRow) => (row.due ? wallClockOf(row.due, timeZone) : "￿");
  const compare: Record<Sort, (a: TaskRow, b: TaskRow) => number> = {
    mine,
    date: (a, b) => (dueKey(a) < dueKey(b) ? -1 : dueKey(a) > dueKey(b) ? 1 : mine(a, b)),
    starred: (a, b) => Number(b.starred) - Number(a.starred) || mine(a, b),
  };
  const completedAt = (row: TaskRow) =>
    row.task.completed ? wallClockOf(row.task.completed, timeZone) : "";

  const byList = new Map<string, TaskRow[]>();
  for (const row of rows) {
    const list = byList.get(row.stored.calendarId) ?? [];
    list.push(row);
    byList.set(row.stored.calendarId, list);
  }
  const result = new Map<string, TaskList>();
  for (const [id, list] of byList) {
    const undone = list.filter((row) => !row.done).toSorted(compare[sort]);
    const completed = list
      .filter((row) => row.done)
      .toSorted((a, b) => completedAt(b).localeCompare(completedAt(a)) || mine(a, b));
    result.set(id, { undone: tree(undone), undoneCount: undone.length, completed });
  }
  return result;
}

/** Each subtask under its parent among `rows` (kept in their order); a loop of parents is cut. */
function tree(rows: readonly TaskRow[]): TaskNode[] {
  const uids = new Set(rows.map((row) => row.object.uid));
  const children = new Map<string, TaskRow[]>();
  const roots: TaskRow[] = [];
  for (const row of rows) {
    const parent = row.task.parentUid;
    if (parent && parent !== row.object.uid && uids.has(parent)) {
      children.set(parent, [...(children.get(parent) ?? []), row]);
    } else roots.push(row);
  }
  const placed = new Set<string>();
  const node = (row: TaskRow): TaskNode => {
    placed.add(row.object.uid);
    const below = (children.get(row.object.uid) ?? []).filter(
      (child) => !placed.has(child.object.uid),
    );
    return { row, children: below.map(node) };
  };
  const nodes = roots.map(node);
  // Tasks whose parents name each other in a loop have no root: they stand alone.
  for (const row of rows) if (!placed.has(row.object.uid)) nodes.push(node(row));
  return nodes;
}
