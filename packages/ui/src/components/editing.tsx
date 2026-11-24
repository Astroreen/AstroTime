// Opening, creating, editing and deleting items from anywhere in the UI
// (docs/plans/foundation.md#D9–D11): the views, search and the tasks screen
// open an item's details or the edit dialog through `useEditing`; the
// calendar screen holds their state and renders the dialogs. Every write
// goes to the local store (D5) and tells the sync scheduler (D91).
import {
  CalendarObject,
  completeTask,
  isDone,
  starTask,
  type ItemTime,
  type ItemTimes,
  type Task,
} from "@astrotime/core";
import type { Account, Calendar, Store, StoredObject } from "@astrotime/storage";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  calendarsFor,
  deleteScopes,
  deleteTarget,
  firstCalendarFor,
  followed,
  formOf,
  GoneError,
  goesToEveryCopy,
  InDoubtError,
  isOccurrence,
  itemOf,
  newForm,
  newItemCalendar,
  noticeOf,
  NowhereError,
  accountsOnServers,
  problemOf,
  RefusedError,
  rewriteTarget,
  saveChanges,
  saveForm,
  scopesFor,
  scopesForTimes,
  type Form,
  type Notice,
  type Target,
} from "../calendar/editing.ts";
import { liveQuery, whileShown } from "../calendar/live.ts";
import type { DrawnDraft } from "../calendar/query.ts";
import { rightsOf } from "../calendar/rights.ts";
import type { DefaultColors } from "../settings.ts";
import { useCelebrate } from "./celebration.ts";
import { ChangeNotice } from "./change-notice.tsx";
import type { AccountChoice, Press } from "./editor-fields.tsx";
import type { EditorState } from "./item-editor.tsx";
import { CopyNotice, ItemDetails, ItemEditor, QuickCreate } from "./lazy.tsx";
import type { Landed } from "./context.ts";
import { ScopeDialog, type ScopeRequest } from "./scope-dialog.tsx";

interface CreateOptions {
  /** The day it is on. */
  readonly day: string;
  /** On the day, with no time: the tasks screen's new task (design D159), a tap on the all-day strip (D188). */
  readonly allDay?: boolean;
  /** Minutes past midnight of a tapped slot of the time grid. */
  readonly at?: number;
  /** Minutes it lasts, a press dragged over the grid; an hour by default. */
  readonly length?: number;
  /** The calendar (a task list) it goes in; the first that takes new items by default. */
  readonly calendarId?: string;
  /** The click on an empty slot that asks for it, for the dialog to tell a double click's second from a click of its own (design D190). */
  readonly press?: Press;
}

/** How a move or a resize ended (design D111): written, nothing to write, or why not. */
export type Rescheduled = "saved" | "unchanged" | "cancelled" | "gone" | "inDoubt" | "failed";

export interface EditingValue {
  /** Shows an item's details. */
  open(target: Target): void;
  /** Opens quick create for a new item, which expands to the edit dialog (design D296). */
  create(kind: "event" | "task", options: CreateOptions): void;
  /** Whether any calendar can take a new item. */
  readonly canCreate: boolean;
  /** Whether an item of this calendar can change (its `edit` right): only those drag. */
  canChange(calendarId: string): boolean;
  /**
   * Gives an occurrence new times, a drag's drop or a key's move, through
   * the edit dialog's save, asking the scope for an occurrence of a series
   * (design D111); resolves once it is written, or why it was not.
   */
  reschedule(target: Target, times: ItemTimes): Promise<Rescheduled>;
  /**
   * Writes one change of an item (a task completed or starred) onto what the
   * store holds now, telling the user when it did not land; resolves to
   * whether it landed.
   */
  rewrite(target: Target, ics: (object: CalendarObject) => string): Promise<boolean>;
}

export const EditingContext = createContext<EditingValue | null>(null);

export function useEditing(): EditingValue {
  const value = useContext(EditingContext);
  if (!value) throw new Error("useEditing needs an EditingContext provider.");
  return value;
}

/** The target an entry of the views, a search result or a task row stands for. */
export function targetOf(
  stored: Pick<StoredObject, "id" | "calendarId">,
  object: CalendarObject,
  recurrenceId: ItemTime | null,
  item: Target["item"],
): Target {
  return { objectId: stored.id, calendarId: stored.calendarId, object, recurrenceId, item };
}

