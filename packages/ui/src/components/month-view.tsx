// The Month view (design D49, D86): the week numbers in a pill column, each
// day a tile with its number and its items as one-line chips, a span over
// the week's days for an item over several; as many rows as the tiles fit,
// then "+N". A day, or its "+N", opens in the Day view; an item, its details.
// With no mouse or pen, a tap anywhere on a day opens it, its items too, as
// Google's Android app does: the day is the target, not a 16 px chip
// (design D86, D119). An item drags to another day, keeping its time
// (design D111).
import { dayRange, isAllDay } from "@astrotime/core";
import type { UndoneTask } from "@astrotime/storage";
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { weekdayOf } from "../calendar/dates.ts";
import { foldWeek, type MonthWeek } from "../calendar/month.ts";
import type { StripSpan } from "../calendar/query.ts";
import { useMediaQuery, useSwipe } from "../hooks.ts";
import { useCalendar } from "./context.ts";
import { DragContext, useDrag, type DragSurface, type Ghost } from "./drag.tsx";
import { GhostChip, StripChip } from "./items.tsx";
import { UndoneChip } from "./undone-chip.tsx";

/** Pixels: the day's number above its chips, one row of chips, the gap between tiles. */
const NUMBER = 26;
const ROW = 17;
const GAP = 3;

const columns: CSSProperties = {
  gridTemplateColumns: "var(--weeks) repeat(7, minmax(0, 1fr))",
  gap: GAP,
};

export interface MonthViewProps {
  /** The first day of the month shown. */
  readonly month: string;
  readonly weeks: readonly MonthWeek[];
  readonly today: string;
  readonly undone: readonly UndoneTask[];
  readonly undoneColor: (task: UndoneTask) => string;
  readonly onOpenDay: (day: string) => void;
  readonly onSwipe: (direction: 1 | -1) => void;
}

export function MonthView(props: MonthViewProps) {
  const { weeks, today, onSwipe } = props;
  const { formats } = useCalendar();
  const swipe = useSwipe(onSwipe);
  const body = useRef<HTMLDivElement>(null);
  const [capacity, setCapacity] = useState<number | null>(null);
  // How many rows of chips a tile fits: every tile is as tall, so the
  // month's body is measured once, and again only when its size changes.
  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const measure = () => {
      const tile = (element.clientHeight - GAP * (weeks.length - 1)) / weeks.length;
      setCapacity(Math.floor((tile - NUMBER - 2) / ROW));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [weeks.length]);

  const root = useRef<HTMLDivElement>(null);
  const tiles = useRef(new Map<string, HTMLElement>());
  // The day under a point: the tile it is on, or the nearest.
  const surface: DragSurface = {
    spotAt(x, y) {
      let best: { day: string; distance: number } | null = null;
      for (const [day, tile] of tiles.current) {
        const rect = tile.getBoundingClientRect();
        const dx = Math.max(rect.left - x, 0, x - rect.right);
        const dy = Math.max(rect.top - y, 0, y - rect.bottom);
        const distance = Math.hypot(dx, dy);
        if (!best || distance < best.distance) best = { day, distance };
      }
      return best && { day: best.day, minutes: null };
    },
    scroller: () => null,
  };
  const find = (key: string) => {
    for (const week of weeks) {
      const found = week.spans.find(({ entry }) => entry?.key === key);
      if (found?.entry) return found.entry;
    }
    return undefined;
  };
  const drag = useDrag({ surface, root, find });
  const tile = (day: string) => (element: HTMLElement | null) => {
    if (element) tiles.current.set(day, element);
    else tiles.current.delete(day);
  };

  const todayShown = weeks.some((week) => week.days.includes(today));
  return (
    <DragContext.Provider value={drag.value}>
      <div
        ref={root}
        data-view="month"
        className="flex min-h-0 flex-1 touch-pan-y flex-col px-1.5 pb-1.5 [--weeks:1.75rem] lg:[--weeks:2.25rem]"
        {...swipe}
      >
        <div aria-hidden="true" className="grid shrink-0 pb-1" style={columns}>
          <span />
          {weeks[0]?.days.map((day) => (
            <span
              key={day}
              className={`text-center text-[11.5px] ${
                todayShown && weekdayOf(day) === weekdayOf(today)
                  ? "font-semibold text-accent"
                  : "text-ink-muted"
              }`}
            >
              {formats.weekday(day)}
            </span>
          ))}
        </div>
        <div
          ref={body}
          className="grid min-h-0 flex-1"
          style={{ gridTemplateRows: `repeat(${weeks.length}, minmax(0, 1fr))`, gap: GAP }}
        >
          {capacity !== null &&
            weeks.map((week) => (
              <Week
                key={week.days[0]}
                {...props}
                week={week}
                capacity={capacity}
                ghost={drag.ghost}
                tile={tile}
              />
            ))}
        </div>
        {drag.overlay}
      </div>
    </DragContext.Provider>
  );
}

