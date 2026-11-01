// The Day, 3-day and Week views (docs/plans/foundation.md#D13–D16, design
// D49–D51): day headers with the week number, the all-day strip pinned above
// the time grid, and the grid of hour tiles with the items and the
// current-time line. Items drag to another time or day, into the strip and
// out of it, and blocks resize (design D111); a press dragged over an empty
// column sizes a new event.
import { dayRange, isAllDay, layoutDay, type Occurrence, type Span } from "@astrotime/core";
import type { UndoneTask } from "@astrotime/storage";
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { daysBetween } from "../calendar/dates.ts";
import { columnAt, slotAt } from "../calendar/drag.ts";
import type { Entry, RangeLayout } from "../calendar/query.ts";
import { useSwipe } from "../hooks.ts";
import { useCalendar } from "./context.ts";
import { DragContext, useDrag, type DragSurface, type Ghost } from "./drag.tsx";
import { useEditing } from "./editing.tsx";
import { ChevronIcon } from "./icons.tsx";
import { GhostBlock, GhostChip, HOUR, StripChip, TimedItem } from "./items.tsx";
import { UndoneChip } from "./undone-chip.tsx";

/** Past this many rows the strip folds to two and "+N" (design D51). */
const STRIP_ROWS = 3;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export interface TimeGridProps {
  readonly days: readonly string[];
  readonly layout: RangeLayout;
  readonly today: string;
  readonly minutes: number;
  readonly undone: readonly UndoneTask[];
  readonly undoneColor: (task: UndoneTask) => string;
  readonly expanded: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  /** A horizontal swipe on a touch screen: the next (`1`) or previous (`-1`) period. */
  readonly onSwipe: (direction: 1 | -1) => void;
  /** A "+" button floats over the grid's corner (design D132): room is kept below midnight. */
  readonly floating: boolean;
}