/** A target again from the store's row, after a write: its exception if one is there now. */
function refreshed(row: StoredObject, target: Target): Target | null {
  if (row.pending === "delete") return null;
  if (row.ics === target.object.serialize()) return target;
  let object: CalendarObject;
  try {
    object = CalendarObject.parse(row.ics);
  } catch {
    return null;
  }
  const item = itemOf(object, target.recurrenceId);
  if (!item) return null;
  return { ...target, calendarId: row.calendarId, object, item };
}

/**
 * UIDs made for a save, and the first of them: a new item's own (design
 * D193). Out here, so the hook that saves keeps the React Compiler's memos.
 */
function madeUids(): { next: () => string; first: () => string | null } {
  const all: string[] = [];
  return {
    next: () => {
      const uid = crypto.randomUUID();
      all.push(uid);
      return uid;
    },
    first: () => all[0] ?? null,
  };
}

/** The copy's code, loaded with the details' menu, not with the app (foundation D145). */
const copying = () => import("../calendar/copy.ts");

interface Editing {
  readonly target: Target | null;
  readonly initial: Form | null;
  readonly state: EditorState;
  /** "Copy to": the copy's iCalendar, which `initial` is the form of (design D164). */
  readonly base?: string;
  /** A new item in quick create, not yet expanded to the edit dialog (design D296). */
  readonly quick?: boolean;
}

