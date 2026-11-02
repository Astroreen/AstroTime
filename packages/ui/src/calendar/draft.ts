// The item the edit dialog makes, drawn in the views behind it as the form
// says now (design D155): a new item where it would go, an edited one at its
// new place instead of its old one.
import {
  CalendarObject,
  CalendarObjectError,
  createItem,
  isDone,
  type Occurrence,
  type Range,
} from "@astrotime/core";

import { ghostOf } from "./drag.ts";
import { changesOf, problemOf, timesOfForm, type Form, type Target } from "./editing.ts";
import { DRAFT, expand, type DrawnDraft, type Entry } from "./query.ts";

export { DRAFT } from "./query.ts";

/** What the views draw for the form. */
export type Draft =
  | {
      /** A new item: the object the form would create, its occurrences drawn (a series too). */
      readonly kind: "new";
      readonly object: CalendarObject;
      readonly calendarId: string;
      /** Its times, so a view brings it into sight when they change, not with each letter typed. */
      readonly when: string;
    }
  | {
      /** An edited item: its occurrence at the form's times, with the form's title and colour. */
      readonly kind: "edit";
      readonly target: Target;
      readonly occurrence: Occurrence;
      readonly calendarId: string;
      readonly when: string;
    };

/**
 * The draft of the edit dialog's form; `null` where it draws nothing (an
 * event with no start yet, times the form cannot hold). `untitled` is what
 * a new item's reminder says without a title (foundation D103).
 */
export function draftOf(target: Target | null, form: Form, untitled: string): Draft | null {
  try {
    // A date not chosen yet: no day to draw it on.
    if (problemOf(form) === "noDate") return null;
    if (!target) {
      const ics = createItem(form.kind, changesOf(null, form, untitled), { now: 0, uid: DRAFT });
      return {
        kind: "new",
        object: CalendarObject.parse(ics),
        calendarId: form.calendarId,
        when: JSON.stringify(timesOfForm(form)),
      };
    }
    const times = timesOfForm(form);
    if (!times.start && !times.end) return null;
    const base: Occurrence = {
      item: target.item,
      recurrenceId: target.recurrenceId,
      start: (times.start ?? times.end)!,
      end: (times.end ?? times.start)!,
    };
    const moved = ghostOf(base, times);
    const summary = form.summary.trim() || null;
    return {
      kind: "edit",
      target,
      occurrence: { ...moved, item: { ...moved.item, summary, color: form.color } },
      calendarId: form.calendarId,
      when: JSON.stringify(times),
    };
  } catch (error) {
    // What no item can hold yet (an event that would have no start): nothing
    // is drawn for it; anything else is a fault, told and not drawn.
    if (!(error instanceof CalendarObjectError)) console.error(error);
    return null;
  }
}

const sameTime = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The entries of `range` with the draft drawn in: an edited occurrence
 * leaves its place for the draft's, a new item joins them.
 */
export function withDraft(
  entries: readonly Entry[],
  draft: Draft | null,
  range: Range,
): readonly Entry[] {
  if (!draft) return entries;
  if (draft.kind === "new") {
    return [
      ...entries,
      ...expand(draft.object, { id: DRAFT, calendarId: draft.calendarId }, range),
    ];
  }
  const { target, occurrence } = draft;
  const kept = entries.filter(
    (entry) =>
      entry.objectId !== target.objectId ||
      !sameTime(entry.occurrence.recurrenceId, target.recurrenceId),
  );
  return [
    ...kept,
    {
      key: DRAFT,
      objectId: DRAFT,
      occurrence,
      object: target.object,
      calendarId: draft.calendarId,
      // Done as the occurrence it stands for is: a series done, or this one.
      done: (target.object.master !== null && isDone(target.object.master)) || isDone(target.item),
    },
  ];
}

/**
 * The fields of a form that change where and how its draft is drawn: its
 * kind, times, rule, colour and calendar. Its title only renames it, and its
 * other fields draw nothing, so typing them makes no draft anew.
 */
export function placementOf(form: Form): string {
  const { kind, allDay, startDate, startless, startTime, endDate, endTime, zone, utc } = form;
  const { repeat, color, calendarId } = form;
  return JSON.stringify([
    kind,
    allDay,
    startDate,
    startless ?? false,
    startTime,
    endDate,
    endTime,
    zone,
    utc,
    repeat,
    color,
    calendarId,
  ]);
}

/**
 * The draft as the views take it (`DrawnDraft`), titled `summary`: a new
 * item's occurrences are expanded once for each range a view asks for and
 * kept in `expanded`, which belongs to the draft, so a new title renames
 * them without expanding them again.
 */
export function drawn(
  draft: Draft | null,
  summary: string,
  expanded: Map<string, readonly Entry[]> = new Map(),
): DrawnDraft | null {
  if (!draft) return null;
  const title = summary.trim() || null;
  const named = (entry: Entry): Entry => ({
    ...entry,
    occurrence: { ...entry.occurrence, item: { ...entry.occurrence.item, summary: title } },
  });
  if (draft.kind === "edit") {
    const { occurrence } = draft;
    const item = { ...occurrence.item, summary: title };
    const renamed = { ...draft, occurrence: { ...occurrence, item } };
    return { when: draft.when, apply: (entries, range) => withDraft(entries, renamed, range) };
  }
  return {
    when: draft.when,
    apply(entries, range) {
      const key = `${range.from}/${range.to}/${range.timeZone}`;
      let own = expanded.get(key);
      if (!own) {
        own = withDraft([], draft, range);
        expanded.set(key, own);
      }
      return [...entries, ...own.map(named)];
    },
  };
}
