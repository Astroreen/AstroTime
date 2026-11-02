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
  type RefObject,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { daysBetween } from "../calendar/dates.ts";
import { columnAt, evenColumns, slotAt } from "../calendar/drag.ts";
import { foldWeek } from "../calendar/month.ts";
import type { Entry, RangeLayout } from "../calendar/query.ts";
import { useCalendar } from "./context.ts";
import { DragContext, useDrag, type DragSurface, type Ghost } from "./drag.tsx";
import { useEditing } from "./editing.tsx";
import { ChevronIcon } from "./icons.tsx";
import { GhostBlock, GhostChip, StripChip, TimedItem, down } from "./items.tsx";
import { UndoneChip } from "./undone-chip.tsx";

/** Past this many rows the strip folds: a day with more gives its last row to "+N" (design D51, D186). */
const STRIP_ROWS = 3;
/** Milliseconds within which two presses can be one double click. */
const DOUBLE_CLICK = 1000;
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
  /** A "+" button floats over the grid's corner (design D132): room is kept below midnight. */
  readonly floating: boolean;
  /** The period shown, not one drawn beside it for a swipe (design D154). */
  readonly current: boolean;
  /** Where the grid was last scrolled, kept for the next period's and view's grid. */
  readonly scroll: RefObject<number | null>;
}

