// The views (docs/plans/foundation.md#D13, design D48). A view is the days
// it shows and how far previous and next move; adding one is an entry here,
// its names in the catalogs, and its component.
import { addDays, addMonths, daysFrom, firstOfMonth, monthDays, startOfWeek } from "./dates.ts";

export const VIEWS = ["day", "3days", "week", "month", "agenda"] as const;
export type View = (typeof VIEWS)[number];

/** The views drawn on the time grid. */
export type GridView = "day" | "3days" | "week";

const LENGTH: Record<GridView, number> = { day: 1, "3days": 3, week: 7 };

const byMonth = (view: View): view is "month" | "agenda" => view === "month" || view === "agenda";

/**
 * The days a view shows around `anchor`: a week starts on the locale's first
 * day; a month is its six weeks (design D86). The Agenda loads its own days
 * as it scrolls (design D87); its period is the anchor's month, which the top
 * bar names.
 */
export function periodOf(view: View, anchor: string, weekStart: number): string[] {
  if (view === "month") return monthDays(anchor, weekStart);
  if (view === "agenda") return [anchor];
  const first = view === "week" ? startOfWeek(anchor, weekStart) : anchor;
  return daysFrom(first, LENGTH[view]);
}

/** The first and last day the top bar names: the period's, or the anchor's month. */
export function titleRange(view: View, days: readonly string[], anchor: string): [string, string] {
  if (byMonth(view)) return [firstOfMonth(anchor), addDays(addMonths(anchor, 1), -1)];
  return [days[0]!, days.at(-1)!];
}

/** The anchor one period before (`-1`) or after (`1`); Month and Agenda move to a month's first day. */
export function stepAnchor(view: View, anchor: string, direction: 1 | -1): string {
  if (byMonth(view)) return addMonths(anchor, direction);
  return addDays(anchor, direction * LENGTH[view]);
}

export function isView(value: string | null): value is View {
  return (VIEWS as readonly (string | null)[]).includes(value);
}

/** Google Calendar's keys for its views (design D88). */
export const VIEW_KEYS: ReadonlyMap<string, View> = new Map<string, View>([
  ["d", "day"],
  ["x", "3days"],
  ["w", "week"],
  ["m", "month"],
  ["a", "agenda"],
]);
