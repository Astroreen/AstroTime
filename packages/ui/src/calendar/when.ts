// When an item is, in words (design D108, D112, D159): the details' line,
// and what a move announces. Apart from the details, which load with their
// first opening (docs/plans/foundation.md#D145), as a move needs it at once.
import { wallClockOf, type ItemTime, type Task } from "@astrotime/core";
import type { TFunction } from "i18next";

import { addDays } from "./dates.ts";
import type { Formats } from "./format.ts";

const dayIn = (time: ItemTime, timeZone: string) =>
  time.type === "date" ? time.date : wallClockOf(time, timeZone).slice(0, 10);

/**
 * "Wednesday, November 4 · 10:00 – 11:30", "November 4 – 6", a task's
 * "Wednesday, November 4, 15:00 · Due Thursday, November 5" (its start as
 * the calendar shows it, design D159): the details' line, and what a move
 * announces (design D112).
 */
export function whenText(
  task: Task | null,
  times: { start: ItemTime | null; end: ItemTime | null },
  allDay: boolean,
  { t, formats, timeZone }: { t: TFunction; formats: Formats; timeZone: string },
): string {
  const year = new Date().getFullYear().toString();
  // A task's due follows "Due": not capitalized.
  const at = (time: ItemTime, capital = true) =>
    time.type === "date"
      ? formats.longDate(time.date, year, capital)
      : `${formats.longDate(dayIn(time, timeZone), year, capital)}, ${formats.time(time, timeZone)}`;
  if (task) {
    const parts = [];
    if (times.start) parts.push(at(times.start));
    if (times.end) parts.push(t("details.due", { time: at(times.end, false) }));
    return parts.join(" · ");
  }
  const { start, end } = times;
  if (!start) return "";
  if (allDay) {
    const last = end?.type === "date" ? addDays(end.date, -1) : dayIn(start, timeZone);
    const first = dayIn(start, timeZone);
    return last <= first ? formats.longDate(first, year) : formats.dateRange(first, last);
  }
  if (!end || dayIn(start, timeZone) !== dayIn(end, timeZone)) {
    return end
      ? formats.timeRange(start, end, timeZone)
      : `${formats.longDate(dayIn(start, timeZone), year)}, ${formats.time(start, timeZone)}`;
  }
  return `${formats.longDate(dayIn(start, timeZone), year)} · ${formats.timeRange(start, end, timeZone)}`;
}
