// The tasks screen (design D52), as Google Tasks: a tab per task list with
// its count of undone tasks, a card with the list's tasks to complete and
// star in the order picked, and "Completed (N)" folded below. A screen over
// the calendar on a phone, in the view's place on a wide screen (design
// D227). Completing and
// starring write the task to the local store; the sync engine uploads it (D5).
import { completeTask, starTask, wallClockOf, type ItemTime } from "@astrotime/core";
import type { Calendar, Store } from "@astrotime/storage";
import { Checkbox } from "@base-ui/react/checkbox";
import { Menu } from "@base-ui/react/menu";
import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { liveQuery, sameResult, whileShown } from "../calendar/live.ts";
import { rightsOf } from "../calendar/rights.ts";
import {
  isSort,
  SORTS,
  TaskCache,
  taskLists,
  type Sort,
  type TaskList,
  type TaskNode,
  type TaskRow,
} from "../calendar/tasks.ts";
import { useMediaQuery } from "../hooks.ts";
import { KEYS, usePreference, type Preferences } from "../preferences.ts";
import { useCalendar } from "./context.ts";
import { Pager, type Page } from "./pager.tsx";
import { EmptyState } from "./empty-state.tsx";
import { targetOf, useEditing } from "./editing.tsx";
import {
  BackIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronIcon,
  CloseIcon,
  MoreIcon,
  PlusIcon,
  RepeatIcon,
  SortIcon,
  StarIcon,
} from "./icons.tsx";

/** A task to show, as a search result asks (design D53). */
export interface TaskFocus {
  readonly calendarId: string;
  readonly objectId: string;
}

const roundButton =
  "grid size-10 shrink-0 place-items-center rounded-full hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent disabled:hover:bg-transparent";
const iconButton = `${roundButton} text-ink disabled:text-ink-muted`;

/**
 * `prefers-reduced-motion`, as the Pager's `reducedMotion` asks it: asked
 * here, so the screen does not take the Pager and its hooks into its own
 * chunk (D145).
 */
const lessMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Milliseconds a tick the user drew shows before its row moves (design D197). */
const HOLD_MS = 160;

type Motion = typeof import("./task-motion.ts");

/** How far the tab strip fades out on a side that hides tabs, in px (design D135). */
const FADE = 40;

