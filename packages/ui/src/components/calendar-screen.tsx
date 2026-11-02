// The app shell around the views (design D46): the top bar with the account
// button, the drawer (a sidebar on a wide screen, headed by Create), the view
// and the floating "+" button where no sidebar holds Create (D132); search
// and the tasks screen open from the top bar (D52, D133), on a wide screen by
// its calendar | tasks switch, the tasks screen then in the view's place
// (D227); Settings from the drawer's foot (D131, D226). The calendar
// shows from the first run, with no account: the calendar on this device
// (docs/plans/foundation.md#D122). The view reads the local
// store only and follows its changes (docs/plans/foundation.md#D5).
import { CalendarObject, wallClockOf, type ScheduledReminder } from "@astrotime/core";
import type { Account, Calendar, Store, UndoneTask } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { addDays } from "../calendar/dates.ts";
import { itemOf } from "../calendar/editing.ts";
import { Formats } from "../calendar/format.ts";
import { shownCalendars } from "../calendar/calendars.ts";
import { liveQuery, whileShown } from "../calendar/live.ts";
import type { LocaleSettings } from "../calendar/locale.ts";
import { layoutMonth, type MonthWeek } from "../calendar/month.ts";
import { layoutRange, ObjectCache, type Entry, type RangeLayout } from "../calendar/query.ts";
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
import { defaultColorOf, useSettings } from "../settings.ts";
import { AccountButton } from "./accounts.tsx";
import { useAccounts } from "./accounts-context.tsx";
import { CalendarContext } from "./context.ts";
import { DrawerContent } from "./drawer.tsx";
import { EditingContext, targetOf, useEditingState } from "./editing.tsx";
import {
  CalendarIcon,
  CheckCircleIcon,
  ChevronIcon,
  MenuIcon,
  PlusIcon,
  SearchIcon,
  TodayIcon,
} from "./icons.tsx";
import { MonthPicker } from "./month-picker.tsx";
import { MonthView } from "./month-view.tsx";
import { Pager, type Page } from "./pager.tsx";
import { useReminders } from "./reminders-context.tsx";
import { SearchBar, SearchResults, type SearchResult } from "./search.tsx";
import { AgendaView, SettingsScreen } from "./lazy.tsx";
import { TasksScreen, type TaskFocus } from "./tasks-screen.tsx";
import { TimeGrid } from "./time-grid.tsx";
import { DialogBackdrop, DialogPopup } from "./dialog-parts.tsx";

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
  const chosen = useSettings().settings;
  const { hideCompleted, weekNumbers } = chosen;

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const days = periodOf(view, anchor, settings.weekStart);
  // On a touch screen the periods before and after are read with this one,
  // so a swipe carries them in beside it and a step to either draws at once
  // (design D154); elsewhere, with no swipe, only the period shown is.
  const coarse = useMediaQuery("(any-pointer: coarse)");
  const before = coarse ? periodOf(view, stepAnchor(view, anchor, -1), settings.weekStart) : days;
  const after = coarse ? periodOf(view, stepAnchor(view, anchor, 1), settings.weekStart) : days;
  const from = before[0]!;
  const to = addDays(after.at(-1)!, 1);

  const [lists, setLists] = useState<{ accounts: Account[]; calendars: Calendar[] } | null>(null);
  // The calendars could not be read: the view reads none, so it is drawn (design D59).
  const [listsFailed, setListsFailed] = useState(false);
  useEffect(
    () =>
      liveQuery(
        whileShown(store),
        async () => {
          const accounts = await store.accounts();
          // Named in the language spoken now (foundation D122).
          const calendars = await shownCalendars(store, t("local.calendar"));
          return { accounts, calendars };
        },
        (result) => {
          setLists(result);
          setListsFailed(false);
        },
        (error) => {
          console.error(error);
          setListsFailed(true);
        },
      ),
    [store, t],
  );
  const ids = lists
    ? lists.calendars.filter((calendar) => !hidden.has(calendar.id)).map((calendar) => calendar.id)
    : listsFailed
      ? []
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
  // which reads its own) draws none. A read that fails comes back empty.
  // The read kept from before the Agenda is not one: the store may have
  // changed meanwhile, and its live query starts again.
  // The undone chip's tasks are a read of their own (foundation D146): a
  // view drawn before keeps its chip too until they are read for its
  // calendars and day, so the chip neither shows a hidden calendar's tasks
  // nor goes and comes back; on open, with nothing drawn yet, the days draw
  // first and the chip joins them.
  const [beforeAgenda, setBeforeAgenda] = useState<Entries | null>(null);
  const [held, setHeld] = useState<Drawn | null>(null);
  // A read holds a period when it covers its days: the read of the period
  // before or after a step holds the new one too (design D154).
  const fresh =
    !agenda &&
    read !== null &&
    read !== beforeAgenda &&
    holds(read, days) &&
    (read.undoneCurrent || held === null);
  if (fresh && (held?.read !== read || held.view !== view || held.anchor !== anchor)) {
    setHeld({ view, days, anchor, read });
  } else if (agenda && (held || beforeAgenda !== read)) {
    setHeld(null);
    setBeforeAgenda(read);
  }
  // A step to a period the read drawn holds lands at once from it, even
  // while a newer read goes on: a swipe's neighbour was drawn from it
  // (design D154), and the step does not snap back to wait.
  const kept =
    !agenda && !fresh && held !== null && held.view === view && holds(held.read, days)
      ? { view, days, anchor, read: held.read }
      : null;
  const drawn = fresh ? { view, days, anchor, read } : (kept ?? held);
  // What the view waits for while it keeps what it drew: its days' read, or
  // its chip's (a data hook the tests wait on).
  const waiting = agenda || fresh ? undefined : read && holds(read, days) ? "chip" : "days";
  const drawnRead = drawn?.read;
  // Drawn before its chip's tasks are read (on open): no chip yet.
  const data = drawnRead
    ? { entries: drawnRead.entries, undone: drawnRead.undoneCurrent ? drawnRead.undone : [] }
    : { entries: [], undone: [] };

  const calendarColor = new Map(
    (lists?.calendars ?? []).map((calendar) => [
      calendar.id,
      validColor(calendar.color) ?? DEFAULT_COLOR,
    ]),
  );
  const colorOfCalendar = (id: string) => calendarColor.get(id) ?? DEFAULT_COLOR;
  const colorOf = (entry: Entry) =>
    validColor(entry.occurrence.item.color) ?? colorOfCalendar(entry.calendarId);
  const undoneColor = (task: UndoneTask) => colorOfCalendar(task.object.calendarId);
  const foundId = found?.anchor === anchor ? found.objectId : null;

  // A search's item is scrolled to once it is drawn.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (!foundId || scrolledTo.current === `${foundId}/${anchor}`) return;
    const element = document.querySelector("main [data-current] [data-found]");
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
    today,
    minutes,
    colorOf: (target) => validColor(target.item.color) ?? colorOfCalendar(target.calendarId),
    defaultColors: {
      event: defaultColorOf(chosen, "event"),
      task: defaultColorOf(chosen, "task"),
    },
    onChanged: () => scheduler.changed(),
  });
  // The period drawn and, on a touch screen, those beside it whose items are
  // read, each laid out once for what it draws (design D154).
  const undoneCount = data.undone.length;
  const draft = editing.draft;
  const drawnView = drawn?.view ?? null;
  const drawnAnchor = drawn?.anchor ?? null;
  const pages = useMemo(() => {
    if (!drawnView || !drawnAnchor || !drawnRead) return null;
    // "Hide completed" hides completed tasks' chips on every view, not the
    // undone chip (D51); the edit dialog's item is drawn as its form says
    // (design D155).
    const shown = hideCompleted
      ? drawnRead.entries.filter((entry) => !entry.done)
      : drawnRead.entries;
    const context = { today, timeZone, undone: undoneCount };
    const page = (pageAnchor: string, pageDays: readonly string[]): Shown => {
      const range = { from: pageDays[0]!, to: addDays(pageDays.at(-1)!, 1), timeZone };
      const entries = draft ? draft.apply(shown, range) : shown;
      return {
        key: `${drawnView}:${pageDays[0]}`,
        days: pageDays,
        anchor: pageAnchor,
        month: titleRange(drawnView, pageDays, pageAnchor)[0],
        layout:
          drawnView === "month"
            ? { view: "month", weeks: layoutMonth(entries, pageDays, context) }
            : { view: "grid", range: layoutRange(entries, pageDays, context) },
      };
    };
    const beside = (direction: 1 | -1) => {
      if (!coarse) return null;
      const besideAnchor = stepAnchor(drawnView, drawnAnchor, direction);
      const besideDays = periodOf(drawnView, besideAnchor, settings.weekStart);
      return holds(drawnRead, besideDays) ? page(besideAnchor, besideDays) : null;
    };
    return {
      current: page(drawnAnchor, periodOf(drawnView, drawnAnchor, settings.weekStart)),
      previous: beside(-1),
      next: beside(1),
    };
  }, [
    drawnView,
    drawnAnchor,
    drawnRead,
    hideCompleted,
    today,
    timeZone,
    undoneCount,
    coarse,
    settings.weekStart,
    draft,
  ]);
  // Where the time grid is scrolled, kept for the next period's and view's grid.
  const gridScroll = useRef<number | null>(null);
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
      setTasksOpen(false);
      setTaskFocus(null);
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
  // On a wide screen the tasks screen takes the view's place (D227).
  const wideTasks = wide && tasksOpen;
  const covered = phoneTasks || searching;

  const go = (direction: 1 | -1) => setAnchor((current) => stepAnchor(view, current, direction));
  const pickView = (next: View) => {
    setView(next);
    setDrawerOpen(false);
    // A view picked in the sidebar is the calendar's (D227).
    closeTasks();
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
    setSettingsOpen(false);
    setTasksOpen(false);
    setTaskFocus(null);
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
      // A dialog's keys are its own: the scope question and a confirmation are alertdialogs.
      if (
        target?.closest(
          "input, textarea, select, [contenteditable], [role=dialog], [role=alertdialog]",
        )
      )
        return;
      // The letter typed on a Latin layout (Dvorak's t is t); on another
      // script the key's place, so a Russian layout's ь is m.
      const typed = event.key.toLowerCase();
      const key =
        /^[a-z]$/.test(typed) || !event.code.startsWith("Key")
          ? typed
          : event.code.slice(3).toLowerCase();
      // With the tasks in the view's place, a step would move a calendar
      // nobody sees (D227): only a view's key, which brings it back, counts.
      if (wideTasks && !VIEW_KEYS.has(key)) return;
      if (key === "n" || key === "j") setAnchor((current) => stepAnchor(view, current, 1));
      else if (key === "p" || key === "k") setAnchor((current) => stepAnchor(view, current, -1));
      else if (key === "t") setAnchor(today);
      else if (VIEW_KEYS.has(key)) {
        setView(VIEW_KEYS.get(key)!);
        // A view's key is the calendar's, as a view picked in the sidebar (D227).
        setTasksOpen(false);
        setTaskFocus(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, today, setView, wideTasks]);

  const title = formats.period(...titleRange(view, days, anchor), today.slice(0, 4));
  // A new event on the day shown, from the next half hour (Google).
  // Over the tasks screen, a task, for today, as the screen's own "Add a task" (D227).
  const create = () =>
    wideTasks
      ? editing.value.create("task", { day: today, allDay: true })
      : editing.value.create("event", { day: anchor });
  // On a wide screen the sidebar's top holds Create, as Google Calendar's web
  // app; with no sidebar the "+" button floats (D132).
  const sidebar = wide && sidebarOpen;
  const toggleCalendar = (id: string, shown: boolean) => {
    const next = new Set(hidden);
    if (shown) next.delete(id);
    else next.add(id);
    setHidden(next);
  };
  const drawer = (
    <DrawerContent
      // No view is the one shown while the tasks take its place (D227).
      view={wideTasks ? null : view}
      onView={pickView}
      accounts={lists?.accounts ?? []}
      calendars={lists?.calendars ?? []}
      hidden={hidden}
      onToggle={toggleCalendar}
      colorOf={(calendar) => colorOfCalendar(calendar.id)}
      onLeave={() => setDrawerOpen(false)}
      onSettings={() => {
        setDrawerOpen(false);
        setSettingsOpen(true);
      }}
      create={wide ? { disabled: !editing.value.canCreate, onCreate: create } : undefined}
    />
  );

  return (
    <CalendarContext.Provider
      value={{ t, formats, timeZone, colorOf, weekNumbers, found: foundId }}
    >
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
              {/* On a wide screen, Google's web order: today, previous, next, then the period they move (D133); none while the tasks screen is shown (D227). */}
              {!wideTasks && wide && (
                <>
                  <button
                    type="button"
                    className="ml-2 h-9 shrink-0 rounded-full border border-line px-4 text-body font-medium text-ink hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
                    // Its name begins with what it shows and says the day (WCAG 2.5.3).
                    aria-label={t("topBar.todayLabel", { date: formats.fullDate(today) })}
                    onClick={() => setAnchor(today)}
                  >
                    {t("topBar.today")}
                  </button>
                  <button
                    type="button"
                    className={`${iconButton} ml-1`}
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
              {!wideTasks && (
                <MonthPicker
                  title={title}
                  anchor={anchor}
                  today={today}
                  weekStart={settings.weekStart}
                  onPick={setAnchor}
                />
              )}
              <div className="flex-1" />
              <button
                type="button"
                className={iconButton}
                aria-label={t("topBar.search")}
                title={t("topBar.search")}
                onClick={() => setSearching(true)}
              >
                <SearchIcon />
              </button>
              {wide ? (
                <ScreenSwitch
                  tasks={tasksOpen}
                  onTasks={(tasks) => (tasks ? setTasksOpen(true) : closeTasks())}
                />
              ) : (
                <>
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
                </>
              )}
              <AccountButton accounts={lists?.accounts ?? []} />
            </header>
            <div inert={covered} aria-hidden={covered || undefined} className="flex min-h-0 flex-1">
              {sidebar && (
                <nav
                  aria-label={t("topBar.menu")}
                  className="flex w-64 shrink-0 flex-col overflow-y-auto bg-canvas"
                >
                  {drawer}
                </nav>
              )}
              {wideTasks && (
                // The tasks screen in the view's place, a column in the middle (D227).
                <div className="mx-auto w-full max-w-[40rem] min-w-0 animate-screen-in">
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
                </div>
              )}
              <main
                hidden={wideTasks}
                aria-label={title}
                aria-busy={waiting ? true : undefined}
                data-waiting={waiting}
                className="relative flex min-w-0 flex-1 flex-col"
              >
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
                    draft={editing.draft}
                    hideCompleted={hideCompleted}
                    // Its code did not arrive, and the notice was closed: the Week.
                    onClose={() => setView("week")}
                  />
                ) : !drawn || !pages ? null : (
                  <Pager
                    view={drawn.view}
                    current={pages.current}
                    previous={pages.previous}
                    next={pages.next}
                    onStep={go}
                    render={(page, current) =>
                      page.layout.view === "month" ? (
                        <MonthView
                          month={page.month}
                          weeks={page.layout.weeks}
                          today={today}
                          undone={data.undone}
                          undoneColor={undoneColor}
                          onOpenDay={openDay}
                        />
                      ) : (
                        <TimeGrid
                          days={page.days}
                          layout={page.layout.range}
                          today={today}
                          minutes={minutes}
                          undone={data.undone}
                          undoneColor={undoneColor}
                          expanded={expanded}
                          onExpandedChange={setExpanded}
                          floating={!sidebar}
                          current={current}
                          scroll={gridScroll}
                        />
                      )
                    }
                  />
                )}
                {/* Material 3's margins: 16 px on a phone, 24 px from 640 px (D132). */}
                {!sidebar && (
                  <button
                    type="button"
                    disabled={!editing.value.canCreate}
                    aria-label={t("fab.create")}
                    title={t("fab.create")}
                    onClick={create}
                    className="absolute right-4 bottom-4 z-[70] grid size-14 place-items-center rounded-2xl bg-fab text-on-fab shadow-lg shadow-black/30 active:scale-[0.97] sm:right-6 sm:bottom-6"
                  >
                    <PlusIcon className="size-7" />
                  </button>
                )}
              </main>
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
            <DialogBackdrop className="fixed inset-0 z-[80] bg-black/45 transition-opacity duration-300 data-ending-style:opacity-0 data-ending-style:duration-200 data-starting-style:opacity-0" />
            <DialogPopup className="fixed inset-y-0 left-0 z-[90] w-[min(20rem,85vw)] overflow-y-auto rounded-r-2xl bg-raised pt-(--inset-top) pb-(--inset-bottom) pl-(--inset-left) text-ink shadow-2xl transition-transform duration-300 ease-[cubic-bezier(0.05,0.7,0.1,1)] data-ending-style:-translate-x-full data-ending-style:duration-200 data-ending-style:ease-[cubic-bezier(0.3,0,0.8,0.15)] data-starting-style:-translate-x-full">
              <Dialog.Title className="sr-only">{t("topBar.menu")}</Dialog.Title>
              <nav aria-label={t("topBar.menu")} className="flex min-h-full flex-col bg-inherit">
                {drawer}
              </nav>
            </DialogPopup>
          </Dialog.Portal>
        </Dialog.Root>
        <SettingsScreen
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          accounts={lists?.accounts ?? []}
          calendars={lists?.calendars ?? []}
          hidden={hidden}
          onToggle={toggleCalendar}
          colorOf={(calendar) => colorOfCalendar(calendar.id)}
        />
        {editing.dialogs}
      </EditingContext.Provider>
    </CalendarContext.Provider>
  );
}