export function useEditingState({
  store,
  accounts,
  calendars,
  everyAccount,
  hidden,
  timeZone,
  today,
  minutes,
  colorOf,
  defaultColors,
  onChanged,
}: {
  store: Store;
  /** The accounts, to choose the one an item goes to (design D313). */
  accounts: readonly Account[];
  calendars: readonly Calendar[];
  /** A new item goes to every account, not to one chosen (design D314). */
  everyAccount: boolean;
  /** Calendars hidden from the views: a new item goes in a visible one first. */
  hidden: ReadonlySet<string>;
  /** The colour a new event or task starts with (design D172); `null`, its calendar's. */
  defaultColors: DefaultColors;
  timeZone: string;
  today: string;
  minutes: number;
  colorOf: (target: Target) => string;
  /** A local change was written: the sync scheduler sends it soon (D91). */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<Target | null>(null);
  // The edit dialog's item as its form says now, which the editor makes in
  // its own chunk and the views draw (design D155).
  const [draft, setDraft] = useState<DrawnDraft | null>(null);
  // The item the edit dialog last saved, by UID: it lands where it goes (design D193).
  const [landed, setLanded] = useState<Landed | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [asking, setAsking] = useState<ScopeRequest | null>(null);
  const [related, setRelated] = useState<{ parent: string | null; subtasks: string[] }>({
    parent: null,
    subtasks: [],
  });

  // The details follow the store: a completion, an edit, a sync that changed it.
  const detailsId = details?.objectId;
  useEffect(() => {
    if (!detailsId) return;
    return liveQuery(
      whileShown(store),
      async () => {
        const row = await store.object(detailsId);
        const others = row?.kind === "task" ? await store.tasks([row.calendarId]) : [];
        return { row, others };
      },
      ({ row, others }) => {
        setDetails((current) => {
          if (!current || current.objectId !== detailsId) return current;
          return row ? refreshed(row, current) : null;
        });
        const titles = others.flatMap((other) => {
          try {
            const master = CalendarObject.parse(other.ics).master;
            return master?.kind === "task" ? [master] : [];
          } catch {
            return [];
          }
        });
        const own = row ? CalendarObject.parse(row.ics).master : null;
        const task = own?.kind === "task" ? own : null;
        const name = (title: Task) => title.summary?.trim() || "";
        setRelated({
          parent: task?.parentUid
            ? (titles.find((title) => title.uid === task.parentUid)?.summary ?? null)
            : null,
          subtasks: task ? titles.filter((title) => title.parentUid === task.uid).map(name) : [],
        });
      },
    );
  }, [store, detailsId]);

  const byId = (id: string | undefined) => calendars.find((c) => c.id === id);
  // Each calendar's account as last seen: a calendar gone while its new item's
  // dialog is open still names its account, whose next calendar takes it (D313).
  const knownAccounts = useRef(new Map<string, string>());
  for (const calendar of calendars) knownAccounts.current.set(calendar.id, calendar.accountId);
  /** The accounts on a server, which a new item goes to when it goes to every account (D314). */
  const servers = new Set(accountsOnServers(accounts).map((account) => account.id));
  /** New items go to every account: on, and two accounts on a server or more to go to (D314). */
  const toEvery = everyAccount && servers.size > 1;
  // A new item goes where new items may; an existing one stays, or moves where its own lets it (D37).
  const writable = (kind: "event" | "task", from?: Calendar) => calendarsFor(calendars, kind, from);
  // While new items go to every account, one on a server first: the
  // device's calendar keeps no copy it would not step aside for (D314).
  const firstFor = (kind: "event" | "task") =>
    (toEvery
      ? firstCalendarFor(
          calendars.filter((calendar) => servers.has(calendar.accountId)),
          kind,
          hidden,
        )
      : undefined
    )?.id ??
    firstCalendarFor(calendars, kind, hidden)?.id ??
    null;
  /** The calendar the item being edited was in; none for a new item. */
  const fromOf = (current: Editing) =>
    current.target ? byId(current.initial?.calendarId) : undefined;

  const celebrate = useCelebrate();
  const [notice, setNotice] = useState<Notice | null>(null);
  /** The copy "Make a copy" made, whose notice opens it (design D164). */
  const [copied, setCopied] = useState<Target | null>(null);
  /** A change made outside the edit dialog; the user is told when it did not land (D99). */
  const write = (work: Promise<unknown>, action: "change" | "delete" = "change") => {
    // One notice at a time, in one place: the newest replaces the other.
    setNotice(null);
    setCopied(null);
    return work.then(
      () => {
        onChanged();
        return true;
      },
      (error: unknown) => {
        const told = noticeOf(error, action);
        if (told === null) {
          onChanged();
          return true;
        }
        if (told === "failed" || told === "deleteFailed") console.error(error);
        setNotice(told);
        return false;
      },
    );
  };
  const rewrite = (target: Target, ics: (object: CalendarObject) => string) =>
    write(rewriteTarget(store, target, ics));

  /** Why a save did not land, for the user (D99): gone meanwhile, unclear, or failed. */
  const failureOf = (error: unknown): "gone" | "inDoubt" | "failed" => {
    if (error instanceof GoneError) return "gone";
    if (error instanceof InDoubtError) return "inDoubt";
    console.error(error);
    return "failed";
  };
  /** As `failureOf`, and for a new item, its calendar refusing it or none taking it (D122). */
  const saveFailureOf = (error: unknown): "refused" | "nowhere" | ReturnType<typeof failureOf> => {
    if (error instanceof RefusedError) return "refused";
    if (error instanceof NowhereError) return "nowhere";
    return failureOf(error);
  };

  const value: EditingValue = {
    open: setDetails,
    create(kind, options) {
      const fits = options.calendarId && writable(kind).some((c) => c.id === options.calendarId);
      const other = kind === "event" ? "task" : "event";
      const chosen = fits ? options.calendarId! : firstFor(kind);
      // No calendar for events: a task, where one can go (and the other way round).
      const actual = chosen ? kind : firstFor(other) ? other : null;
      const calendarId = chosen ?? (actual ? firstFor(actual) : null);
      if (!actual || !calendarId) return;
      const form = {
        ...newForm(actual, {
          calendarId,
          day: options.day,
          minutes,
          timeZone,
          ...(options.at === undefined ? {} : { at: options.at }),
          ...(options.length === undefined ? {} : { length: options.length }),
          ...(options.allDay === undefined ? {} : { allDay: options.allDay }),
        }),
        // A default other than the calendar's is the item's own COLOR (D172).
        color: defaultColors[actual],
      };
      setEditing({
        target: null,
        initial: null,
        quick: true,
        state: {
          existing: false,
          form,
          problem: null,
          saving: false,
          ...(options.press ? { opener: options.press } : {}),
        },
      });
    },
    canCreate: writable("event").length > 0 || writable("task").length > 0,
    // Moving an item edits it: only where the calendar's rights allow it (D37).
    canChange: (calendarId) => rightsOf(byId(calendarId)).edit,
    reschedule(target, times) {
      return new Promise((resolve) => {
        const run = (scope: "this" | "following" | "all") => {
          saveChanges(
            store,
            { target, changes: { time: times }, calendarId: target.calendarId, scope },
            { now: Date.now(), uid: () => crypto.randomUUID() },
          ).then(
            () => {
              onChanged();
              resolve("saved");
            },
            (error: unknown) => resolve(failureOf(error)),
          );
        };
        const rights = rightsOf(byId(target.calendarId));
        const scopes = scopesForTimes(target, times, timeZone, rights);
        if (scopes.length === 0) run("all");
        else {
          setAsking({
            action: "edit",
            kind: target.item.kind,
            scopes,
            run,
            onCancel: () => resolve("cancelled"),
          });
        }
      });
    },
    rewrite,
  };

  const change = (form: Form) =>
    setEditing((current) => {
      if (!current) return current;
      // A kind its calendar cannot hold moves to the first calendar that
      // can, in the same account first: the account chosen stays (D313).
      const offered = writable(form.kind, fromOf(current));
      const fits = offered.some((c) => c.id === form.calendarId);
      const accountId = byId(form.calendarId)?.accountId;
      const own = offered.filter((c) => c.accountId === accountId);
      // A calendar ticked beside it that takes the kind first, then the account's first.
      const tickedFits = own.find((c) => form.alsoIn?.includes(c.id));
      const sameAccount = tickedFits ?? own.find((c) => !hidden.has(c.id)) ?? own[0];
      const placed = fits
        ? form
        : { ...form, calendarId: sameAccount?.id ?? firstFor(form.kind) ?? form.calendarId };
      // The other calendars ticked: those of its account that take its kind (D313).
      const account = byId(placed.calendarId)?.accountId;
      const alsoIn = (placed.alsoIn ?? []).filter(
        (id) =>
          id !== placed.calendarId && offered.some((c) => c.id === id && c.accountId === account),
      );
      const next = { ...placed, alsoIn };
      // A rule moves with the item's day (D105).
      const moved = followed(current.state.form, next);
      return { ...current, state: { ...current.state, form: moved, problem: null } };
    });

  const save = () => {
    if (!editing) return;
    // A new item goes where its dialog shows it going: the save decides by
    // the same rule, on the calendars as they are then (foundation D122).
    const { target, initial, state } = editing;
    const problem = problemOf(state.form, initial);
    if (problem) {
      setEditing({ ...editing, state: { ...state, problem, problemKind: state.form.kind } });
      return;
    }
    const run = (scope: "this" | "following" | "all") => {
      setEditing((current) => current && { ...current, state: { ...current.state, saving: true } });
      // A new item's UID is made as it is saved: the first one made is its own.
      const made = madeUids();
      saveForm(
        store,
        {
          target,
          initial,
          form: state.form,
          scope,
          untitled: t("edit.untitledReminder"),
          hidden,
          ...(toEvery ? { everyAccount: servers } : {}),
          ...(knownAccounts.current.has(state.form.calendarId)
            ? { account: knownAccounts.current.get(state.form.calendarId)! }
            : {}),
          ...(editing.base === undefined ? {} : { base: editing.base }),
        },
        {
          now: Date.now(),
          uid: made.next,
        },
      ).then(
        () => {
          // The occurrence saved: where the form put it, in the series it is
          // in now (a split's "this and following" is a new one).
          const uid = !target || scope === "following" ? made.first() : target.item.uid;
          const { allDay, startDate, startTime, zone } = state.form;
          setLanded(
            uid ? { uid, at: allDay ? startDate : `${startDate}T${startTime}`, zone } : null,
          );
          setEditing(null);
          setDetails(null);
          onChanged();
        },
        (error: unknown) => {
          // Gone meanwhile, or unclear whether it was saved: the user is told so (D99).
          const failure = saveFailureOf(error);
          setEditing(
            (current) =>
              current && {
                ...current,
                // In the words of what was saved, whatever the form says now.
                state: {
                  ...current.state,
                  saving: false,
                  problem: failure,
                  problemKind: state.form.kind,
                },
              },
          );
        },
      );
    };
    const scopes = scopesFor(target, initial, state.form, rightsOf(byId(state.form.calendarId)));
    // Only a split could save it, and its calendar takes no new items (D37).
    if (scopes === null)
      setEditing({
        ...editing,
        state: { ...state, problem: "noSplit", problemKind: state.form.kind },
      });
    else if (scopes.length === 0) run("all");
    else setAsking({ action: "edit", kind: state.form.kind, scopes, run });
  };

  /**
   * Quick create becomes the edit dialog, every field as it is (design
   * D296); the click that opened it is long past.
   */
  const expand = () =>
    setEditing((current) => {
      if (!current?.quick) return current;
      const { opener: _opener, ...state } = current.state;
      return { ...current, quick: false, state };
    });

  const edit = () => {
    if (!details) return;
    const form = formOf(details, timeZone, today);
    setEditing({
      target: details,
      initial: form,
      state: { existing: true, form, problem: null, saving: false },
    });
  };

  const writes = () => ({ now: Date.now(), uid: () => crypto.randomUUID() });

  // What an action whose code loads later finds when it arrives (D145).
  const fresh = useRef({ details, calendars, hidden, timeZone, today });
  useEffect(() => {
    fresh.current = { details, calendars, hidden, timeZone, today };
  });

  /** "Make a copy" (design D164): saved at once, then a notice that opens it. */
  const copy = () => {
    if (!details) return;
    const target = details;
    setDetails(null);
    setNotice(null);
    copying()
      .then(({ saveCopy }) => saveCopy(store, target, writes()))
      .then(
        (made) => {
          setCopied(made);
          onChanged();
        },
        (error: unknown) => {
          const told = noticeOf(error, "change");
          if (told === "failed") console.error(error);
          setCopied(null);
          setNotice(told);
        },
      );
  };

  /** "Copy to" (design D164): the edit dialog for a new item, every field this one's. */
  const copyTo = () => {
    if (!details) return;
    // One notice at a time, and none over the dialog: its Open would leave it.
    setNotice(null);
    setCopied(null);
    const target = details;
    copying().then(
      ({ copyToForm }) => {
        // The code came later: the details may be another item's now, or
        // closed; the calendars as they are now.
        const now = fresh.current;
        const same =
          now.details?.objectId === target.objectId &&
          JSON.stringify(now.details.recurrenceId) === JSON.stringify(target.recurrenceId);
        if (!same || !now.details) return;
        const { ics, form: initial } = copyToForm(now.details, now.calendars, now.hidden, {
          timeZone: now.timeZone,
          today: now.today,
          writes: writes(),
        });
        setEditing({
          target: null,
          initial,
          base: ics,
          state: { existing: false, copy: true, form: initial, problem: null, saving: false },
        });
      },
      (error: unknown) => {
        console.error(error);
        setNotice("failed");
      },
    );
  };

  const remove = () => {
    if (!details) return;
    const target = details;
    setAsking({
      action: "delete",
      kind: target.item.kind,
      scopes: isOccurrence(target) ? deleteScopes(target, rightsOf(byId(target.calendarId))) : [],
      run: (scope) => {
        setDetails(null);
        write(deleteTarget(store, target, scope, Date.now()), "delete");
      },
    });
  };

  const complete = (from: Element) => {
    if (!details || details.item.kind !== "task") return;
    const { object, recurrenceId, item } = details;
    const seriesDone = object.master !== null && isDone(object.master);
    const done = seriesDone || isDone(item);
    if (!done) celebrate(from);
    rewrite(details, (current) =>
      completeTask(current, !done, {
        now: Date.now(),
        recurrenceId: seriesDone ? null : recurrenceId,
      }),
    );
  };

  const star = () => {
    if (!details) return;
    const starred = details.object.master?.kind === "task" && details.object.master.starred;
    rewrite(details, (current) => starTask(current, !starred, Date.now()));
  };

  const calendar = byId(details?.calendarId);
  // A new item's field shows where it goes now (`newItemCalendar`, the save's
  // own rule): its calendar while there, kept in the field even once it no
  // longer takes the item; else the first that takes it (foundation D122).
  // A new item (not a copy) while new items go to every account on a
  // server: no row for where it goes at all (D314).
  const everyMode = toEvery && editing !== null && editing.target === null && !editing.base;
  // Where the new item goes now, the save's own rule (D122, D313, D314):
  // going to every account, a calendar that no longer takes it gives way,
  // as there is no row to pick again in; none, the dialog says so.
  const shown =
    editing && editing.target === null
      ? newItemCalendar(
          calendars,
          everyMode ? { ...editing.state.form, alsoIn: [] } : editing.state.form,
          hidden,
          everyMode ? servers : undefined,
          knownAccounts.current.get(editing.state.form.calendarId),
        )
      : null;
  // Gone from the account chosen, no file of that one's own goes with it,
  // and the dialog shows them gone (foundation D232).
  const shownForm =
    editing && shown
      ? {
          ...editing.state.form,
          calendarId: shown.calendar.id,
          ...(shown.moved && editing.state.form.attachments
            ? {
                attachments: editing.state.form.attachments.filter(
                  (file) => file.kind === "existing" || goesToEveryCopy(file.attachment),
                ),
              }
            : {}),
        }
      : null;
  const shownState =
    editing && shownForm ? { ...editing.state, form: shownForm } : (editing?.state ?? null);
  const offered = editing ? writable(editing.state.form.kind, fromOf(editing)) : [];
  const shownCalendars = shown?.refused ? [shown.calendar, ...offered] : offered;
  // Each account offered, with where choosing it puts the item (D313): an
  // existing item's own calendar in its own account, else the account's
  // first calendar that takes it, visible before hidden. In the accounts'
  // own order, as the drawer and Settings list them.
  const from = editing ? fromOf(editing) : undefined;
  const accountChoices: AccountChoice[] = accounts.flatMap((account) => {
    const all = shownCalendars.filter((one) => one.accountId === account.id);
    // A calendar that refuses the item is where its account leads only when it has no other.
    const own = all.filter((one) => !(shown?.refused && one.id === shown.calendar.id));
    const first =
      own.find((one) => one.id === from?.id) ??
      own.find((one) => !hidden.has(one.id)) ??
      own[0] ??
      all[0];
    return first ? [{ account, calendarId: first.id }] : [];
  });
  // A new item (not a copy) may be ticked into several calendars (D313).
  const multiple = editing !== null && editing.target === null && !editing.base;

  const dialogs = (
    <>
      <ItemDetails
        // Hidden while its item is edited, so the draft behind shows (design
        // D155); back when the edit dialog goes.
        target={editing ? null : details}
        calendar={calendar}
        color={details ? colorOf(details) : ""}
        related={related}
        onClose={() => setDetails(null)}
        onEdit={edit}
        onDelete={remove}
        onCopy={copy}
        onCopyTo={copyTo}
        canCopyTo={details !== null && writable(details.item.kind).length > 0}
        onComplete={complete}
        onStar={star}
        onCopyFailed={() => setNotice("copyFailed")}
      />
      <QuickCreate
        state={editing?.quick ? shownState : null}
        calendars={shownCalendars}
        accounts={accountChoices}
        showWhere={!everyMode || shownCalendars.length === 0}
        multiple={multiple}
        onChange={change}
        onDraft={setDraft}
        onSave={save}
        onClose={() => setEditing(null)}
        onExpand={expand}
      />
      <ItemEditor
        state={editing?.quick ? null : shownState}
        target={editing?.target ?? null}
        calendars={shownCalendars}
        accounts={accountChoices}
        showWhere={!everyMode || shownCalendars.length === 0}
        multiple={multiple}
        onChange={change}
        onDraft={setDraft}
        onSave={save}
        onClose={() => setEditing(null)}
      />
      <ScopeDialog request={asking} onClose={() => setAsking(null)} />
      <ChangeNotice notice={notice} onClose={() => setNotice(null)} />
      <CopyNotice
        copied={copied}
        onOpen={(target) => {
          setCopied(null);
          setDetails(target);
        }}
        onClose={() => setCopied(null)}
      />
    </>
  );
  // Gone with the dialog, whether or not the editor said so yet.
  return {
    value,
    dialogs,
    draft: editing ? draft : null,
    landed,
    onLanded: () => setLanded(null),
  };
}
