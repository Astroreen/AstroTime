// The item the edit dialog makes, drawn in the views behind it as the form
// says now (design D155): a new item where it would go, an edited one at its
// new place instead of its old one.
import { CalendarObject, createItem, type Occurrence, type Range } from "@astrotime/core";

import { ghostOf } from "./drag.ts";
import { changesOf, timesOfForm, type Form, type Target } from "./editing.ts";
import { expand, type Entry } from "./query.ts";

/** The stored object's id the draft's entries carry, which no stored object has. */
export const DRAFT = "draft";

/** What the views draw for the form. */
export type Draft =
  | {
      /** A new item: the object the form would create, its occurrences drawn (a series too). */
      readonly kind: "new";
      readonly object: CalendarObject;
      readonly calendarId: string;
    }
  | {
      /** An edited item: its occurrence at the form's times, with the form's title and colour. */
      readonly kind: "edit";
      readonly target: Target;
      readonly occurrence: Occurrence;
      readonly calendarId: string;
    };

/**
 * The draft of the edit dialog's form; `null` where it draws nothing (an
 * event with no start yet, times the form cannot hold). `untitled` is what
 * a new item's reminder says without a title (foundation D103).
 */
export function draftOf(target: Target | null, form: Form, untitled: string): Draft | null {
  try {
    if (!target) {
      const ics = createItem(form.kind, changesOf(null, form, untitled), { now: 0, uid: DRAFT });
      return { kind: "new", object: CalendarObject.parse(ics), calendarId: form.calendarId };
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
    };
  } catch {
    // Times no item can take yet (a field half typed): nothing is drawn for it.
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
      done: false,
    },
  ];
}