export function TimeGrid(props: TimeGridProps) {
  const { days, layout, today, minutes, expanded, onExpandedChange, onSwipe, floating } = props;
  const { t } = useTranslation();
  const { formats } = useCalendar();
  const single = days.length === 1;
  const compact = days.length > 3;
  const columns: CSSProperties = {
    gridTemplateColumns: `var(--gutter) repeat(${days.length}, minmax(0, 1fr))`,
  };
  const collapsible = layout.rows > STRIP_ROWS;

  const chevron = collapsible && (
    <button
      type="button"
      aria-expanded={expanded}
      aria-label={t(expanded ? "grid.collapse" : "grid.expand")}
      onClick={() => onExpandedChange(!expanded)}
      className="mx-auto grid size-8 place-items-center rounded-full text-ink-muted hover:bg-raised"
    >
      <ChevronIcon direction={expanded ? "up" : "down"} className="size-5" />
    </button>
  );

  const scroller = useRef<HTMLDivElement>(null);
  // On open, the grid shows the current time, or the morning on another day.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const hour = days.includes(today) ? Math.max(0, minutes / 60 - 2) : 7.5;
    element.scrollTop = hour * HOUR;
    // Only on open; afterwards the user's scroll stays.
  }, []);

  const swipe = useSwipe(onSwipe);
  const editing = useEditing();

  const root = useRef<HTMLDivElement>(null);
  const columnElements = useRef<(HTMLDivElement | null)[]>([]);
  // What is under a point: a day's column, and its slot below the strip.
  const surface: DragSurface = {
    spotAt(x, y, grip, from) {
      const rects = days.map((_, index) => columnElements.current[index]?.getBoundingClientRect());
      const top = scroller.current?.getBoundingClientRect().top;
      if (top === undefined || rects.some((rect) => !rect)) return null;
      const edges = rects as DOMRect[];
      const index = grip === "move" || !from ? columnAt(x, edges) : days.indexOf(from.day);
      const day = days[index];
      if (!day) return null;
      if (grip === "move" && y < top) return { day, minutes: null };
      return { day, minutes: slotAt(y - edges[index]!.top, HOUR) };
    },
    scroller: () => scroller.current,
  };
  const find = (key: string) => {
    for (const column of layout.columns) {
      const found = column.timed.find(({ entry }) => entry.key === key);
      if (found) return found.entry;
    }
    return layout.strip.find(({ entry }) => entry?.key === key)?.entry ?? undefined;
  };
  const drag = useDrag({ surface, root, find });
  const ghost = drag.ghost;
  // A tap on an empty slot creates an event there, an hour long, from the
  // half hour tapped (Google); a press to size it comes with dragging.
  const createAt = (day: string) => (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!editing.canCreate || target?.closest("[role=listitem], button")) return;
    const top = event.currentTarget.getBoundingClientRect().top;
    const slot = Math.floor(((event.clientY - top) / HOUR) * 2) * 30;
    editing.create("event", { day, at: Math.max(0, Math.min(slot, 23 * 60 + 30)) });
  };

  return (
    <DragContext.Provider value={drag.value}>
      <div ref={root} className="flex min-h-0 flex-1 flex-col">
        <div
          className="grid shrink-0 overflow-y-hidden pb-1 [scrollbar-gutter:stable]"
          style={columns}
        >
          {single ? (
            <div className="row-span-2 flex flex-col items-center gap-1 pt-1">
              <DayHeader day={days[0]!} today={today} />
              {chevron}
            </div>
          ) : (
            <>
              <div className="flex items-end justify-center pb-1.5">
                <span className="rounded-full bg-pill px-2 py-1 text-note font-medium text-ink-muted">
                  <span aria-hidden="true">{formats.weekNumber(days)}</span>
                  <span className="sr-only">
                    {t("grid.week", { number: formats.weekNumber(days) })}
                  </span>
                </span>
              </div>
              {days.map((day) => (
                <DayHeader key={day} day={day} today={today} />
              ))}
              <div className="pt-0.5">{chevron}</div>
            </>
          )}
          <div style={{ gridColumn: `2 / span ${days.length}` }} className={single ? "pt-1" : ""}>
            <Strip {...props} collapsed={collapsible && !expanded} ghost={ghost} />
          </div>
        </div>
        <div
          ref={scroller}
          // Room under midnight, so the "+" button never hides the last hour (design D132).
          className={`relative min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain [scrollbar-gutter:stable] ${floating ? "pb-20" : ""}`}
          {...swipe}
        >
          <div className="grid" style={{ ...columns, height: 24 * HOUR }}>
            <div aria-hidden="true" className="relative">
              {HOURS.slice(1).map((hour) => (
                <span
                  key={hour}
                  className="absolute right-1.5 -translate-y-1/2 text-tiny text-ink-muted tabular-nums"
                  style={{ top: hour * HOUR }}
                >
                  {formats.hour(hour)}
                </span>
              ))}
            </div>
            {layout.columns.map((column, index) => (
              <div
                key={column.day}
                ref={(element) => {
                  columnElements.current[index] = element;
                }}
                role="list"
                aria-label={formats.fullDate(column.day)}
                className="relative"
                onClick={createAt(column.day)}
                onPointerDown={drag.pressEmpty(column.day)}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    aria-hidden="true"
                    className="absolute inset-x-[1.5px] rounded-[6px] bg-tile"
                    style={{ top: hour * HOUR + 1.5, height: HOUR - 3 }}
                  />
                ))}
                {column.timed.map((placed) => (
                  <TimedItem key={placed.entry.key} {...placed} compact={compact} />
                ))}
                {ghost && <ColumnGhost ghost={ghost} day={column.day} compact={compact} />}
                {column.day === today && <NowLine minutes={minutes} />}
              </div>
            ))}
          </div>
        </div>
        {drag.overlay}
      </div>
    </DragContext.Provider>
  );
}

/** A drag's ghost in a day's column: the item where it goes, or the new event a press sizes. */
function ColumnGhost({ ghost, day, compact }: { ghost: Ghost; day: string; compact: boolean }) {
  const { t } = useTranslation();
  const { colorOf, formats, timeZone } = useCalendar();
  if (ghost.kind === "create") {
    if (ghost.day !== day) return null;
    const clock = (minutes: number): Occurrence["start"] => ({
      type: "floating",
      local: new Date(Date.parse(`${day}T00:00:00Z`) + minutes * 60_000).toISOString().slice(0, 19),
    });
    return (
      <GhostBlock
        color="var(--color-accent)"
        title={t("item.untitled")}
        time={formats.timeRange(clock(ghost.at), clock(ghost.at + ghost.length), timeZone)}
        top={ghost.at}
        bottom={ghost.at + ghost.length}
        compact={compact}
      />
    );
  }
  const { occurrence, entry } = ghost;
  if (isAllDay(occurrence, timeZone)) return null;
  const placed = layoutDay([occurrence], day, { timeZone }).timed[0];
  if (!placed) return null;
  const time =
    placed.shape === "chip"
      ? formats.time(occurrence.end, timeZone)
      : formats.timeRange(occurrence.start, occurrence.end, timeZone);
  return (
    <GhostBlock
      color={colorOf(entry)}
      title={titleOf(entry, t("item.untitled"))}
      time={time}
      top={placed.top}
      bottom={placed.bottom}
      compact={compact}
    />
  );
}

const titleOf = (entry: Entry, untitled: string) =>
  entry.occurrence.item.summary?.trim() || untitled;

