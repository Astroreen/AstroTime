// The tasks screen (design D52), as Google Tasks: a tab per task list with
// its count of undone tasks, a card with the list's tasks to complete and
// star in the order picked, and "Completed (N)" folded below. A screen on a
// phone, a panel beside the calendar on a wide screen. Completing and
// starring write the task to the local store; the sync engine uploads it (D5).
import { completeTask, starTask, wallClockOf, type ItemTime } from "@astrotime/core";
import type { Calendar, Store } from "@astrotime/storage";
import { Checkbox } from "@base-ui/react/checkbox";
import { Menu } from "@base-ui/react/menu";
import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { liveQuery } from "../calendar/live.ts";
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
import { KEYS, usePreference, type Preferences } from "../preferences.ts";
import { useCalendar } from "./context.ts";
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
  /** A panel beside the calendar, else a screen of its own. */
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

  const listKey = lists.map((list) => list.id).join(",");
  const [cache] = useState(() => new TaskCache());
  const [rows, setRows] = useState<TaskRow[]>([]);
  useEffect(() => {
    const ids = listKey === "" ? [] : listKey.split(",");
    return liveQuery(
      store,
      async () => cache.rows(await store.tasks(ids), today, timeZone),
      setRows,
    );
  }, [store, cache, listKey, today, timeZone]);
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
    complete: (row, done) =>
      editing.rewrite(targetOfRow(row), (current) =>
        completeTask(current, done, { now: Date.now(), recurrenceId: row.recurrenceId }),
      ),
    star: (row) =>
      editing.rewrite(targetOfRow(row), (current) => starTask(current, !row.starred, Date.now())),
    open: (row) => editing.open(targetOfRow(row)),
    add: (list) => editing.create("task", { day: null, calendarId: list.id }),
    found,
    today,
    now,
  };

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
      {lists.length === 0 || selected === null ? (
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
          <div className="flex shrink-0 items-stretch overflow-x-auto border-b border-line [scrollbar-width:none]">
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
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-3 pb-24">
            {lists.map((list) => (
              <Tabs.Panel key={list.id} value={list.id} className="flex flex-col gap-3 rounded-xl">
                <ListCards
                  list={list}
                  tasks={byList.get(list.id)}
                  sort={sort}
                  onSort={setSort}
                  actions={actions}
                />
              </Tabs.Panel>
            ))}
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

interface Actions {
  readonly complete: (row: TaskRow, done: boolean) => void;
  readonly star: (row: TaskRow) => void;
  /** Its details (docs/plans/foundation.md#D14). */
  readonly open: (row: TaskRow) => void;
  /** A new undated task in the list. */
  readonly add: (list: Calendar) => void;
  /** The object a search asked to show. */
  readonly found: string | null;
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
  return (
    <>
      <div className="rounded-2xl bg-tile pb-2">
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
        <div className="rounded-2xl bg-tile">
          <button
            type="button"
            aria-expanded={showCompleted}
            onClick={() => setOpen(!showCompleted)}
            className="flex h-14 w-full items-center gap-2 rounded-2xl pr-4 pl-5 text-left text-row font-medium hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span className="min-w-0 flex-1">{t("tasks.completed", { n: completed.length })}</span>
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
      <div className="flex items-start gap-3 py-1.5 pr-1" style={{ paddingLeft: 16 + depth * 32 }}>
        <Checkbox.Root
          checked={row.done}
          disabled={readOnly}
          onCheckedChange={(done) => actions.complete(row, done)}
          aria-label={title}
          className="mt-2 grid size-[22px] shrink-0 place-items-center rounded-full border-2 border-ink-muted text-accent hover:border-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-checked:border-transparent"
        >
          <Checkbox.Indicator className="flex data-unchecked:hidden">
            <CheckIcon className="size-5" strokeWidth="2.4" />
          </Checkbox.Indicator>
        </Checkbox.Root>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
          <button
            type="button"
            onClick={() => actions.open(row)}
            className={`text-left text-row leading-snug break-words focus-visible:outline-2 focus-visible:outline-accent ${row.done ? "text-ink-muted line-through" : ""}`}
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
            className={`${roundButton} ${row.starred ? "text-accent" : "text-ink-muted"}`}
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
