// The Agenda (design D87): the days with something on them, in time order,
// each with its items. It opens at the anchor (today, unless the user moved),
// reads a few weeks around it and more as the list nears either end, never
// the whole calendar; the top bar follows the day at the top of the list.
import type { Store, UndoneTask } from "@astrotime/storage";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { agendaDays } from "../calendar/agenda.ts";
import { addDays } from "../calendar/dates.ts";
import type { ObjectCache } from "../calendar/query.ts";
import { useEntries } from "../hooks.ts";
import { useCalendar } from "./context.ts";
import { AgendaCard } from "./items.tsx";
import { DayHeader } from "./time-grid.tsx";
import { UndoneChip } from "./undone-chip.tsx";

/** Days read before the day the list opens at, and again each time it nears its start. */
const BACK = 28;
/** Days read after it, and again each time the list nears its end. */
const AHEAD = 56;
/** How far from where it opened the list reads on its own; the buttons at its ends go further. */
const REACH = 365;

interface Loaded {
  readonly from: string;
  readonly to: string;
  /** The list reads earlier days by itself only down to `floor`, later ones up to `ceiling`. */
  readonly floor: string;
  readonly ceiling: string;
}

const around = (day: string): Loaded => ({
  from: addDays(day, -BACK),
  to: addDays(day, AHEAD),
  floor: addDays(day, -REACH),
  ceiling: addDays(day, REACH),
});

