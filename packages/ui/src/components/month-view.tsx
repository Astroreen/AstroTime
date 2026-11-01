// The Month view (design D49, D86): the week numbers in a pill column, each
// day a tile with its number and its items as one-line chips, a span over
// the week's days for an item over several; as many rows as the tiles fit,
// then "+N". A day, or its "+N", opens in the Day view; an item, its details.
import { isAllDay } from "@astrotime/core";
import type { UndoneTask } from "@astrotime/storage";
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { weekdayOf } from "../calendar/dates.ts";
import { foldWeek, type MonthWeek } from "../calendar/month.ts";
import type { StripSpan } from "../calendar/query.ts";
import { useSwipe } from "../hooks.ts";
import { useCalendar } from "./context.ts";
import { StripChip } from "./items.tsx";
import { UndoneChip } from "./undone-chip.tsx";

/** Pixels: the day's number above its chips, one row of chips, the gap between tiles. */
const NUMBER = 25;
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

  const todayShown = weeks.some((week) => week.days.includes(today));
  return (
    <div
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
            <Week key={week.days[0]} {...props} week={week} capacity={capacity} />
          ))}
      </div>
    </div>
  );
}

function Week({
  week,
  capacity,
  ...props
}: MonthViewProps & { week: MonthWeek; capacity: number }) {
  const { t } = useTranslation();
  const { formats } = useCalendar();
  const { shown, more } = foldWeek(week.spans, capacity);
  const number = formats.weekNumber(week.days);
  return (
    <div className="grid min-h-0" style={columns}>
      <div className="flex justify-center rounded-full bg-pill pt-1.5 text-xs font-medium text-ink-muted tabular-nums">
        <span aria-hidden="true">{number}</span>
        <span className="sr-only">{t("grid.week", { number })}</span>
      </div>
      {week.days.map((day, index) => (
        <DayTile
          key={day}
          {...props}
          day={day}
          spans={shown.filter(({ span }) => span.firstDay === index)}
          more={more.find((m) => m.index === index)?.count ?? 0}
          moreRow={Math.max(1, capacity) - 1}
        />
      ))}
    </div>
  );
}

function DayTile({
  day,
  spans,
  more,
  moreRow,
  month,
  today,
  undone,
  undoneColor,
  onOpenDay,
}: MonthViewProps & {
  day: string;
  /** The spans that start on this day (or, continued, at the week's start). */
  spans: readonly StripSpan[];
  /** How many items "+N" stands for; 0 for none. */
  more: number;
  moreRow: number;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const outside = day.slice(0, 7) !== month.slice(0, 7);
  const isToday = day === today;
  const name = formats.fullDate(day);

  // A tap on the tile opens its day. Buttons act on their own: the number,
  // "+N", the undone chip, and every item, which opens its details (PR 6).
  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !event.currentTarget.contains(target) || target.closest("button")) return;
    onOpenDay(day);
  };

  return (
    <div
      className={`relative min-w-0 cursor-pointer rounded-[8px] ${outside ? "bg-tile/50" : "bg-tile"}`}
      data-outside={outside || undefined}
      onClick={onClick}
    >
      <div className="flex justify-center pt-[3px]">
        <button
          type="button"
          aria-label={name}
          aria-current={isToday ? "date" : undefined}
          onClick={() => onOpenDay(day)}
          className={[
            "flex h-[19px] min-w-[19px] items-center justify-center rounded-full px-1.5 text-[13px] leading-none tabular-nums focus-visible:outline-2 focus-visible:outline-accent",
            isToday
              ? "bg-accent font-semibold text-on-accent"
              : outside
                ? "text-ink-muted/70 hover:bg-raised"
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
                />
              ) : (
                <div role="listitem" className="h-full">
                  <UndoneChip tasks={undone} colorOf={undoneColor} dense />
                </div>
              )}
            </div>
          );
        })}
        {more > 0 && (
          <div
            role="listitem"
            className="absolute inset-x-0 z-[1] px-[1.5px]"
            style={{ top: moreRow * ROW, height: ROW - 1 }}
          >
            <button
              type="button"
              aria-label={t("month.more", { count: more, day: name })}
              onClick={() => onOpenDay(day)}
              className="h-full w-full overflow-hidden rounded-[4px] px-1 text-left text-[11px] leading-none font-medium whitespace-nowrap text-ink-muted hover:bg-raised"
            >
              {t("grid.more", { count: more })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
