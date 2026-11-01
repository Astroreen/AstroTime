// Items as the views draw them (design D50, D51): blocks and chips filled in
// their colour, a task with its check-circle, a done task struck through and
// muted. Each is a list item named by its title and time; one of a calendar
// that can change drags, a block by its edges too (design D111), and the
// ghost a drag draws looks like it.
import { wallClockOf, type Placed } from "@astrotime/core";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { Entry } from "../calendar/query.ts";
import { useCalendar } from "./context.ts";
import { useDragSource, type DragSource } from "./drag.tsx";
import { targetOf, useEditing } from "./editing.tsx";
import { CheckCircleIcon } from "./icons.tsx";

/**
 * A button over the whole item that opens its details (D14): the item stays
 * a list item named by its title and time, and the button says the same. It
 * takes the keys that move the item (design D112).
 */
function Opener({
  entry,
  label,
  keys,
}: {
  entry: Entry;
  label: string;
  keys?: DragSource["keys"] | undefined;
}) {
  const { open } = useEditing();
  return (
    <button
      type="button"
      aria-label={label}
      {...keys}
      onClick={() =>
        open(
          targetOf(
            { id: entry.objectId, calendarId: entry.calendarId },
            entry.object,
            entry.occurrence.recurrenceId,
            entry.occurrence.item,
          ),
        )
      }
      className="absolute inset-0 z-[1] cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
    />
  );
}

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

/** What the list item of a draggable entry takes: its key, whether it is held, its press. */
function dragProps(entry: Entry, source: DragSource | null, held: boolean) {
  return {
    "data-key": entry.key,
    "data-held": held || undefined,
    ...(source && { onPointerDown: source.onPointerDown, onContextMenu: source.onContextMenu }),
  };
}

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
  const { colorOf, found } = useCalendar();
  const label = useItemLabel();
  const { source, held } = useDragSource(entry, dense ? "month" : "strip");
  const task = entry.occurrence.item.kind === "task";
  const name = label(entry, allDay);
  return (
    <div
      role="listitem"
      aria-label={name}
      data-done={entry.done || undefined}
      data-found={entry.objectId === found || undefined}
      {...dragProps(entry, source, held)}
      className={[
        "item relative flex h-full items-center leading-none font-medium",
        dense ? "gap-0.5 rounded-[4px] px-1 text-[11px]" : "gap-1 rounded-[5px] px-1.5 text-[13px]",
        continuesBefore ? "rounded-l-none" : "",
        continuesAfter ? "rounded-r-none" : "",
        source ? "draggable" : "",
      ].join(" ")}
      style={itemStyle(colorOf(entry))}
    >
      {task && <CheckCircleIcon className={`${dense ? "size-3" : "size-3.5"} shrink-0`} />}
      <Title entry={entry} wrap={false} clip={dense} />
      <Opener entry={entry} label={name} keys={source?.keys} />
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
  const name = label(entry, allDay, time);
  return (
    <div
      role="listitem"
      aria-label={name}
      data-done={entry.done || undefined}
      className="item relative flex min-h-11 items-center gap-2 rounded-[8px] px-2.5 py-1.5"
      style={itemStyle(colorOf(entry))}
    >
      {task && <CheckCircleIcon className="size-4 shrink-0" />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex text-[14px] leading-tight font-medium">
          <Title entry={entry} wrap={false} />
        </span>
        <span className="item-time truncate text-[12px] leading-tight">{time}</span>
      </span>
      <Opener entry={entry} label={name} />
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
  const { colorOf, formats, timeZone, found } = useCalendar();
  const label = useItemLabel();
  const { source, held } = useDragSource(entry, "grid");
  const height = ((bottom - top) / 60) * HOUR - 2;
  const task = entry.occurrence.item.kind === "task";
  const showTime = shape === "block" && !compact && height >= 38;
  const name = label(entry, false);
  // A block's edges resize it where its ends are drawn; a short one keeps its top for moving.
  const edges = shape === "block";
  return (
    <div
      role="listitem"
      aria-label={name}
      data-done={entry.done || undefined}
      data-found={entry.objectId === found || undefined}
      {...dragProps(entry, source, held)}
      className={[
        "item absolute overflow-hidden rounded-[6px]",
        compact ? "px-[3px] py-px text-[11px]" : "px-1.5 py-0.5 text-[12.5px]",
        "leading-[1.2] font-medium",
        shape === "chip" ? "flex items-center gap-1" : "",
        // Drawn over another item: a thin outline in the grid's colour (D50).
        left > 0 ? "outline outline-1 outline-tile" : "",
        continuesBefore ? "rounded-t-none" : "",
        continuesAfter ? "rounded-b-none" : "",
        source ? "draggable" : "",
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
      <Opener entry={entry} label={name} keys={source?.keys} />
      {source && edges && !continuesBefore && height >= 28 && (
        <Edge at="top" onPointerDown={source.onEdgeDown("start")} />
      )}
      {source && edges && !continuesAfter && (
        <Edge at="bottom" onPointerDown={source.onEdgeDown("end")} />
      )}
    </div>
  );
}

/** A block's edge, which resizes that end; a pointer's target only, the keys resize too. */
function Edge({
  at,
  onPointerDown,
}: {
  at: "top" | "bottom";
  onPointerDown: DragSource["onPointerDown"];
}) {
  return (
    <div
      aria-hidden="true"
      data-edge={at}
      onPointerDown={onPointerDown}
      className={`absolute inset-x-0 z-[2] h-2 cursor-ns-resize ${at === "top" ? "top-0" : "bottom-0"}`}
    />
  );
}

/**
 * Where a drag takes an item on the time grid, and when it is then: a block
 * or chip in its colour above the others, with its title and new time
 * (design D111).
 */
export function GhostBlock({
  color,
  title,
  time,
  top,
  bottom,
  compact,
}: {
  color: string;
  title: string;
  time: string;
  /** Minutes from the column's midnight. */
  top: number;
  bottom: number;
  compact: boolean;
}) {
  const height = ((bottom - top) / 60) * HOUR - 2;
  const short = height < 34;
  return (
    <div
      aria-hidden="true"
      data-ghost=""
      className={[
        "item pointer-events-none absolute inset-x-[1.5px] z-[55] overflow-hidden rounded-[6px] leading-[1.2] font-medium shadow-lg ring-2 shadow-black/40 ring-canvas",
        compact ? "px-[3px] py-px text-[11px]" : "px-1.5 py-0.5 text-[12.5px]",
      ].join(" ")}
      style={itemStyle(color, { top: (top / 60) * HOUR + 1, height: Math.max(height, 12) })}
    >
      {short ? (
        <span className="block truncate">
          {time}, {title}
        </span>
      ) : (
        <>
          <span className="item-title-wrap">{title}</span>
          <span className="item-time block text-[11.5px] font-normal">{time}</span>
        </>
      )}
    </div>
  );
}

/** A drag's ghost in the all-day strip or the Month: a chip in its colour over the days it goes to. */
export function GhostChip({
  color,
  title,
  dense,
}: {
  color: string;
  title: string;
  dense: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      data-ghost=""
      className={[
        "item pointer-events-none flex h-full items-center truncate leading-none font-medium shadow-lg ring-2 shadow-black/40 ring-canvas",
        dense ? "rounded-[4px] px-1 text-[11px]" : "rounded-[5px] px-1.5 text-[13px]",
      ].join(" ")}
      style={itemStyle(color)}
    >
      {title}
    </div>
  );
}
