// The app shell around the views (design D46): the top bar, the drawer (a
// sidebar on a wide screen), the view and the floating "+" button. The view
// reads the local store only and follows its changes (docs/plans/foundation.md#D5).
import type { Account, Calendar, Store, UndoneTask } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { addDays } from "../calendar/dates.ts";
import { Formats } from "../calendar/format.ts";
import { liveQuery } from "../calendar/live.ts";
import type { LocaleSettings } from "../calendar/locale.ts";
import { layoutMonth } from "../calendar/month.ts";
import { layoutRange, ObjectCache, type Entry } from "../calendar/query.ts";
import {
  isView,
  periodOf,
  stepAnchor,
  titleRange,
  VIEW_KEYS,
  type View,
} from "../calendar/views.ts";
import { useEntries, useMediaQuery, useNow } from "../hooks.ts";
import { KEYS, readHidden, usePreference, type Preferences } from "../preferences.ts";
import { AgendaView } from "./agenda-view.tsx";
import { CalendarContext } from "./context.ts";
import { DrawerContent } from "./drawer.tsx";
import { ChevronIcon, MenuIcon, PlusIcon, TodayIcon } from "./icons.tsx";
import { MonthPicker } from "./month-picker.tsx";
import { MonthView } from "./month-view.tsx";
import { TimeGrid } from "./time-grid.tsx";

/** A calendar without a colour of its own (design D47). */
const DEFAULT_COLOR = "#7c8db5";

const validColor = (color: string | null | undefined) =>
  color && CSS.supports("color", color) ? color : null;

const iconButton =
  "grid size-10 shrink-0 place-items-center rounded-full text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent";