function Week({
  week,
  capacity,
  ghost,
  tile,
  ...props
}: MonthViewProps & {
  week: MonthWeek;
  capacity: number;
  ghost: Ghost | null;
  tile: (day: string) => (element: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const { formats, timeZone, colorOf } = useCalendar();
  const { shown, more } = foldWeek(week.spans, capacity);
  const number = formats.weekNumber(week.days);
  // A drag's ghost over the days of this week it goes to, on the first row.
  const over = ghost?.kind === "item" ? dayRange(ghost.occurrence, timeZone) : null;
  const covered = over
    ? week.days.flatMap((day, i) => (over.first <= day && day <= over.last ? [i] : []))
    : [];
  return (
    <div className="grid min-h-0" style={columns}>
      <div
        className="flex justify-center rounded-full bg-pill pt-1.5 text-xs font-medium text-ink-muted tabular-nums"
        style={{ gridColumn: 1, gridRow: 1 }}
      >
        <span aria-hidden="true">{number}</span>
        <span className="sr-only">{t("grid.week", { number })}</span>
      </div>
      {week.days.map((day, index) => (
        <DayTile
          key={day}
          {...props}
          day={day}
          spans={shown.filter(({ span }) => span.firstDay === index)}
          count={week.spans.reduce(
            (sum, { span, entry }) =>
              span.firstDay <= index && index <= span.lastDay
                ? sum + (entry ? 1 : props.undone.length)
                : sum,
            0,
          )}
          more={more.find((m) => m.index === index)?.count ?? 0}
          moreRow={Math.max(1, capacity) - 1}
          column={index + 2}
          tile={tile(day)}
        />
      ))}
      {ghost?.kind === "item" && covered.length > 0 && (
        <div
          className="pointer-events-none relative z-[3] min-w-0 self-start px-[1.5px]"
          style={{
            gridColumn: `${covered[0]! + 2} / ${covered.at(-1)! + 3}`,
            gridRow: 1,
            marginTop: NUMBER,
            height: ROW - 1,
          }}
        >
          <GhostChip
            color={colorOf(ghost.entry)}
            title={ghost.entry.occurrence.item.summary?.trim() || t("item.untitled")}
            dense
          />
        </div>
      )}
    </div>
  );
}

function DayTile({
  day,
  spans,
  count,
  more,
  moreRow,
  month,
  today,
  undone,
  undoneColor,
  onOpenDay,
  column,
  tile,
}: MonthViewProps & {
  /** Its column in the week's grid, placed so a drag's ghost over it moves no tile. */
  column: number;
  tile: (element: HTMLElement | null) => void;
  day: string;
  /** The spans that start on this day (or, continued, at the week's start). */
  spans: readonly StripSpan[];
  /** How many items the day has, the undone tasks on today among them. */
  count: number;
  /** How many items "+N" stands for; 0 for none. */
  more: number;
  moreRow: number;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  // With no mouse or pen a tap on a chip opens the day under it: the chips
  // are no buttons. A device with one keeps them, a touch laptop too.
  const touch = !useMediaQuery("(any-pointer: fine)");
  const outside = day.slice(0, 7) !== month.slice(0, 7);
  const isToday = day === today;
  const name = formats.fullDate(day);

  // A tap on the tile opens its day. Buttons act on their own: the number,
  // and with a mouse "+N", the undone chip and every item, which opens its details.
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !event.currentTarget.contains(target) || target.closest("button")) return;
    onOpenDay(day);
  };

  return (
    <div
      ref={tile}
      style={{ gridColumn: column, gridRow: 1 }}
      className={`relative min-w-0 cursor-pointer rounded-[8px] ${outside ? "bg-tile/50" : "bg-tile"}`}
      data-outside={outside || undefined}
      onClick={onClick}
    >
      <div className="flex justify-center pt-px">
        <button
          type="button"
          // The day and how many items it has: a screen reader's way to them
          // on a touch screen, where the chips are no buttons (design D86).
          aria-label={count > 0 ? t("month.day", { day: name, count }) : name}
          aria-current={isToday ? "date" : undefined}
          onClick={() => onOpenDay(day)}
          className={[
            "flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[13px] leading-none tabular-nums focus-visible:outline-2 focus-visible:outline-accent",
            isToday
              ? "bg-accent font-semibold text-on-accent"
              : outside
                ? "text-ink-muted hover:bg-raised"
                : "text-ink hover:bg-raised",
          ].join(" ")}
        >
          {formats.dayNumber(day)}
        </button>
      </div>
      <div role="list" aria-label={name} className="absolute inset-x-0" style={{ top: NUMBER }}>
        {spans.map(({ span, entry }) => {
          const length = span.lastDay - span.firstDay + 1;
          return (
            <div
              key={entry?.key ?? "undone"}
              // Only places the item: the listitem inside belongs to the list.
              role="none"
              className="absolute left-0 z-[1] px-[1.5px]"
              style={{
                top: span.row * ROW,
                height: ROW - 1,
                width: `calc(${length * 100}% + ${(length - 1) * GAP}px)`,
              }}
            >
              {entry ? (
                <StripChip
                  entry={entry}
                  allDay={isAllDay(entry.occurrence, timeZone)}
                  continuesBefore={span.continuesBefore}
                  continuesAfter={span.continuesAfter}
                  dense
                  opens={!touch}
                />
              ) : (
                <div role="listitem" className="h-full">
                  <UndoneChip tasks={undone} colorOf={undoneColor} dense opens={!touch} />
                </div>
              )}
            </div>
          );
        })}
        {more > 0 && (
          <div
            role="listitem"
            aria-label={touch ? t("month.more", { count: more, day: name }) : undefined}
            className="absolute inset-x-0 z-[1] px-[1.5px]"
            style={{ top: moreRow * ROW, height: ROW - 1 }}
          >
            {touch ? (
              // Drawn where the button is: its text centred, on the line's baseline.
              <span className={`inline-flex items-center leading-none ${moreClass}`}>
                {t("grid.more", { count: more })}
              </span>
            ) : (
              <button
                type="button"
                aria-label={t("month.more", { count: more, day: name })}
                onClick={() => onOpenDay(day)}
                className={`leading-none ${moreClass} -outline-offset-2 hover:bg-raised`}
              >
                {t("grid.more", { count: more })}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const moreClass =
  "h-full w-full overflow-hidden rounded-[4px] px-1 text-left text-[11px] font-medium whitespace-nowrap text-ink-muted";
