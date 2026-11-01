// The Agenda's days (design D87): each day with items, its all-day items in
// the strip's order and then its timed ones in time order (`layoutDay`); an
// item over several days on each of them. Today is always there, headed by
// the undone tasks chip (design D51), so the list has a today to open at.
import { dayRange, layoutDay, type Occurrence } from "@astrotime/core";

import { addDays, daysBetween } from "./dates.ts";
import { shownOn, type Entry, type LayoutContext } from "./query.ts";

interface AgendaItem {
  readonly entry: Entry;
  readonly allDay: boolean;
  /** For an all-day item over several days: which of them this is, from 1. */
  readonly part: { readonly index: number; readonly total: number } | null;
}

export interface AgendaDay {
  readonly day: string;
  readonly items: readonly AgendaItem[];
  /** Whether the "N undone tasks" chip heads the day: today, with undone tasks. */
  readonly undone: boolean;
}

/** The days from `from` to `to` (exclusive) with something on them, in order. */
export function agendaDays(
  entries: readonly Entry[],
  from: string,
  to: string,
  options: LayoutContext,
): AgendaDay[] {
  const { today, timeZone, undone } = options;
  const byOccurrence = shownOn(entries, today, timeZone);
  const byDay = new Map<string, Occurrence[]>();
  const spans = new Map<Occurrence, { first: string; total: number }>();
  for (const occurrence of byOccurrence.keys()) {
    const { first, last } = dayRange(occurrence, timeZone);
    spans.set(occurrence, { first, total: daysBetween(first, last) + 1 });
    for (let day = first < from ? from : first; day <= last && day < to; day = addDays(day, 1)) {
      const items = byDay.get(day);
      if (items) items.push(occurrence);
      else byDay.set(day, [occurrence]);
    }
  }
  if (from <= today && today < to && !byDay.has(today)) byDay.set(today, []);
  return [...byDay.keys()].toSorted().map((day) => {
    const { allDay, timed } = layoutDay(byDay.get(day)!, day, { timeZone });
    const items: AgendaItem[] = [
      ...allDay.map((occurrence) => {
        const { first, total } = spans.get(occurrence)!;
        return {
          entry: byOccurrence.get(occurrence)!,
          allDay: true,
          part: total > 1 ? { index: daysBetween(first, day) + 1, total } : null,
        };
      }),
      ...timed.map(({ occurrence }) => ({
        entry: byOccurrence.get(occurrence)!,
        allDay: false,
        part: null,
      })),
    ];
    return { day, items, undone: day === today && undone > 0 };
  });
}
