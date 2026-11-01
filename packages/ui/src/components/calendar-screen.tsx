// The app shell around the views (design D46): the top bar with the account
// button, the drawer (a sidebar on a wide screen), the view and the floating
// "+" button; search and the tasks screen open from the top bar (D52, D53);
// the first-run screen while there is no account. The view reads the local
// store only and follows its changes (docs/plans/foundation.md#D5).
import { CalendarObject, wallClockOf, type ScheduledReminder } from "@astrotime/core";
import type { Account, Calendar, Store, UndoneTask } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { addDays } from "../calendar/dates.ts";
import { itemOf } from "../calendar/editing.ts";
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
import { useEntries, useMediaQuery, useNow, type Entries } from "../hooks.ts";
import { KEYS, readHidden, usePreference, type Preferences } from "../preferences.ts";
import { useSettings } from "../settings.ts";
import { AccountButton, FirstRun } from "./accounts.tsx";
import { useAccounts } from "./accounts-context.tsx";
import { AgendaView } from "./agenda-view.tsx";
import { CalendarContext } from "./context.ts";
import { DrawerContent } from "./drawer.tsx";
import { EditingContext, targetOf, useEditingState } from "./editing.tsx";
import {
  CheckCircleIcon,
  ChevronIcon,
  MenuIcon,
  PlusIcon,
  SearchIcon,
  TodayIcon,
} from "./icons.tsx";
import { MonthPicker } from "./month-picker.tsx";
import { MonthView } from "./month-view.tsx";
import { useReminders } from "./reminders-context.tsx";
import { SearchBar, SearchResults, type SearchResult } from "./search.tsx";
import { TasksScreen, type TaskFocus } from "./tasks-screen.tsx";
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
  // Made again when the settings change the language, week or clock (D53).
  const formats = useMemo(() => new Formats(settings), [settings]);
  const { today, minutes } = useNow(timeZone);
  const wide = useMediaQuery("(min-width: 1024px)");
  const { hideCompleted } = useSettings().settings;

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
  // A tab left open overnight: an anchor on today moves on to the new today.
  const [seenToday, setSeenToday] = useState(today);
  if (seenToday !== today) {
    setSeenToday(today);
    if (anchor === seenToday) setAnchor(today);
  }
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [taskFocus, setTaskFocus] = useState<TaskFocus | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  // The item a search jumped to, marked while its day is the one jumped to.
  const [found, setFound] = useState<{ objectId: string; anchor: string } | null>(null);
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
  const read = useEntries(store, cache, {
    ids,
    from: agenda ? null : from,
    to: agenda ? null : to,
    today,
    timeZone,
  });
  // A period is drawn once its items are read, so none arrive under a press:
  // the strip's rows would push the time grid down (design D59). Until then
  // the view keeps the period it draws, or on open (and after the Agenda,
  // which reads its own) draws none.
  const fresh = !agenda && read !== null && read.from === from && read.to === to;
  const [held, setHeld] = useState<Drawn | null>(null);
  if (fresh && (held?.read !== read || held.view !== view || held.anchor !== anchor)) {
    setHeld({ view, days, anchor, read });
  } else if (agenda && held) setHeld(null);
  const drawn = fresh ? { view, days, anchor, read } : held;
  const data = drawn?.read ?? { entries: [], undone: [] };

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
  // "Hide completed" hides completed tasks' chips on every view, not the undone chip (D51).
  const entries = hideCompleted ? data.entries.filter((entry) => !entry.done) : data.entries;
  const foundId = found?.anchor === anchor ? found.objectId : null;

  // A search's item is scrolled to once it is drawn.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!foundId || scrolledTo.current === `${foundId}/${anchor}`) return;
    const element = document.querySelector("main [data-found]");
    if (!element) return;
    element.scrollIntoView({ block: "center" });
    scrolledTo.current = `${foundId}/${anchor}`;
  });

  const taskLists = (lists?.calendars ?? []).filter((calendar) =>
    calendar.components.includes("VTODO"),
  );
  const { platform, scheduler } = useAccounts();
  const editing = useEditingState({
    store,
    calendars: lists?.calendars ?? [],
    hidden,
    timeZone,
    minutes,
    colorOf: (target) => validColor(target.item.color) ?? colorOfCalendar(target.calendarId),
    onChanged: () => scheduler.changed(),
  });
  const pick = (result: SearchResult) => {
    setSearching(false);
    setQuery("");
    // A result opens its details, as Google's search does, over the day it moved to.
    editing.value.open(
      targetOf(
        result.stored,
        CalendarObject.parse(result.stored.ics),
        result.occurrence?.recurrenceId ?? null,
        result.occurrence?.item ?? result.item,
      ),
    );
    if (result.occurrence) {
      const day = wallClockOf(result.occurrence.start, timeZone).slice(0, 10);
      setAnchor(day);
      setFound({ objectId: result.stored.id, anchor: day });
      if (!wide) setTasksOpen(false);
    } else {
      // An undated task lives on the tasks screen only (docs/plans/foundation.md#D16).
      setTaskFocus({ calendarId: result.stored.calendarId, objectId: result.stored.id });
      setTasksOpen(true);
    }
  };
  // Closed, the tasks screen forgets the task a search asked for.
  const closeTasks = () => {
    setTasksOpen(false);
    setTaskFocus(null);
  };
  const phoneTasks = !wide && tasksOpen;
  const covered = phoneTasks || searching;

  const go = (direction: 1 | -1) => setAnchor((current) => stepAnchor(view, current, direction));
  const pickView = (next: View) => {
    setView(next);
    setDrawerOpen(false);
  };
  const openDay = (day: string) => {
    setView("day");
    setAnchor(day);
  };

  // A tapped reminder opens its occurrence's day in the Day view, and its
  // details over it (foundation D101): an event's start, a task's due or
  // start; one with no time opens only the details.
  const { onOpen } = useReminders();
  const openReminder = useEffectEvent(async (reminder: ScheduledReminder) => {
    const time = reminder.kind === "task" ? (reminder.due ?? reminder.start) : reminder.start;
    setSearching(false);
    setDrawerOpen(false);
    if (!wide) setTasksOpen(false);
    if (time) openDay(wallClockOf(time, timeZone).slice(0, 10));
    const stored = await store.object(reminder.objectId);
    if (!stored || stored.pending === "delete") return;
    const object = CalendarObject.parse(stored.ics);
    const item = itemOf(object, reminder.recurrenceId);
    if (item) editing.value.open(targetOf(stored, object, reminder.recurrenceId, item));
  });
  useEffect(() => onOpen((reminder) => void openReminder(reminder)), [onOpen]);

  // The system's back button, where there is one (android D68): it closes
  // what is open, the topmost first, and with nothing open the shell leaves
  // the app. A dialog, the drawer, a menu or a popover closes as Escape
  // closes it (Base UI marks the key used); then search, then the tasks screen.
  const back = useEffectEvent((): boolean => {
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    (document.activeElement ?? document.body).dispatchEvent(escape);
    if (escape.defaultPrevented) return true;
    if (searching) setSearching(false);
    else if (tasksOpen) closeTasks();
    else return false;
    return true;
  });
  useEffect(() => platform.onBack?.(() => back()), [platform]);

  // Keys on a desktop: n or j for the next period, p or k for the previous,
  // t for today; d, x, w, m and a for the views, as Google Calendar's (design D88).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      // The letter typed on a Latin layout (Dvorak's t is t); on another
      // script the key's place, so a Russian layout's ь is m.
      const typed = event.key.toLowerCase();
      const key =
        /^[a-z]$/.test(typed) || !event.code.startsWith("Key")
          ? typed
          : event.code.slice(3).toLowerCase();
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
      onLeave={() => setDrawerOpen(false)}
    />
  );

  // No account and no demo: the way in (docs/plans/foundation.md#D92).
  if (lists && lists.accounts.length === 0) return <FirstRun />;

  return (
    <CalendarContext.Provider value={{ formats, timeZone, colorOf, found: foundId }}>
      <EditingContext.Provider value={editing.value}>
        <Dialog.Root open={!wide && drawerOpen} onOpenChange={setDrawerOpen}>
          <div className="relative isolate flex h-dvh flex-col bg-canvas pt-(--inset-top) pr-(--inset-right) pb-(--inset-bottom) pl-(--inset-left) text-ink [--gutter:3.25rem] lg:[--gutter:4rem]">
            {searching && (
              <SearchBar query={query} onQuery={setQuery} onClose={() => setSearching(false)} />
            )}
            <header
              hidden={searching}
              inert={phoneTasks}
              aria-hidden={phoneTasks || undefined}
              className="flex h-14 shrink-0 items-center gap-1 px-1.5"
            >
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
                aria-label={t("topBar.search")}
                title={t("topBar.search")}
                onClick={() => setSearching(true)}
              >
                <SearchIcon />
              </button>
              <button
                type="button"
                className={iconButton}
                // Its name says the day its icon shows (WCAG 2.5.3).
                aria-label={t("topBar.todayLabel", { date: formats.fullDate(today) })}
                title={t("topBar.today")}
                onClick={() => setAnchor(today)}
              >
                <TodayIcon day={formats.dayNumber(today)} />
              </button>
              <button
                type="button"
                className={`${iconButton} ${tasksOpen ? "bg-accent-soft" : ""}`}
                aria-label={t("topBar.tasks")}
                title={t("topBar.tasks")}
                aria-pressed={tasksOpen}
                onClick={() => (tasksOpen ? closeTasks() : setTasksOpen(true))}
              >
                <CheckCircleIcon />
              </button>
              <AccountButton accounts={lists?.accounts ?? []} />
            </header>
            <div inert={covered} aria-hidden={covered || undefined} className="flex min-h-0 flex-1">
              {wide && sidebarOpen && (
                <nav aria-label={t("topBar.menu")} className="w-64 shrink-0 overflow-y-auto">
                  {drawer}
                </nav>
              )}
              <main aria-label={title} className="relative flex min-w-0 flex-1 flex-col">
                {/* The period shown, the page's heading; the top bar shows it as the month picker's button. */}
                <h1 className="sr-only">{title}</h1>
                {view === "agenda" ? (
                  <AgendaView
                    store={store}
                    cache={cache}
                    ids={ids}
                    anchor={anchor}
                    today={today}
                    undoneColor={undoneColor}
                    onVisibleDay={setAnchor}
                    hideCompleted={hideCompleted}
                  />
                ) : !drawn ? null : drawn.view === "month" ? (
                  <MonthView
                    month={titleRange(drawn.view, drawn.days, drawn.anchor)[0]}
                    weeks={layoutMonth(entries, drawn.days, layoutContext)}
                    today={today}
                    undone={data.undone}
                    undoneColor={undoneColor}
                    onOpenDay={openDay}
                    onSwipe={go}
                  />
                ) : (
                  <TimeGrid
                    days={drawn.days}
                    layout={layoutRange(entries, drawn.days, layoutContext)}
                    today={today}
                    minutes={minutes}
                    undone={data.undone}
                    undoneColor={undoneColor}
                    expanded={expanded}
                    onExpandedChange={setExpanded}
                    onSwipe={go}
                  />
                )}
                {/* A new event on the day shown, from the next half hour (Google). */}
                <button
                  type="button"
                  disabled={!editing.value.canCreate}
                  aria-label={t("fab.create")}
                  title={t("fab.create")}
                  onClick={() => editing.value.create("event", { day: anchor })}
                  className="absolute right-4 bottom-4 z-[70] grid size-14 place-items-center rounded-2xl bg-fab text-on-fab shadow-lg shadow-black/30"
                >
                  <PlusIcon className="size-7" />
                </button>
              </main>
              {wide && tasksOpen && (
                <aside className="w-[22.5rem] shrink-0 border-l border-line">
                  <TasksScreen
                    store={store}
                    preferences={preferences}
                    lists={taskLists}
                    today={today}
                    now={nowOf(today, minutes)}
                    wide
                    focus={taskFocus}
                    onClose={closeTasks}
                  />
                </aside>
              )}
            </div>
            {searching && (
              <div className="absolute top-[calc(3.5rem+var(--inset-top))] right-(--inset-right) bottom-(--inset-bottom) left-(--inset-left) z-[75] overflow-y-auto bg-canvas">
                <SearchResults
                  store={store}
                  calendarIds={ids ?? []}
                  query={query}
                  today={today}
                  colorOf={(result) =>
                    validColor(result.item.color) ?? colorOfCalendar(result.stored.calendarId)
                  }
                  onPick={pick}
                />
              </div>
            )}
            {phoneTasks && !searching && (
              <div className="absolute top-(--inset-top) right-(--inset-right) bottom-(--inset-bottom) left-(--inset-left) z-[75]">
                <TasksScreen
                  store={store}
                  preferences={preferences}
                  lists={taskLists}
                  today={today}
                  now={nowOf(today, minutes)}
                  wide={false}
                  focus={taskFocus}
                  onClose={closeTasks}
                />
              </div>
            )}
          </div>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-[80] bg-black/45 transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
            <Dialog.Popup className="fixed inset-y-0 left-0 z-[90] w-[min(20rem,85vw)] overflow-y-auto rounded-r-2xl bg-raised pt-(--inset-top) pb-(--inset-bottom) pl-(--inset-left) text-ink shadow-2xl transition-transform duration-200 ease-out data-ending-style:-translate-x-full data-starting-style:-translate-x-full">
              <Dialog.Title className="sr-only">{t("topBar.menu")}</Dialog.Title>
              <nav aria-label={t("topBar.menu")}>{drawer}</nav>
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
        {editing.dialogs}
      </EditingContext.Provider>
    </CalendarContext.Provider>
  );
}

/** A period of the views but the Agenda, as drawn: its view, its days and what was read of them. */
interface Drawn {
  readonly view: View;
  readonly days: readonly string[];
  readonly anchor: string;
  readonly read: Entries;
}

/** The wall clock at `minutes` past midnight of `today`, `2026-11-04T10:40:00`. */
function nowOf(today: string, minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${today}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:00`;
}
