// Items as the views draw them (design D50, D51): blocks and chips filled in
// their colour, a task with its check-circle, a done task struck through and
// muted. Each is a list item named by its title and time.
import { wallClockOf, type Placed } from "@astrotime/core";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { Entry } from "../calendar/query.ts";
import { useCalendar } from "./context.ts";
import { CheckCircleIcon } from "./icons.tsx";

/** The accessible name of an item: what it is, its title and when. */
function useItemLabel(): (entry: Entry, allDay: boolean) => string {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  return (entry, allDay) => {
    const { item, start, end } = entry.occurrence;
    const title = item.summary?.trim() || t("item.untitled");
    const time = allDay
      ? t("grid.allDay")
      : wallClockOf(start, timeZone) === wallClockOf(end, timeZone)
        ? formats.time(start, timeZone)
        : formats.timeRange(start, end, timeZone);
    if (item.kind === "event") return t("item.event", { title, time });
    return t(entry.done ? "item.taskDone" : "item.task", { title, time });
  };
}

function Title({ entry, wrap }: { entry: Entry; wrap: boolean }) {
  const { t } = useTranslation();
  const title = entry.occurrence.item.summary?.trim() || t("item.untitled");
  return <span className={wrap ? "item-title-wrap" : "min-w-0 flex-1 truncate"}>{title}</span>;
}

const itemStyle = (color: string, style: CSSProperties = {}) =>
  ({ "--item": color, ...style }) as CSSProperties;

/** A chip of the all-day strip, one line high. */
export function StripChip({
  entry,
  continuesBefore,
  continuesAfter,
}: {
  entry: Entry;
  continuesBefore: boolean;
  continuesAfter: boolean;
}) {
  const { colorOf } = useCalendar();
  const label = useItemLabel();
  const task = entry.occurrence.item.kind === "task";
  return (
    <div
      role="listitem"
      aria-label={label(entry, true)}
      data-done={entry.done || undefined}
      className={[
        "item flex h-full items-center gap-1 rounded-[5px] px-1.5 text-[13px] leading-none font-medium",
        continuesBefore ? "rounded-l-none" : "",
        continuesAfter ? "rounded-r-none" : "",
      ].join(" ")}
      style={itemStyle(colorOf(entry))}
    >
      {task && <CheckCircleIcon className="size-3.5 shrink-0" />}
      <Title entry={entry} wrap={false} />
    </div>
  );
}

/** HOUR pixels per hour in the time grid. */
export const HOUR = 56;

/** A timed item in a day's column: a block from start to end, or a task's 30-minute chip. */
export function TimedItem({
  entry,
  placed,
  compact,
}: {
  entry: Entry;
  placed: Placed;
  /** A narrow column (a week on a phone): smaller text, no time line. */
  compact: boolean;
}) {
  const { shape, top, bottom, left, width, layer, continuesBefore, continuesAfter } = placed;
  const { colorOf, formats, timeZone } = useCalendar();
  const label = useItemLabel();
  const height = ((bottom - top) / 60) * HOUR - 2;
  const task = entry.occurrence.item.kind === "task";
  const showTime = shape === "block" && !compact && height >= 38;
  return (
    <div
      role="listitem"
      aria-label={label(entry, false)}
      data-done={entry.done || undefined}
      className={[
        "item absolute overflow-hidden rounded-[6px]",
        compact ? "px-[3px] py-px text-[11px]" : "px-1.5 py-0.5 text-[12.5px]",
        "leading-[1.2] font-medium",
        shape === "chip" ? "flex items-center gap-1" : "",
        // Drawn over another item: a thin outline in the grid's colour (D50).
        left > 0 ? "outline outline-1 outline-tile" : "",
        continuesBefore ? "rounded-t-none" : "",
        continuesAfter ? "rounded-b-none" : "",
      ].join(" ")}
      style={itemStyle(colorOf(entry), {
        top: (top / 60) * HOUR + 1,
        height: Math.max(height, 12),
        left: `calc(${left * 100}% + 1.5px)`,
        width: `calc(${width * 100}% - 3px)`,
        zIndex: layer + 1,
      })}
    >
      {task && shape === "chip" && <CheckCircleIcon className="size-3 shrink-0" />}
      {shape === "chip" ? <Title entry={entry} wrap={false} /> : <Title entry={entry} wrap />}
      {showTime && (
        <span className="item-time block text-[11.5px] font-normal">
          {formats.timeRange(entry.occurrence.start, entry.occurrence.end, timeZone)}
        </span>
      )}
    </div>
  );
}