/**
 * The wide top bar's calendar | tasks switch (design D227), Google Calendar
 * web's: two buttons, the one shown pressed, under an indicator that slides
 * to it (at once when less motion is asked for, as every transition).
 */
function ScreenSwitch({ tasks, onTasks }: { tasks: boolean; onTasks: (tasks: boolean) => void }) {
  const { t } = useTranslation();
  const half =
    "relative grid h-full w-12 place-items-center rounded-full text-ink focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <div
      role="group"
      aria-label={t("topBar.switch")}
      className="relative mx-1 flex h-10 shrink-0 rounded-full border border-line p-0.5"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0.5 left-0.5 w-12 rounded-full bg-accent-soft transition-transform duration-250 ease-[cubic-bezier(0.2,0,0,1)] ${tasks ? "translate-x-12" : ""}`}
      />
      <button
        type="button"
        className={`${half} ${tasks ? "hover:bg-raised" : ""}`}
        aria-label={t("topBar.calendar")}
        title={t("topBar.calendar")}
        aria-pressed={!tasks}
        onClick={() => onTasks(false)}
      >
        <CalendarIcon className="size-5" />
      </button>
      <button
        type="button"
        className={`${half} ${tasks ? "" : "hover:bg-raised"}`}
        aria-label={t("topBar.tasks")}
        title={t("topBar.tasks")}
        aria-pressed={tasks}
        onClick={() => onTasks(true)}
      >
        <CheckCircleIcon className="size-5" />
      </button>
    </div>
  );
}

/** Whether `read` holds the items of every one of `days`. */
const holds = (read: Entries, days: readonly string[]) =>
  read.from <= days[0]! && addDays(days.at(-1)!, 1) <= read.to;

/** A period the pager draws, laid out. */
interface Shown extends Page {
  readonly anchor: string;
  /** The first day of the month the top bar names for it. */
  readonly month: string;
  readonly layout:
    | { readonly view: "month"; readonly weeks: MonthWeek[] }
    | { readonly view: "grid"; readonly range: RangeLayout };
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