export function TasksScreen({
  store,
  preferences,
  lists,
  today,
  now,
  wide,
  focus,
  onClose,
}: {
  store: Store;
  preferences: Preferences;
  /** The calendars that hold tasks. */
  lists: readonly Calendar[];
  today: string;
  /** The wall clock now, for what is overdue. */
  now: string;
  /** In the view's place on a wide screen (design D227), else a screen over the calendar. */
  wide: boolean;
  focus: TaskFocus | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { timeZone } = useCalendar();
  const [sort, setSort] = usePreference<Sort>(
    preferences,
    KEYS.taskSort,
    (stored) => (isSort(stored) ? stored : "mine"),
    (value) => value,
  );
  const [chosen, setChosen] = usePreference<string | null>(
    preferences,
    KEYS.taskList,
    (stored) => stored,
    (value) => value ?? "",
  );
  const selected = lists.some((list) => list.id === chosen) ? chosen : (lists[0]?.id ?? null);
  const [found, setFound] = useState<string | null>(null);
  useEffect(() => {
    if (!focus) return;
    setChosen(focus.calendarId);
    setFound(focus.objectId);
    // Only when a new task is asked for.
  }, [focus]);

  // The tasks move when they change (design D197): measured before a new
  // read is drawn, moved from there once it is. The code that moves them
  // comes with the screen's first showing (D145), never to reduced motion.
  const stage = useRef<HTMLDivElement>(null);
  const motion = useRef<Motion | null>(null);
  /** Whether the tasks move: their code came, and less motion was not asked for. */
  const [moves, setMoves] = useState(false);
  const measured = useRef<ReturnType<Motion["measure"]> | null>(null);
  /**
   * The completion the user made, until a read carries it (its row changed
   * or left): that read's moves wait for its tick. `landed`: its write is in
   * the store, so the next read carries it or never will (it changed nothing).
   */
  const pending = useRef<{ readonly id: string; readonly ics: string; landed: boolean } | null>(
    null,
  );
  /** The task the user just completed, whose row in "Completed" draws its tick. */
  const drawn = useRef<string | null>(null);
  useEffect(() => {
    if (lessMotion()) return;
    import("./task-motion.ts").then(
      (module) => {
        motion.current = module;
        setMoves(true);
      },
      () => {
        // Not loaded (offline, a new release): the tasks change in place.
      },
    );
  }, []);

  const listKey = lists.map((list) => list.id).join(",");
  const [cache] = useState(() => new TaskCache());
  const [rows, setRows] = useState<TaskRow[]>([]);
  const shown = useRef<TaskRow[]>(rows);
  /** Reads the tasks now, as the live query does: after the user's write, so the screen has it. */
  const read = useRef(async () => {});
  useEffect(() => {
    const ids = listKey === "" ? [] : listKey.split(",");
    const query = async () => cache.rows(await store.tasks(ids), today, timeZone);
    const show = (next: TaskRow[]) => {
      // The same tasks, read again by the other way: nothing to draw or move.
      if (sameResult(shown.current, next)) return;
      shown.current = next;
      measured.current =
        motion.current && stage.current && !lessMotion()
          ? motion.current.measure(stage.current)
          : null;
      setRows(next);
    };
    read.current = async () => show(await query());
    return liveQuery(whileShown(store), query, show);
  }, [store, cache, listKey, today, timeZone]);
  useLayoutEffect(() => {
    const was = measured.current;
    measured.current = null;
    // Whether this read carries the user's completion: its row changed, or left.
    const mine = pending.current;
    const row = rows.find((each) => each.stored.id === mine?.id);
    const carries = mine !== null && row?.stored.ics !== mine.ics;
    if (was && stage.current && motion.current) {
      motion.current.play(stage.current, was, carries ? HOLD_MS : 0);
    }
    // Done with once a read carried it (its row in "Completed" drawn with
    // this read), or once a read after its write did not: it changed nothing.
    if (carries || mine?.landed) {
      pending.current = null;
      drawn.current = null;
    }
  }, [rows]);
  const byList = taskLists(rows, {
    sort,
    collator: new Intl.Collator(i18n.language),
    timeZone,
  });

  const editing = useEditing();
  const targetOfRow = (row: TaskRow) =>
    targetOf(row.stored, row.object, row.recurrenceId, row.task);
  // Onto what the store holds now; the user is told when it did not land, and
  // a local change goes up soon (docs/plans/foundation.md#D91, D99).
  const actions: Actions = {
    complete: (row, done) => {
      const id = row.stored.id;
      pending.current = { id, ics: row.stored.ics, landed: false };
      drawn.current = done ? id : null;
      return editing
        .rewrite(targetOfRow(row), (current) =>
          completeTask(current, done, { now: Date.now(), recurrenceId: row.recurrenceId }),
        )
        .then(async (landed) => {
          const mine = pending.current;
          if (mine?.id === id && landed) mine.landed = true;
          else if (mine?.id === id) {
            // Not written: nothing will move for it, and nothing is drawn.
            pending.current = null;
            drawn.current = null;
          }
          // What it wrote is read before its box lets go of its own state,
          // so the two are drawn together.
          if (landed) await read.current().catch(() => {});
        });
    },
    star: (row) =>
      void editing.rewrite(targetOfRow(row), (current) =>
        starTask(current, !row.starred, Date.now()),
      ),
    open: (row) => editing.open(targetOfRow(row)),
    add: (list) => editing.create("task", { day: today, allDay: true, calendarId: list.id }),
    found,
    drawn,
    today,
    now,
  };

  // The tab strip's hidden sides, so each fades out while it hides tabs, and
  // the open or focused tab is scrolled clear of the fade (design D135).
  const strip = useRef<HTMLDivElement>(null);
  const [hides, setHides] = useState({ start: false, end: false });
  const openTab = () => strip.current?.querySelector("[role=tab][aria-selected=true]");
  // How far a tab is past each side's fade, which shows only where that side hides tabs.
  const slack = (tab: Element) => {
    const element = strip.current!;
    const room = element.getBoundingClientRect();
    const { left, right } = tab.getBoundingClientRect();
    const start = element.scrollLeft > 1 ? FADE : 0;
    const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1 ? FADE : 0;
    return { start: left - (room.left + start), end: room.right - end - right };
  };
  // Whether the open tab was clear of the fade when last measured: a resize
  // brings it back only then, so a strip the user scrolled stays (design D135).
  const openWasClear = useRef(true);
  const measureStrip = () => {
    const element = strip.current;
    if (!element) return;
    const start = element.scrollLeft > 1;
    const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
    setHides((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
    const open = openTab();
    if (open) {
      const { start: before, end: after } = slack(open);
      openWasClear.current = before >= -1 && after >= -1;
    }
  };
  // The strip alone scrolls (not the page or the panel), so a tab clears the
  // fade on either side, as far as the strip can go. FADE on both sides even
  // where a side shows none (unlike `slack`): there the strip is at its end,
  // and the browser clamps the scroll, so it comes to the same.
  const clear = (tab: Element | null | undefined) => {
    const element = strip.current;
    if (!element || !tab) return;
    const room = element.getBoundingClientRect();
    const { left, right } = tab.getBoundingClientRect();
    // Whole pixels, rounded away from the fade: scrollLeft keeps no fraction.
    if (left < room.left + FADE) element.scrollLeft -= Math.ceil(room.left + FADE - left);
    else if (right > room.right - FADE)
      element.scrollLeft += Math.ceil(right - (room.right - FADE));
  };
  const clearOpen = () => clear(openTab());
  const hasLists = lists.length > 0;
  // The lists as the Pager's pages (design D199): in their order, which a
  // page's first "day" carries, as the Pager compares them to slide.
  const coarse = useMediaQuery("(any-pointer: coarse)");
  const index = lists.findIndex((list) => list.id === selected);
  const pageOf = (at: number): ListPage | null => {
    const list = lists[at];
    return list ? { key: list.id, days: [String(at).padStart(4, "0")], list } : null;
  };
  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    // The strip's width, and its tabs' as their names and counts change (a
    // count, a font, lists arriving): the fade is measured again, and the open
    // tab, clear of it before, is brought clear again if the change covered it.
    const observer = new ResizeObserver(() => {
      const open = openTab();
      if (open && openWasClear.current) {
        const { start, end } = slack(open);
        if (start < -1 || end < -1) clear(open);
      }
      measureStrip();
    });
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    return () => observer.disconnect();
  }, [hasLists]);
  useEffect(() => {
    clearOpen();
    measureStrip();
  }, [selected]);
  const fade = (side: boolean) => (side ? "transparent" : "black");
  const stripMask =
    hides.start || hides.end
      ? {
          maskImage: `linear-gradient(to right, ${fade(hides.start)}, black ${FADE}px, black calc(100% - ${FADE}px), ${fade(hides.end)})`,
        }
      : undefined;

  return (
    <section
      aria-label={t("tasks.title")}
      className="relative flex h-full min-h-0 flex-col bg-canvas text-ink"
    >
      <header className="flex h-14 shrink-0 items-center gap-1 px-1.5">
        {!wide && (
          <button
            type="button"
            className={iconButton}
            aria-label={t("tasks.back")}
            onClick={onClose}
          >
            <BackIcon />
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate px-2 text-headline leading-tight">
          {t("tasks.title")}
        </h1>
        {wide && (
          <button
            type="button"
            className={iconButton}
            aria-label={t("tasks.close")}
            onClick={onClose}
          >
            <CloseIcon className="size-5" />
          </button>
        )}
      </header>
      {/* No list at all: with any, the first is open when none was chosen. */}
      {selected === null ? (
        <EmptyState
          icon={<CheckCircleIcon className="size-6" />}
          title={t("tasks.noLists")}
          hint={t("tasks.noListsHint")}
        />
      ) : (
        <Tabs.Root
          value={selected}
          onValueChange={(value) => setChosen(String(value))}
          className="flex min-h-0 flex-1 flex-col"
        >
          {/* Wider than the panel, the strip scrolls; a side with more fades out (design D135).
              The line under it is its wrapper's, so the mask does not fade it. */}
          <div className="shrink-0 border-b border-line">
            <div
              ref={strip}
              data-tab-strip=""
              onScroll={measureStrip}
              // A tab reached by Tab is scrolled clear of the fade too.
              onFocus={(event) => {
                // Focus from the keyboard only: a mouse's press focuses the tab
                // too, and the strip must not move under the pointer before
                // its click lands.
                if (
                  event.target.getAttribute("role") === "tab" &&
                  event.target.matches(":focus-visible")
                )
                  clear(event.target);
              }}
              style={stripMask}
              className="flex items-stretch overflow-x-auto [scrollbar-width:none]"
            >
              <Tabs.List aria-label={t("tasks.lists")} className="relative flex">
                {lists.map((list) => {
                  const count = byList.get(list.id)?.undoneCount ?? 0;
                  return (
                    <Tabs.Tab
                      key={list.id}
                      value={list.id}
                      aria-label={
                        count > 0
                          ? t("tasks.tab", { list: list.name, undone: t("undone", { count }) })
                          : list.name
                      }
                      className="group flex h-12 items-center gap-2 px-4 text-row whitespace-nowrap text-ink-muted -outline-offset-2 hover:text-ink focus-visible:bg-raised data-active:text-accent"
                    >
                      {list.name}
                      {/* Apart as words, as the name says them (WCAG 2.5.3). */}
                      {count > 0 && " "}
                      {count > 0 && (
                        // The open list's count shows in its card instead, as in the reference.
                        <span
                          aria-hidden="true"
                          className="rounded-full bg-pill px-2 py-0.5 text-note leading-none text-ink group-data-active:hidden"
                        >
                          {count}
                        </span>
                      )}
                    </Tabs.Tab>
                  );
                })}
                <Tabs.Indicator className="absolute bottom-0 left-0 h-[3px] w-(--active-tab-width) translate-x-(--active-tab-left) rounded-t-full bg-accent transition-[translate,width] duration-150" />
              </Tabs.List>
              {/* Creating a list on the server is later work (docs/plans/design.md#deferred). */}
              <button
                type="button"
                disabled
                className="flex h-12 items-center gap-1.5 px-4 text-row whitespace-nowrap text-ink-muted"
              >
                <PlusIcon className="size-5" />
                {t("tasks.newList")}
              </button>
            </div>
          </div>
          {/* The stage the tasks move on: rows that left are drawn on its layer (design D197). */}
          <div
            ref={stage}
            data-moves={moves || undefined}
            className="relative flex min-h-0 flex-1 flex-col"
          >
            {/* Lists move as periods do (design D199): one slides in from
                the side it comes from; on a touch screen the lists beside
                are drawn beside it and a sideways swipe carries them. */}
            <Pager
              view="tasks"
              current={pageOf(index)!}
              previous={coarse ? pageOf(index - 1) : null}
              next={coarse ? pageOf(index + 1) : null}
              onStep={(step) => {
                const list = lists[index + step];
                if (list) setChosen(list.id);
              }}
              render={({ list }, current) => {
                const cards = (
                  <ListCards
                    list={list}
                    tasks={byList.get(list.id)}
                    sort={sort}
                    onSort={setSort}
                    actions={actions}
                  />
                );
                return (
                  <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-24">
                    {current ? (
                      <Tabs.Panel value={list.id} className="flex flex-col gap-3 rounded-xl">
                        {cards}
                      </Tabs.Panel>
                    ) : (
                      <div className="flex flex-col gap-3">{cards}</div>
                    )}
                  </div>
                );
              }}
            />
            {/* Rows leaving are drawn on it, out of reach of a press, the keyboard and a screen reader. */}
            <div
              data-motion-layer=""
              inert
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden"
            />
          </div>
        </Tabs.Root>
      )}
      {!wide && (
        // A new task in the list shown, undated, as Google Tasks' button makes one.
        <button
          type="button"
          disabled={!lists.some((list) => list.id === selected && rightsOf(list).create)}
          aria-label={t("fab.create")}
          title={t("fab.create")}
          onClick={() => {
            const list = lists.find((l) => l.id === selected);
            if (list) actions.add(list);
          }}
          className="absolute right-4 bottom-4 grid size-14 place-items-center rounded-2xl bg-fab text-on-fab shadow-lg shadow-black/30"
        >
          <PlusIcon className="size-7" />
        </button>
      )}
    </section>
  );
}

/** A list as a page of the Pager (design D199). */
interface ListPage extends Page {
  readonly list: Calendar;
}

/** Where a count goes in a translated string, to cut it there. */
const COUNT_MARK = "\u2063";

interface Actions {
  /** Resolves once the change is written and read, or did not land. */
  readonly complete: (row: TaskRow, done: boolean) => Promise<void>;
  readonly star: (row: TaskRow) => void;
  /** Its details (docs/plans/foundation.md#D14). */
  readonly open: (row: TaskRow) => void;
  /** A new undated task in the list. */
  readonly add: (list: Calendar) => void;
  /** The object a search asked to show. */
  readonly found: string | null;
  /** The task the user just completed (design D197). */
  readonly drawn: { readonly current: string | null };
  readonly today: string;
  readonly now: string;
}

function ListCards({
  list,
  tasks,
  sort,
  onSort,
  actions,
}: {
  list: Calendar;
  tasks: TaskList | undefined;
  sort: Sort;
  onSort: (sort: Sort) => void;
  actions: Actions;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const undone = tasks?.undone ?? [];
  const completed = tasks?.completed ?? [];
  const showCompleted = open || completed.some((row) => row.stored.id === actions.found);
  // Completing and starring are edits; adding one is a creation (D37).
  const { create, edit } = rightsOf(list);
  const readOnly = !edit;
  // "Completed (N)" as one translated string, cut at its count so the count
  // is a box of its own that can tick over (design D197).
  const around = t("tasks.completed", { n: COUNT_MARK }).split(COUNT_MARK);
  return (
    <>
      <div data-card="undone" className="relative isolate rounded-2xl pb-2">
        <CardBackground />
        <div className="flex items-center gap-1 pt-2 pr-2 pl-5">
          <h2 className="min-w-0 flex-1 truncate text-title font-medium">{list.name}</h2>
          <SortMenu sort={sort} onSort={onSort} />
          {/* Renaming and deleting lists come with list management (docs/plans/design.md#deferred). */}
          <button type="button" disabled className={iconButton} aria-label={t("tasks.listMenu")}>
            <MoreIcon className="size-5" />
          </button>
        </div>
        {create && (
          <button
            type="button"
            onClick={() => actions.add(list)}
            className="mx-2 flex h-11 items-center gap-3 rounded-xl px-3 text-row font-medium text-accent hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
          >
            <CheckCircleIcon className="size-[22px]" />
            {t("tasks.add")}
          </button>
        )}
        {undone.length === 0 ? (
          <p className="px-5 pt-1 pb-3 text-body text-ink-muted">
            {t(completed.length > 0 ? "tasks.allDone" : "tasks.none")}
          </p>
        ) : (
          <ul aria-label={list.name}>
            {undone.map((node) => (
              <TaskItem
                key={node.row.stored.id}
                node={node}
                depth={0}
                readOnly={readOnly}
                actions={actions}
              />
            ))}
          </ul>
        )}
      </div>
      {completed.length > 0 && (
        <div data-card="completed" className="relative isolate rounded-2xl">
          <CardBackground />
          <button
            type="button"
            aria-expanded={showCompleted}
            // Its name in one piece: the count's own box would split it.
            aria-label={t("tasks.completed", { n: completed.length })}
            onClick={() => setOpen(!showCompleted)}
            className="flex h-14 w-full items-center gap-2 rounded-2xl pr-4 pl-5 text-left text-row font-medium hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
          >
            {/* The count in its own box, so it can tick over (design D197). */}
            <span className="min-w-0 flex-1">
              {around[0]}
              <span data-completed-count="" className="inline-block">
                {completed.length}
              </span>
              {around[1]}
            </span>
            <ChevronIcon direction={showCompleted ? "up" : "down"} className="size-5" />
          </button>
          {showCompleted && (
            <ul aria-label={t("tasks.completedList")} className="pb-2">
              {completed.map((row) => (
                <TaskItem
                  key={row.stored.id}
                  node={{ row, children: [] }}
                  depth={0}
                  readOnly={readOnly}
                  actions={actions}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

/**
 * A card's background, apart from what it holds, so a card that changed its
 * height is stretched from the one it had without its rows (design D197).
 */
function CardBackground() {
  return (
    <div
      data-card-background=""
      aria-hidden="true"
      className="absolute inset-0 -z-10 origin-top rounded-2xl bg-tile"
    />
  );
}

function SortMenu({ sort, onSort }: { sort: Sort; onSort: (sort: Sort) => void }) {
  const { t } = useTranslation();
  return (
    <Menu.Root>
      <Menu.Trigger className={iconButton} aria-label={t("tasks.sort")}>
        <SortIcon className="size-5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-[100]">
          <Menu.Popup className="min-w-48 origin-[var(--transform-origin)] rounded-xl bg-raised py-1.5 text-ink shadow-xl ring-1 ring-line transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            <Menu.RadioGroup value={sort} onValueChange={(value) => onSort(value as Sort)}>
              {SORTS.map((option) => (
                <Menu.RadioItem
                  key={option}
                  value={option}
                  className="flex h-10 cursor-default items-center gap-3 px-4 text-body -outline-offset-2 data-highlighted:bg-raised-hover"
                >
                  <span className="grid size-4 place-items-center text-accent">
                    <Menu.RadioItemIndicator>
                      <CheckIcon className="size-4" />
                    </Menu.RadioItemIndicator>
                  </span>
                  {t(`tasks.sort.${option}`)}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function TaskItem({
  node,
  depth,
  readOnly,
  actions,
}: {
  node: TaskNode;
  depth: number;
  readOnly: boolean;
  actions: Actions;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const { row, children } = node;
  const title = row.task.summary?.trim() || t("item.untitled");
  const found = row.stored.id === actions.found;
  const element = useRef<HTMLLIElement>(null);
  // Checked at once, before the store has it; its own state let go once the
  // store's read has it, or the write did not land (or changed nothing).
  const [checking, setChecking] = useState<boolean | null>(null);
  useEffect(() => setChecking(null), [row.stored.ics]);
  const checked = checking ?? row.done;
  // The tick is drawn in when the user checks it, here or in "Completed" once it moved there.
  const [draw, setDraw] = useState(() => row.done && actions.drawn.current === row.stored.id);
  useEffect(() => {
    if (found) element.current?.scrollIntoView({ block: "nearest" });
  }, [found]);

  const dayOf = (due: ItemTime) =>
    due.type === "date" ? due.date : wallClockOf(due, timeZone).slice(0, 10);
  const due = row.due;
  const dueText =
    due &&
    (due.type === "date"
      ? formats.day(due.date, actions.today)
      : `${formats.day(dayOf(due), actions.today)}, ${formats.time(due, timeZone)}`);
  const overdue =
    due !== null &&
    !row.done &&
    (due.type === "date" ? due.date < actions.today : wallClockOf(due, timeZone) < actions.now);

  return (
    <li ref={element} aria-label={title} data-found={found || undefined} className="rounded-xl">
      {/* The whole row opens the task (design D195): the title's button covers
          it, and the checkbox and the star sit above that cover. */}
      <div
        data-task={row.stored.id}
        className="relative flex items-start gap-3 rounded-xl py-1.5 pr-1 hover:bg-canvas"
        style={{ paddingLeft: 16 + depth * 32 }}
      >
        <Checkbox.Root
          checked={checked}
          disabled={readOnly}
          onCheckedChange={(done) => {
            setChecking(done);
            setDraw(done);
            // Once written and read (the row then shows it), or not written.
            void actions.complete(row, done).then(() => setChecking(null));
          }}
          aria-label={title}
          className="relative z-10 mt-2 grid size-[22px] shrink-0 place-items-center rounded-full border-2 border-ink-muted text-accent hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-checked:border-transparent"
        >
          <Checkbox.Indicator className={`flex data-unchecked:hidden ${draw ? "tick-draw" : ""}`}>
            <CheckIcon className="size-5" strokeWidth="2.4" />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
          <button
            type="button"
            onClick={() => actions.open(row)}
            className={`text-left text-row leading-snug break-words outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent ${checked ? "text-ink-muted line-through" : ""}`}
          >
            {title}
          </button>
          {dueText && (
            <span
              className={`flex items-center gap-1 text-note ${overdue ? "text-danger" : "text-ink-muted"}`}
            >
              {dueText}
              {row.recurring && (
                <>
                  <RepeatIcon className="size-3.5" />
                  <span className="sr-only">{t("tasks.repeats")}</span>
                </>
              )}
            </span>
          )}
        </div>
        {!row.done && (
          <button
            type="button"
            disabled={readOnly}
            aria-pressed={row.starred}
            aria-label={t("tasks.star", { title })}
            onClick={() => actions.star(row)}
            className={`${roundButton} relative z-10 ${row.starred ? "text-accent" : "text-ink-muted"}`}
          >
            <StarIcon filled={row.starred} className="size-[22px]" />
          </button>
        )}
      </div>
      {children.length > 0 && (
        <ul>
          {children.map((child) => (
            <TaskItem
              key={child.row.stored.id}
              node={child}
              depth={depth + 1}
              readOnly={readOnly}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
