// Items as the views draw them (design D50, D51): blocks and chips filled in
// their colour, a task with its check-circle, a done task struck through and
// muted. Each is a list item named by its title and time; one of a calendar
// that can change drags, a block by its edges too (design D111), and the
// ghost a drag draws looks like it.
import { wallClockOf, type Placed } from "@astrotime/core";
import type { CSSProperties, Ref } from "react";

import { DRAFT, type Entry } from "../calendar/query.ts";
import { useCalendar, type Landed } from "./context.ts";
import { useDragSource, type DragSource } from "./drag.tsx";
import { targetOf, useEditing } from "./editing.tsx";
import { CheckCircleIcon } from "./icons.tsx";

/**
 * A button over the whole item that opens its details (D14): the item stays
 * a list item named by its title and time, and the button says the same. It
 * takes the keys that move the item (design D112).
 */
export function Opener({
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
      // Its ring is drawn inward, in white: the grid's scroller, the strip
      // and a Month day's rows clip what goes past an item, and white on
      // its fill has the text's contrast (design D120).
      className="absolute inset-0 z-[1] cursor-pointer rounded-[inherit] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
    />
  );
}

/** When an item is: "All day", its time (a task's start, design D159), or its start and end. */
export function useItemTime(): (entry: Entry, allDay: boolean) => string {
  const { t, formats, timeZone } = useCalendar();
  return (entry, allDay) => {
    const { item, start, end } = entry.occurrence;
    if (allDay) return t("grid.allDay");
    return item.kind === "task" || wallClockOf(start, timeZone) === wallClockOf(end, timeZone)
      ? formats.time(start, timeZone)
      : formats.timeRange(start, end, timeZone);
  };
}

/** The accessible name of an item: what it is, its title and when. */
export function useItemLabel(): (entry: Entry, allDay: boolean, time?: string) => string {
  const { t } = useCalendar();
  const timeOf = useItemTime();
  return (entry, allDay, time = timeOf(entry, allDay)) => {
    const { item } = entry.occurrence;
    const title = item.summary?.trim() || t("item.untitled");
    if (item.kind === "event") return t("item.event", { title, time });
    return t(entry.done ? "item.taskDone" : "item.task", { title, time });
  };
}

/** The title on one line, cut with an ellipsis, or (`clip`) cut short as the month's chips are. */
export function Title({
  entry,
  wrap,
  clip,
  lines,
}: {
  entry: Entry;
  wrap: boolean;
  clip?: boolean;
  /** At most this many lines, wrapped, the last one cut short. */
  lines?: number | undefined;
}) {
  const { t } = useCalendar();
  const title = entry.occurrence.item.summary?.trim() || t("item.untitled");
  if (wrap) {
    return (
      <span
        className="item-title-wrap"
        style={
          lines === undefined
            ? undefined
            : {
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: lines,
                overflow: "hidden",
              }
        }
      >
        {title}
      </span>
    );
  }
  return (
    <span
      className={`item-title min-w-0 flex-1 overflow-hidden whitespace-nowrap ${clip ? "" : "text-ellipsis"}`}
    >
      {title}
    </span>
  );
}

export const itemStyle = (color: string, style: CSSProperties = {}) =>
  ({ "--item": color, ...style }) as CSSProperties;

/**
 * Whether this is the occurrence the edit dialog saved, which lands once
 * (design D193): its own item and start, not the series' others.
 */
const lands = (entry: Entry, landed: Landed | null | undefined, timeZone: string) =>
  landed != null &&
  entry.occurrence.item.uid === landed.uid &&
  wallClockOf(entry.occurrence.start, timeZone).startsWith(landed.at);

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
 * Without `opens` it has no button of its own: a tap goes to what is under
 * it, the Month's day on a touch screen (design D86), and a long press still
 * drags it.
 */