export function CalendarScreen({
  store,
  preferences,
  settings,
  timeZone,
}: {
  store: Store;
  preferences: Preferences;
  settings: LocaleSettings;
  timeZone: string;
}) {
  const { t } = useTranslation();
  const [formats] = useState(() => new Formats(settings));
  const { today, minutes } = useNow(timeZone);
  const wide = useMediaQuery("(min-width: 1024px)");

  const [view, setView] = usePreference<View>(
    preferences,
    KEYS.view,
    (stored) => (isView(stored) ? stored : "week"),
    (value) => value,
  );
  const [hidden, setHidden] = usePreference(preferences, KEYS.hiddenCalendars, readHidden, (ids) =>
    JSON.stringify([...ids]),
  );
  const [anchor, setAnchor] = useState(today);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const days = periodOf(view, anchor, settings.weekStart);
  const from = days[0]!;
  const to = addDays(days.at(-1)!, 1);

  const [lists, setLists] = useState<{ accounts: Account[]; calendars: Calendar[] } | null>(null);
  useEffect(
    () =>
      liveQuery(
        store,
        async () => ({ accounts: await store.accounts(), calendars: await store.calendars() }),
        setLists,
      ),
    [store],
  );
  const ids = lists
    ? lists.calendars.filter((calendar) => !hidden.has(calendar.id)).map((calendar) => calendar.id)
    : null;

  // One cache for every view, so a switch of views parses nothing again. The
  // Agenda reads its own days as it scrolls; the other views read their period.
  const [cache] = useState(() => new ObjectCache());
  const agenda = view === "agenda";
  const data = useEntries(store, cache, {
    ids,
    from: agenda ? null : from,
    to: agenda ? null : to,
    today,
    timeZone,
  }) ?? { entries: [], undone: [] };

  const calendarColor = new Map(
    (lists?.calendars ?? []).map((calendar) => [
      calendar.id,
      validColor(calendar.color) ?? DEFAULT_COLOR,
    ]),
  );
  const colorOfCalendar = (id: string) => calendarColor.get(id) ?? DEFAULT_COLOR;
  const colorOf = (entry: Entry) =>
    validColor(entry.occurrence.item.color) ?? colorOfCalendar(entry.calendarId);
  const layoutContext = { today, timeZone, undone: data.undone.length };
  const undoneColor = (task: UndoneTask) => colorOfCalendar(task.object.calendarId);

  const go = (direction: 1 | -1) => setAnchor((current) => stepAnchor(view, current, direction));
  const pickView = (next: View) => {
    setView(next);
    setDrawerOpen(false);
  };
  const openDay = (day: string) => {
    setView("day");
    setAnchor(day);
  };

  // Keys on a desktop: n or j for the next period, p or k for the previous,
  // t for today; d, x, w, m and a for the views, as Google Calendar's (design D88).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      // By the key's place, not its letter, so a Russian layout's ь is m.
      const key = event.code.startsWith("Key")
        ? event.code.slice(3).toLowerCase()
        : event.key.toLowerCase();
      if (key === "n" || key === "j") setAnchor((current) => stepAnchor(view, current, 1));
      else if (key === "p" || key === "k") setAnchor((current) => stepAnchor(view, current, -1));
      else if (key === "t") setAnchor(today);
      else if (VIEW_KEYS.has(key)) setView(VIEW_KEYS.get(key)!);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, today, setView]);

  const title = formats.period(...titleRange(view, days, anchor), today.slice(0, 4));
  const drawer = (
    <DrawerContent
      view={view}
      onView={pickView}
      accounts={lists?.accounts ?? []}
      calendars={lists?.calendars ?? []}
      hidden={hidden}
      onToggle={(id, shown) => {
        const next = new Set(hidden);
        if (shown) next.delete(id);
        else next.add(id);
        setHidden(next);
      }}
      colorOf={(calendar) => colorOfCalendar(calendar.id)}
    />
  );

  return (
    <CalendarContext.Provider value={{ formats, timeZone, colorOf }}>
      <Dialog.Root open={!wide && drawerOpen} onOpenChange={setDrawerOpen}>
        <div className="isolate flex h-dvh flex-col bg-canvas text-ink [--gutter:3.25rem] lg:[--gutter:4rem]">
          <header className="flex h-14 shrink-0 items-center gap-1 px-1.5">
            {wide ? (
              <button
                type="button"
                className={iconButton}
                aria-label={t("topBar.menu")}
                aria-expanded={sidebarOpen}
                onClick={() => setSidebarOpen(!sidebarOpen)}
              >
                <MenuIcon />
              </button>
            ) : (
              <Dialog.Trigger className={iconButton} aria-label={t("topBar.menu")}>
                <MenuIcon />
              </Dialog.Trigger>
            )}
            <MonthPicker
              title={title}
              anchor={anchor}
              today={today}
              weekStart={settings.weekStart}
              onPick={setAnchor}
            />
            <div className="flex-1" />
            {wide && (
              <>
                <button
                  type="button"
                  className={iconButton}
                  aria-label={t(`nav.previous.${view}`)}
                  onClick={() => go(-1)}
                >
                  <ChevronIcon direction="left" />
                </button>
                <button
                  type="button"
                  className={iconButton}
                  aria-label={t(`nav.next.${view}`)}
                  onClick={() => go(1)}
                >
                  <ChevronIcon direction="right" />
                </button>
              </>
            )}
            <button
              type="button"
              className={iconButton}
              aria-label={t("topBar.today")}
              title={t("topBar.today")}
              onClick={() => setAnchor(today)}
            >
              <TodayIcon day={formats.dayNumber(today)} />
            </button>
          </header>
          <div className="flex min-h-0 flex-1">
            {wide && sidebarOpen && (
              <nav aria-label={t("topBar.menu")} className="w-64 shrink-0 overflow-y-auto">
                {drawer}
              </nav>
            )}
            <main aria-label={title} className="relative flex min-w-0 flex-1 flex-col">
              {view === "agenda" ? (
                <AgendaView
                  store={store}
                  cache={cache}
                  ids={ids}
                  anchor={anchor}
                  today={today}
                  undoneColor={undoneColor}
                  onVisibleDay={setAnchor}
                />
              ) : view === "month" ? (
                <MonthView
                  month={titleRange(view, days, anchor)[0]}
                  weeks={layoutMonth(data.entries, days, layoutContext)}
                  today={today}
                  undone={data.undone}
                  undoneColor={undoneColor}
                  onOpenDay={openDay}
                  onSwipe={go}
                />
              ) : (
                <TimeGrid
                  days={days}
                  layout={layoutRange(data.entries, days, layoutContext)}
                  today={today}
                  minutes={minutes}
                  undone={data.undone}
                  undoneColor={undoneColor}
                  expanded={expanded}
                  onExpandedChange={setExpanded}
                  onSwipe={go}
                />
              )}
              {/* Creating items is PR 6 (docs/plans/foundation.md#pr-6--editing). */}
              <button
                type="button"
                disabled
                aria-label={t("fab.create")}
                className="absolute right-4 bottom-4 z-[70] grid size-14 place-items-center rounded-2xl bg-fab text-on-fab shadow-lg shadow-black/30"
              >
                <PlusIcon className="size-7" />
              </button>
            </main>
          </div>
        </div>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-[80] bg-black/45 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <Dialog.Popup className="fixed inset-y-0 left-0 z-[90] w-[min(20rem,85vw)] overflow-y-auto rounded-r-2xl bg-raised text-ink shadow-2xl transition-transform duration-200 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full">
            <Dialog.Title className="sr-only">{t("topBar.menu")}</Dialog.Title>
            <nav aria-label={t("topBar.menu")}>{drawer}</nav>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </CalendarContext.Provider>
  );
}