/** Within a screen of the end. */
const nearEnd = (element: HTMLElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight < element.clientHeight;

const groupsOf = (element: HTMLElement) => [...element.querySelectorAll<HTMLElement>("[data-day]")];

/** The last group whose top is at or above the top of the screen (the groups are in order). */
function groupAtTop(groups: readonly HTMLElement[], scrollTop: number): HTMLElement | undefined {
  let low = 0;
  let high = groups.length - 1;
  let found = groups[0];
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (groups[middle]!.offsetTop <= scrollTop + 1) {
      found = groups[middle];
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

export interface AgendaViewProps {
  readonly store: Store;
  readonly cache: ObjectCache;
  /** The visible calendars, or null while they are read. */
  readonly ids: readonly string[] | null;
  readonly anchor: string;
  readonly today: string;
  readonly undoneColor: (task: UndoneTask) => string;
  /** The day at the top of the list changed as the user scrolled. */
  readonly onVisibleDay: (day: string) => void;
}

export function AgendaView({
  store,
  cache,
  ids,
  anchor,
  today,
  undoneColor,
  onVisibleDay,
}: AgendaViewProps) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const [range, setRange] = useState(() => around(anchor));
  const data = useEntries(store, cache, { ids, from: range.from, to: range.to, today, timeZone });
  const loaded = data !== null && data.from === range.from && data.to === range.to;
  const days = useMemo(
    () =>
      data
        ? agendaDays(data.entries, data.from, data.to, {
            today,
            timeZone,
            undone: data.undone.length,
          })
        : [],
    [data, today, timeZone],
  );

  const scroller = useRef<HTMLDivElement>(null);
  /** The group at the top of the screen and how far the list is scrolled past its top. */
  const top = useRef<{ day: string; offset: number } | null>(null);
  /** The day last reported as the one on top. */
  const reported = useRef<string | null>(null);
  /** Where the list itself last scrolled to, so that scroll reads nothing more. */
  const own = useRef<number | null>(null);
  /** A day to bring to the top of the list once it is read. */
  const [jump, setJump] = useState<string | null>(anchor);

  // A day picked elsewhere (today, the month picker, previous or next): the
  // list goes there, and reads the days around it if it does not hold them.
  useEffect(() => {
    if (anchor === reported.current) return;
    setJump(anchor);
    setRange((current) =>
      anchor < current.from || anchor >= current.to ? around(anchor) : current,
    );
  }, [anchor]);

  const scrollTo = (element: HTMLElement, scrollTop: number) => {
    element.scrollTop = scrollTop;
    own.current = element.scrollTop;
  };

  // After the days change: go to the day asked for, or keep the group on top
  // where it was (days read before it would push it down). Then, while the
  // list ends within a screen, read further.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !loaded) return;
    const groups = groupsOf(element);
    if (jump !== null) {
      const target = groups.find((group) => group.dataset["day"]! >= jump);
      scrollTo(element, target ? target.offsetTop : element.scrollHeight);
      if (target) {
        top.current = { day: target.dataset["day"]!, offset: element.scrollTop - target.offsetTop };
      }
      // Too near the end to come to the top: again once more is read.
      const short = target && element.scrollTop + 1 < target.offsetTop;
      if (!short || range.to >= range.ceiling) setJump(null);
    } else if (top.current) {
      const kept = top.current;
      const group = groups.find((g) => g.dataset["day"] === kept.day);
      if (group) scrollTo(element, group.offsetTop + kept.offset);
    }
    if (nearEnd(element) && range.to < range.ceiling) {
      setRange((current) => ({ ...current, to: addDays(current.to, AHEAD) }));
    }
  }, [days, jump, loaded, range]);

  const onScroll = () => {
    const element = scroller.current!;
    const group = groupAtTop(groupsOf(element), element.scrollTop);
    if (group && jump === null) {
      const day = group.dataset["day"]!;
      top.current = { day, offset: element.scrollTop - group.offsetTop };
      if (day !== reported.current) {
        reported.current = day;
        onVisibleDay(day);
      }
    }
    const itself = own.current !== null && Math.abs(element.scrollTop - own.current) < 2;
    own.current = null;
    if (itself || !loaded) return;
    if (element.scrollTop < element.clientHeight && range.from > range.floor) {
      setRange((current) => ({ ...current, from: addDays(current.from, -BACK) }));
    } else if (nearEnd(element) && range.to < range.ceiling) {
      setRange((current) => ({ ...current, to: addDays(current.to, AHEAD) }));
    }
  };

  const earlier = () =>
    setRange((current) => {
      const from = addDays(current.from, -BACK);
      return { ...current, from, floor: addDays(from, -REACH) };
    });
  const later = () =>
    setRange((current) => {
      const to = addDays(current.to, AHEAD);
      return { ...current, to, ceiling: addDays(to, REACH) };
    });

  const year = today.slice(0, 4);
  const endButton =
    "mx-auto block rounded-full px-4 py-2 text-[13px] text-ink-muted hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none] [scrollbar-gutter:stable] [--gutter:3.25rem] lg:[--gutter:4rem]"
    >
      <div className="pt-1 pb-24">
        <button type="button" onClick={earlier} className={endButton}>
          {t("agenda.earlier")}
        </button>
        {days.map(({ day, items, undone }, index) => {
          const newMonth = index === 0 || days[index - 1]!.day.slice(0, 7) !== day.slice(0, 7);
          return (
            <div key={day}>
              {newMonth && (
                <h2 className="px-4 pt-4 pb-1 text-[15px] font-medium">
                  {formats.period(day, day, year)}
                </h2>
              )}
              <section data-day={day} className="flex gap-1 py-1 pr-2">
                <div className="sticky top-0 w-[var(--gutter)] shrink-0 self-start">
                  <DayHeader day={day} today={today} level={3} />
                </div>
                <div
                  role="list"
                  aria-label={formats.fullDate(day)}
                  className="flex min-w-0 flex-1 flex-col gap-1 pt-1"
                >
                  {undone && data && (
                    <div role="listitem" className="h-8">
                      <UndoneChip tasks={data.undone} colorOf={undoneColor} />
                    </div>
                  )}
                  {items.map((item) => (
                    <AgendaCard key={item.entry.key} {...item} />
                  ))}
                  {items.length === 0 && !undone && (
                    <p
                      role="listitem"
                      className="flex min-h-11 items-center text-sm text-ink-muted"
                    >
                      {t("agenda.nothingToday")}
                    </p>
                  )}
                </div>
              </section>
            </div>
          );
        })}
        <button type="button" onClick={later} className={`${endButton} mt-2`}>
          {t("agenda.later")}
        </button>
      </div>
    </div>
  );
}