export function TimeGrid(props: TimeGridProps) {
  const { days, layout, today, minutes, expanded, onExpandedChange, floating, current, scroll } =
    props;
  const { t, formats, weekNumbers, hour } = useCalendar();
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
  // On open, the grid shows the current time, or the morning on another day;
  // afterwards the user's scroll stays, on the next period and view too.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const start = days.includes(today) ? Math.max(0, minutes / 60 - 2) : 7.5;
    element.scrollTop = scroll.current ?? start * hour;
    // Only on open.
  }, []);

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
      return { day, minutes: slotAt(y - edges[index]!.top, hour) };
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
  // What this grid's last two presses were on: an empty slot (its day and
  // half hour) or an item, so a double click's second click knows where its
  // first one went (design D154).
  const presses = useRef<{ readonly spot: string; readonly at: number }[]>([]);
  const spotOf = (column: Element, y: number) =>
    `${column.getAttribute("data-day")}/${Math.floor(((y - column.getBoundingClientRect().top) / hour) * 2) * 30}`;
  const pressed = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    const column = target?.closest("[data-day]");
    const spot =
      !column || target?.closest("[role=listitem], button")
        ? "item"
        : spotOf(column, event.clientY);
    presses.current = [...presses.current.slice(-1), { spot, at: event.timeStamp }];
  };
  const createAt = (day: string) => (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!editing.canCreate || target?.closest("[role=listitem], button")) return;
    const spot = spotOf(event.currentTarget, event.clientY);
    const slot = Number(spot.slice(day.length + 1));
    // A double click's second click on the slot its first took, or after a
    // first press that was not on this grid at all (a closing month picker's
    // day, whose period this grid is: design D136), creates nothing; one
    // after a press on another slot or on an item is a click of its own.
    const [before, now] = presses.current.slice(-2);
    const first = before && now && now.at - before.at < DOUBLE_CLICK ? before.spot : null;
    if (event.detail > 1 && (first === null || first === spot)) return;
    editing.create("event", {
      day,
      at: Math.max(0, Math.min(slot, 23 * 60 + 30)),
      press: pressOf(event),
    });
  };

  return (
    <DragContext.Provider value={drag.value}>
      <div ref={root} className="flex min-h-0 flex-1 flex-col">
        <div
          className="grid shrink-0 overflow-y-hidden pb-2 [scrollbar-gutter:stable]"
          style={columns}
        >
          {single ? (
            <div className="row-span-2 flex flex-col items-center gap-1 pt-1">
              <DayHeader day={days[0]!} today={today} />
              {chevron}
            </div>
          ) : (
            <>
              {/* The week's number, unless the user turned it off (design D169). */}
              <div className="flex items-end justify-center pb-1.5">
                {weekNumbers && (
                  <span className="rounded-full bg-pill px-2 py-1 text-note font-medium text-ink-muted">
                    <span aria-hidden="true">{formats.weekNumber(days)}</span>
                    <span className="sr-only">
                      {t("grid.week", { number: formats.weekNumber(days) })}
                    </span>
                  </span>
                )}
              </div>
              {days.map((day) => (
                <DayHeader key={day} day={day} today={today} />
              ))}
              <div className="pt-2.5">{chevron}</div>
            </>
          )}
          {/* Today's circle 8 px clear of the items under it (design D189). */}
          <div
            style={{ gridColumn: `2 / span ${days.length}` }}
            className={single ? "pt-1" : "pt-2"}
          >
            <Strip {...props} collapsed={collapsible && !expanded} ghost={ghost} />
          </div>
        </div>
        <div
          ref={scroller}
          data-scroller=""
          onScroll={(event) => {
            if (current) scroll.current = event.currentTarget.scrollTop;
          }}
          // Room under midnight, so the "+" button never hides the last hour (design D132).
          className={`relative min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain [scrollbar-gutter:stable] ${floating ? "pb-20" : ""}`}
        >
          <div
            className="grid"
            style={{ ...columns, height: down(24 * 60) }}
            onPointerDownCapture={pressed}
          >
            <div aria-hidden="true" className="relative">
              {HOURS.slice(1).map((at) => (
                <span
                  key={at}
                  className="absolute right-1.5 -translate-y-1/2 text-tiny text-ink-muted tabular-nums"
                  style={{ top: down(at * 60) }}
                >
                  {formats.hour(at)}
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
                data-day={column.day}
                className="relative"
                onClick={createAt(column.day)}
                onPointerDown={drag.pressEmpty(column.day)}
              >
                {HOURS.map((at) => (
                  <div
                    key={at}
                    aria-hidden="true"
                    className="absolute inset-x-[1.5px] rounded-[6px] bg-tile"
                    style={{ top: down(at * 60, 1.5), height: down(60, -3) }}
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
  const { t, colorOf, formats, timeZone } = useCalendar();
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

/** A click as the edit dialog remembers what opened it (design D190). */
const pressOf = (event: MouseEvent) => ({
  x: event.clientX,
  y: event.clientY,
  detail: event.detail,
  at: event.timeStamp,
});

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
        data-day-number=""
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
      style={{ top: down(minutes) }}
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
  const { t, formats, timeZone, colorOf } = useCalendar();
  const editing = useEditing();
  // A tap on an empty spot of a day creates on it, all day, as a slot of the
  // grid creates at its time (design D188); an item or "+N" is its own.
  // Where the last press began, if on an empty spot: a press on an item
  // that ends beside it is no tap there (a read-only item held and let go).
  const pressed = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const onItem = (target: EventTarget) =>
    target instanceof Element && target.closest("[role=listitem], button") !== null;
  const press = (event: PointerEvent<HTMLDivElement>) => {
    pressed.current = onItem(event.target) ? null : { x: event.clientX, y: event.clientY };
  };
  const createAt = (event: MouseEvent<HTMLDivElement>) => {
    const from = pressed.current;
    pressed.current = null;
    const still = from && Math.hypot(event.clientX - from.x, event.clientY - from.y) < 8;
    if (!editing.canCreate || event.detail > 1 || !still || onItem(event.target)) return;
    // The days by the content box: an open strip's scrollbar is no day's.
    const strip = event.currentTarget;
    const left = strip.getBoundingClientRect().left + strip.clientLeft;
    const day = days[columnAt(event.clientX, evenColumns(left, strip.clientWidth, days.length))]!;
    editing.create("event", { day, allDay: true, press: pressOf(event) });
  };
  // A drag's ghost over the days it goes to, on the first row.
  const over =
    ghost?.kind === "item" && isAllDay(ghost.occurrence, timeZone)
      ? dayRange(ghost.occurrence, timeZone)
      : null;
  const first = over ? Math.max(0, daysBetween(days[0]!, over.first)) : 0;
  const last = over ? Math.min(days.length - 1, daysBetween(days[0]!, over.last)) : -1;
  // Folded as a month's week is: a day with more than fits gives its last
  // row to "+N", any other day keeps all its rows (design D186).
  const { shown, more } = collapsed
    ? foldWeek(layout.strip, STRIP_ROWS)
    : { shown: layout.strip, more: [] };
  const rows = collapsed ? STRIP_ROWS : layout.rows;
  return (
    <div
      role="list"
      aria-label={t("grid.allDay")}
      onPointerDown={press}
      onClick={createAt}
      className={`grid gap-y-0.5 ${collapsed ? "" : "max-h-[40vh] touch-pan-y overflow-y-auto"}`}
      style={{
        gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
        // `repeat(0, …)` is no value: the strip would keep the rows it had.
        gridTemplateRows: rows === 0 ? "none" : `repeat(${rows}, 24px)`,
        // One row's height when empty, so a tap finds it (design D188).
        minHeight: rows === 0 ? 24 : undefined,
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
      {more.map(({ index, count }) => (
        <div
          key={index}
          role="listitem"
          className="px-[1.5px]"
          style={{ gridColumn: index + 1, gridRow: STRIP_ROWS }}
        >
          <button
            type="button"
            aria-label={t("grid.moreLabel", { count, day: formats.fullDate(days[index]!) })}
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
