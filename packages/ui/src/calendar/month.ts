// The Month view's layout (design D49, D86): each week packs its items into
// one-line rows, all-day spans first and then timed items in time order
// (`layoutSpans` with `timed`); a tile shows as many rows as fit, then "+N".
import { dayRange, layoutSpans, type Occurrence } from "@astrotime/core";

import { shownOn, undoneChip, type Entry, type LayoutContext, type StripSpan } from "./query.ts";

export interface MonthWeek {
  readonly days: readonly string[];
  readonly spans: readonly StripSpan[];
}

/** Lays out a month's weeks (`days`, a multiple of seven), with the undone tasks chip on today. */
export function layoutMonth(
  entries: readonly Entry[],
  days: readonly string[],
  options: LayoutContext,
): MonthWeek[] {
  const { today, timeZone, undone } = options;
  const byOccurrence = shownOn(entries, today, timeZone);
  // The days each occurrence shows on, once, so each week takes only its own.
  const covered = [...byOccurrence.keys()].map((occurrence) => {
    const { first, last } = dayRange(occurrence, timeZone);
    return { occurrence, first, last };
  });
  const weeks: MonthWeek[] = [];
  for (let i = 0; i < days.length; i += 7) {
    const week = days.slice(i, i + 7);
    const first = week[0]!;
    const last = week.at(-1)!;
    const occurrences: Occurrence[] = covered
      .filter((item) => item.first <= last && item.last >= first)
      .map((item) => item.occurrence);
    if (undone > 0 && week.includes(today)) occurrences.push(undoneChip(today));
    const spans = layoutSpans(occurrences, week, timeZone, { timed: true }).map((span) => ({
      span,
      entry: byOccurrence.get(span.occurrence) ?? null,
    }));
    weeks.push({ days: week, spans });
  }
  return weeks;
}

export interface FoldedWeek {
  readonly shown: readonly StripSpan[];
  /** "+N" in the last row of each day that has items hidden: the day's index and how many. */
  readonly more: readonly { readonly index: number; readonly count: number }[];
}

/**
 * A week cut to the `capacity` rows its tiles fit. A day with items past them
 * gives its last row to "+N", the count of its hidden items; a span in that
 * row goes with it on every day it covers, and the days it leaves get "+N"
 * too. Other days keep all their rows, as Google's month does.
 */
export function foldWeek(spans: readonly StripSpan[], capacity: number): FoldedWeek {
  const rows = Math.max(1, capacity);
  const covers = ({ span }: StripSpan, index: number) =>
    span.firstDay <= index && index <= span.lastDay;
  const hidden = new Set(spans.filter(({ span }) => span.row >= rows));
  const overflowing = new Set<number>();
  const mark = (strip: StripSpan) => {
    for (let index = strip.span.firstDay; index <= strip.span.lastDay; index++)
      overflowing.add(index);
  };
  for (const strip of hidden) mark(strip);
  for (const strip of spans) {
    if (strip.span.row !== rows - 1) continue;
    if ([...overflowing].some((index) => covers(strip, index))) hidden.add(strip);
  }
  for (const strip of hidden) mark(strip);
  return {
    shown: spans.filter((strip) => !hidden.has(strip)),
    more: [...overflowing]
      .toSorted((a, b) => a - b)
      .map((index) => ({
        index,
        count: [...hidden].filter((strip) => covers(strip, index)).length,
      })),
  };
}