export function StripChip({
  entry,
  allDay = true,
  continuesBefore,
  continuesAfter,
  dense = false,
  opens = true,
}: {
  entry: Entry;
  allDay?: boolean;
  continuesBefore: boolean;
  continuesAfter: boolean;
  dense?: boolean;
  opens?: boolean;
}) {
  const { colorOf, found, landed, timeZone } = useCalendar();
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
      data-draft={entry.objectId === DRAFT || undefined}
      data-landed={lands(entry, landed, timeZone) || undefined}
      {...dragProps(entry, source, held)}
      className={[
        "item relative flex h-full items-center leading-none font-medium",
        dense ? "gap-0.5 rounded-[4px] px-1 text-tiny" : "gap-1 rounded-[5px] px-1.5 text-small",
        continuesBefore ? "rounded-l-none" : "",
        continuesAfter ? "rounded-r-none" : "",
        source ? "draggable" : "",
      ].join(" ")}
      style={itemStyle(colorOf(entry))}
    >
      {task && <CheckCircleIcon className={`${dense ? "size-3" : "size-3.5"} shrink-0`} />}
      <Title entry={entry} wrap={false} clip={dense} />
      {opens && <Opener entry={entry} label={name} keys={source?.keys} />}
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
  ref,
}: {
  entry: Entry;
  allDay: boolean;
  part: { index: number; total: number } | null;
  /** The card, for one that may yet be drawn over a place's photo (design D220). */
  ref?: Ref<HTMLDivElement>;
}) {
  const { t, colorOf, landed, timeZone } = useCalendar();
  const timeOf = useItemTime();
  const label = useItemLabel();
  const time = part ? t("agenda.dayOf", part) : timeOf(entry, allDay);
  const task = entry.occurrence.item.kind === "task";
  const name = label(entry, allDay, time);
  return (
    <div
      ref={ref}
      role="listitem"
      data-draft={entry.objectId === DRAFT || undefined}
      data-landed={lands(entry, landed, timeZone) || undefined}
      aria-label={name}
      data-done={entry.done || undefined}
      className="item relative flex min-h-11 items-center gap-2 rounded-[8px] px-2.5 py-1.5"
      style={itemStyle(colorOf(entry))}
    >
      {task && <CheckCircleIcon className="size-4 shrink-0" />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex text-body leading-tight font-medium">
          <Title entry={entry} wrap={false} />
        </span>
        <span className="item-time truncate text-note leading-tight">{time}</span>
      </span>
      <Opener entry={entry} label={name} />
    </div>
  );
}

/**
 * Pixels per hour in the time grid unless the user pinched it to another
 * height (design D192): the CSS `--hour` the grid draws with, and the
 * context's `hour` its arithmetic uses.
 */
export const HOUR = 56;

/** An hour's height as the user may pinch it, 24 to 240 px (design D192). */
export const hourIn = (px: number) => Math.min(240, Math.max(24, px));

/** `minutes` down the grid, plus `px`, at the hour's height as drawn now (`--hour`). */
export const down = (minutes: number, px = 0) => `calc(var(--hour) * ${minutes / 60} + ${px}px)`;

/** A block's height from `top` to `bottom` minutes, 2 px clear, never under 12. */
const blockHeight = (top: number, bottom: number) =>
  `max(12px, calc(var(--hour) * ${(bottom - top) / 60} - 2px))`;
/** Pixels a line of an item's title takes: `text-tiny` or `text-note` at `leading-[1.2]`. */
const LINE = { compact: 13.2, wide: 15 } as const;
/** Pixels of a block's padding, top and bottom: `py-px` or `py-0.5`. */
const PADDING = { compact: 2, wide: 4 } as const;
/** Pixels the time line takes: `text-chip` at 1.2. */
const TIME_LINE = 14;

/**
 * What of a timed block's text fits in `visible` pixels at its top (design
 * D153): the time line under the title where it has room (never in a
 * narrow column); and, `covered` by an item drawn over it, as many whole
 * lines of its title as fit above that item, two of them before the time
 * line, since the title matters most.
 */
export function textFit(
  visible: number,
  { compact, covered }: { compact: boolean; covered: boolean },
): { showTime: boolean; lines: number | undefined } {
  const size = compact ? "compact" : "wide";
  const timeFits = !compact && visible >= 38;
  if (!covered) return { showTime: timeFits, lines: undefined };
  const showTime = timeFits && visible - PADDING[size] - TIME_LINE >= 2 * LINE[size];
  const lines = Math.floor((visible - PADDING[size] - (showTime ? TIME_LINE : 0)) / LINE[size]);
  return { showTime, lines: Math.max(1, lines) };
}

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
  const { shape, top, bottom, left, width, layer, room, continuesBefore, continuesAfter } = placed;
  const { colorOf, formats, timeZone, found, hour, landed } = useCalendar();
  const label = useItemLabel();
  const { source, held } = useDragSource(entry, "grid");
  const height = ((bottom - top) / 60) * hour - 2;
  const task = entry.occurrence.item.kind === "task";
  // Another item drawn over this one from `room` on: its text keeps above
  // that, as many whole lines as fit (design D153).
  const covered = room < bottom - top;
  const fit = textFit(covered ? (room / 60) * hour - 2 : height, { compact, covered });
  const showTime = shape === "block" && fit.showTime;
  const lines = fit.lines;
  const name = label(entry, false);
  // A block's edges resize it where its ends are drawn; a short one keeps its top for moving.
  const edges = shape === "block";
  return (
    <div
      role="listitem"
      aria-label={name}
      data-done={entry.done || undefined}
      data-found={entry.objectId === found || undefined}
      data-draft={entry.objectId === DRAFT || undefined}
      data-landed={lands(entry, landed, timeZone) || undefined}
      {...dragProps(entry, source, held)}
      className={[
        "item absolute overflow-hidden rounded-[6px]",
        compact ? "px-[3px] py-px text-tiny" : "px-1.5 py-0.5 text-note",
        "leading-[1.2] font-medium",
        shape === "chip" ? "flex items-center gap-1" : "",
        // Drawn over another item: a thin outline in the grid's colour (D50).
        left > 0 ? "outline outline-1 outline-tile" : "",
        continuesBefore ? "rounded-t-none" : "",
        continuesAfter ? "rounded-b-none" : "",
        source ? "draggable" : "",
      ].join(" ")}
      style={itemStyle(colorOf(entry), {
        top: down(top, 1),
        height: blockHeight(top, bottom),
        left: `calc(${left * 100}% + 1.5px)`,
        width: `calc(${width * 100}% - 3px)`,
        zIndex: layer + 1,
      })}
    >
      {task && shape === "chip" && <CheckCircleIcon className="size-3 shrink-0" />}
      {shape === "chip" ? (
        <Title entry={entry} wrap={false} />
      ) : (
        <Title entry={entry} wrap lines={lines} />
      )}
      {showTime && (
        <span className="item-time block truncate text-chip font-normal">
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
  const { hour } = useCalendar();
  const short = ((bottom - top) / 60) * hour - 2 < 34;
  return (
    <div
      aria-hidden="true"
      data-ghost=""
      className={[
        "item pointer-events-none absolute inset-x-[1.5px] z-[55] overflow-hidden rounded-[6px] leading-[1.2] font-medium shadow-lg ring-2 shadow-black/40 ring-canvas",
        compact ? "px-[3px] py-px text-tiny" : "px-1.5 py-0.5 text-note",
      ].join(" ")}
      style={itemStyle(color, { top: down(top, 1), height: blockHeight(top, bottom) })}
    >
      {short ? (
        <span className="block truncate">
          {time}, {title}
        </span>
      ) : (
        <>
          <span className="item-title-wrap">{title}</span>
          <span className="item-time block truncate text-chip font-normal">{time}</span>
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
        dense ? "rounded-[4px] px-1 text-tiny" : "rounded-[5px] px-1.5 text-small",
      ].join(" ")}
      style={itemStyle(color)}
    >
      {title}
    </div>
  );
}
