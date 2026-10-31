// The views with a time grid (docs/plans/foundation.md#D13, design D48). A
// view is how many days it shows and where its period starts; adding one is
// an entry here, its names in the catalogs, and its component.
import { addDays, daysFrom, startOfWeek } from "./dates.ts";

export const VIEWS = ["day", "3days", "week"] as const;
export type View = (typeof VIEWS)[number];

const LENGTH: Record<View, number> = { day: 1, "3days": 3, week: 7 };

/** The days a view shows around `anchor`: a week starts on the locale's first day. */
export function periodOf(view: View, anchor: string, weekStart: number): string[] {
  const first = view === "week" ? startOfWeek(anchor, weekStart) : anchor;
  return daysFrom(first, LENGTH[view]);
}

/** The anchor one period before (`-1`) or after (`1`). */
export function stepAnchor(view: View, anchor: string, direction: 1 | -1): string {
  return addDays(anchor, direction * LENGTH[view]);
}

export function isView(value: string | null): value is View {
  return (VIEWS as readonly (string | null)[]).includes(value);
}
