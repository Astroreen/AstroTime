// Items as the views draw them (design D50, D51): blocks and chips filled in
// their colour, a task with its check-circle, a done task struck through and
// muted. Each is a list item named by its title and time.
import { wallClockOf, type Placed } from "@astrotime/core";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { Entry } from "../calendar/query.ts";
import { useCalendar } from "./context.ts";
import { CheckCircleIcon } from "./icons.tsx";

/** When an item is: "All day", its time, or its start and end. */
function useItemTime(): (entry: Entry, allDay: boolean) => string {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  return (entry, allDay) => {
    const { start, end } = entry.occurrence;
    if (allDay) return t("grid.allDay");
    return wallClockOf(start, timeZone) === wallClockOf(end, timeZone)
      ? formats.time(start, timeZone)
      : formats.timeRange(start, end, timeZone);
  };
}

/** The accessible name of an item: what it is, its title and when. */
function useItemLabel(): (entry: Entry, allDay: boolean, time?: string) => string {
  const { t } = useTranslation();
  const timeOf = useItemTime();
  return (entry, allDay, time = timeOf(entry, allDay)) => {
    const { item } = entry.occurrence;
    const title = item.summary?.trim() || t("item.untitled");
    if (item.kind === "event") return t("item.event", { title, time });
    return t(entry.done ? "item.taskDone" : "item.task", { title, time });
  };
}

/** The title on one line, cut with an ellipsis, or (`clip`) cut short as the month's chips are. */
function Title({ entry, wrap, clip }: { entry: Entry; wrap: boolean; clip?: boolean }) {
  const { t } = useTranslation();
  const title = entry.occurrence.item.summary?.trim() || t("item.untitled");
  if (wrap) return <span className="item-title-wrap">{title}</span>;
  return (
    <span
      className={`item-title min-w-0 flex-1 overflow-hidden whitespace-nowrap ${clip ? "" : "text-ellipsis"}`}
    >
      {title}
    </span>
  );
}

const itemStyle = (color: string, style: CSSProperties = {}) =>
  ({ "--item": color, ...style }) as CSSProperties;

/**
 * A chip of the all-day strip, one line high; in the month (`dense`) any
 * item is one, smaller, its title cut short as the reference's (design D86).
 */
export function StripChip({
  entry,
  allDay = true,
  continuesBefore,
  continuesAfter,
  dense = false,
}: {
  entry: Entry;
  allDay?: boolean;
  continuesBefore: boolean;
  continuesAfter: boolean;
  dense?: boolean;
}) {
  const { colorOf } = useCalendar();
  const label = useItemLabel();
  const task = entry.occurrence.item.kind === "task";
  return (
    <div
      role="listitem"
      aria-label={label(entry, allDay)}
      data-done={entry.done || undefined}
      className={[
        "item flex h-full items-center leading-none font-medium",
        dense ? "gap-0.5 rounded-[4px] px-1 text-[11px]" : "gap-1 rounded-[5px] px-1.5 text-[13px]",
        continuesBefore ? "rounded-l-none" : "",
        continuesAfter ? "rounded-r-none" : "",
      ].join(" ")}
      style={itemStyle(colorOf(entry))}
    >
      {task && <CheckCircleIcon className={`${dense ? "size-3" : "size-3.5"} shrink-0`} />}
      <Title entry={entry} wrap={false} clip={dense} />
    </div>
  );
}

/**
 * An item of the Agenda (design D87): filled in its colour like every item,
 * its title over when it is ("All day", "Day 2 of 3", its time).
 */
export function AgendaCard({
  entry,
  allDay,
  part,
}: {
  entry: Entry;
  allDay: boolean;
  part: { index: number; total: number } | null;
}) {
  const { t } = useTranslation();
  const { colorOf } = useCalendar();
  const timeOf = useItemTime();
  const label = useItemLabel();
  const time = part ? t("agenda.dayOf", part) : timeOf(entry, allDay);
  const task = entry.occurrence.item.kind === "task";
  return (
    <div
      role="listitem"
      aria-label={label(entry, allDay, time)}
      data-done={entry.done || undefined}
      className="item flex min-h-11 items-center gap-2 rounded-[8px] px-2.5 py-1.5"
      style={itemStyle(colorOf(entry))}
    >
      {task && <CheckCircleIcon className="size-4 shrink-0" />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex text-[14px] leading-tight font-medium">
          <Title entry={entry} wrap={false} />
        </span>
        <span className="item-time truncate text-[12px] leading-tight">{time}</span>
      </span>
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