/** A day's weekday and number, today's in the accent (design D49); the Agenda's days too. */
export function DayHeader({
  day,
  today,
  level = 2,
}: {
  day: string;
  today: string;
  level?: number;
}) {
  const { formats } = useCalendar();
  const isToday = day === today;
  return (
    <div
      className="flex flex-col items-center gap-0.5 pt-1"
      aria-current={isToday ? "date" : undefined}
      aria-label={formats.fullDate(day)}
      role="heading"
      aria-level={level}
    >
      <span
        aria-hidden="true"
        className={`text-chip ${isToday ? "font-semibold text-accent" : "text-ink-muted"}`}
      >
        {formats.weekday(day)}
      </span>
      <span
        aria-hidden="true"
        className={`grid size-8 place-items-center rounded-full text-title leading-none ${
          isToday ? "bg-accent font-medium text-on-accent" : "text-ink"
        }`}
      >
        {formats.dayNumber(day)}
      </span>
    </div>
  );
}

function NowLine({ minutes }: { minutes: number }) {
  return (
    <div
      aria-hidden="true"
      data-now=""
      className="pointer-events-none absolute inset-x-0 z-50"
      style={{ top: (minutes / 60) * HOUR }}
    >
      <div className="h-0.5 -translate-y-1/2 bg-now" />
      <div className="absolute top-0 -left-[5px] size-2.5 -translate-y-1/2 rounded-full bg-now" />
    </div>
  );
}

function Strip({
  days,
  layout,
  collapsed,
  undone,
  undoneColor,
  onExpandedChange,
  ghost,
}: TimeGridProps & { collapsed: boolean; ghost: Ghost | null }) {
  const { t } = useTranslation();
  const { formats, timeZone, colorOf } = useCalendar();
  // A drag's ghost over the days it goes to, on the first row.
  const over =
    ghost?.kind === "item" && isAllDay(ghost.occurrence, timeZone)
      ? dayRange(ghost.occurrence, timeZone)
      : null;
  const first = over ? Math.max(0, daysBetween(days[0]!, over.first)) : 0;
  const last = over ? Math.min(days.length - 1, daysBetween(days[0]!, over.last)) : -1;
  const shown = collapsed
    ? layout.strip.filter(({ span }) => span.row < STRIP_ROWS - 1)
    : layout.strip;
  const more = collapsed
    ? days
        .map((day, index) => ({
          day,
          index,
          count: layout.strip.filter(
            ({ span }) =>
              span.row >= STRIP_ROWS - 1 && span.firstDay <= index && index <= span.lastDay,
          ).length,
        }))
        .filter(({ count }) => count > 0)
    : [];
  const rows = collapsed ? STRIP_ROWS : layout.rows;
  return (
    <div
      role="list"
      aria-label={t("grid.allDay")}
      className={`grid gap-y-0.5 ${collapsed ? "" : "max-h-[40vh] overflow-y-auto"}`}
      style={{
        gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, 24px)`,
        minHeight: rows === 0 ? 4 : undefined,
      }}
    >
      {shown.map(({ span, entry }) => (
        <StripCell key={entry?.key ?? "undone"} span={span}>
          {entry ? (
            <StripChip
              entry={entry}
              continuesBefore={span.continuesBefore}
              continuesAfter={span.continuesAfter}
            />
          ) : (
            <div role="listitem" className="h-full">
              <UndoneChip tasks={undone} colorOf={undoneColor} />
            </div>
          )}
        </StripCell>
      ))}
      {ghost?.kind === "item" && first <= last && (
        <div
          className="relative z-10 min-w-0 px-[1.5px]"
          style={{ gridColumn: `${first + 1} / ${last + 2}`, gridRow: 1 }}
        >
          <GhostChip
            color={colorOf(ghost.entry)}
            title={titleOf(ghost.entry, t("item.untitled"))}
            dense={false}
          />
        </div>
      )}
      {more.map(({ day, index, count }) => (
        <div
          key={day}
          role="listitem"
          className="px-[1.5px]"
          style={{ gridColumn: index + 1, gridRow: STRIP_ROWS }}
        >
          <button
            type="button"
            aria-label={t("grid.moreLabel", { count, day: formats.fullDate(day) })}
            onClick={() => onExpandedChange(true)}
            className="h-full w-full truncate rounded-[5px] px-1.5 text-left text-small text-ink-muted -outline-offset-2 hover:bg-raised"
          >
            {t("grid.more", { count })}
          </button>
        </div>
      ))}
    </div>
  );
}

function StripCell({ span, children }: { span: Span; children: ReactNode }) {
  return (
    <div
      className="min-w-0 px-[1.5px]"
      style={{ gridColumn: `${span.firstDay + 1} / ${span.lastDay + 2}`, gridRow: span.row + 1 }}
    >
      {children}
    </div>
  );
}
