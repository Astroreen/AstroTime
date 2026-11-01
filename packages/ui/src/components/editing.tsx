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
import type { Calendar, Store, StoredObject } from "@astrotime/storage";
import { createContext, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  calendarsFor,
  deleteScopes,
  deleteTarget,
  followed,
  formOf,
  GoneError,
  InDoubtError,
  isOccurrence,
  itemOf,
  newForm,
  noticeOf,
  problemOf,
  saveChanges,
  rewriteTarget,
  saveForm,
  scopesFor,
  scopesForTimes,
  type Form,
  type Notice,
  type Target,
} from "../calendar/editing.ts";
import { liveQuery } from "../calendar/live.ts";
import { rightsOf } from "../calendar/rights.ts";
import { ChangeNotice } from "./change-notice.tsx";
import { ItemDetails } from "./item-details.tsx";
import type { EditorState } from "./item-editor.tsx";
import { ItemEditor } from "./lazy.tsx";
import { ScopeDialog, type ScopeRequest } from "./scope-dialog.tsx";

interface CreateOptions {
  /** The day it is on; `null`: an undated task. */
  readonly day: string | null;
  /** Minutes past midnight of a tapped slot of the time grid. */
  readonly at?: number;
  /** Minutes it lasts, a press dragged over the grid; an hour by default. */
  readonly length?: number;
  /** The calendar (a task list) it goes in; the first that takes new items by default. */
  readonly calendarId?: string;
}

/** How a move or a resize ended (design D111): written, nothing to write, or why not. */
export type Rescheduled = "saved" | "unchanged" | "cancelled" | "gone" | "inDoubt" | "failed";

export interface EditingValue {
  /** Shows an item's details. */
  open(target: Target): void;
  /** Opens the edit dialog for a new item. */
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
   * store holds now, telling the user when it did not land.
   */
  rewrite(target: Target, ics: (object: CalendarObject) => string): void;
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

interface Editing {
  readonly target: Target | null;
  readonly initial: Form | null;
  readonly state: EditorState;
}

export function useEditingState({
  store,
  calendars,
  hidden,
  timeZone,
  minutes,
  colorOf,
  onChanged,
}: {
  store: Store;
  calendars: readonly Calendar[];
  /** Calendars hidden from the views: a new item goes in a visible one first. */
  hidden: ReadonlySet<string>;
  timeZone: string;
  minutes: number;
  colorOf: (target: Target) => string;
  /** A local change was written: the sync scheduler sends it soon (D91). */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [details, setDetails] = useState<Target | null>(null);
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
      store,
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
  // A new item goes where new items may; an existing one stays, or moves where its own lets it (D37).
  const writable = (kind: "event" | "task", from?: Calendar) => calendarsFor(calendars, kind, from);
  const firstFor = (kind: "event" | "task") => {
    const list = writable(kind);
    return (list.find((c) => !hidden.has(c.id)) ?? list[0])?.id ?? null;
  };
  /** The calendar the item being edited was in; none for a new item. */
  const fromOf = (current: Editing) => byId(current.initial?.calendarId);

  const [notice, setNotice] = useState<Notice | null>(null);
  /** A change made outside the edit dialog; the user is told when it did not land (D99). */
  const write = (work: Promise<unknown>, action: "change" | "delete" = "change") => {
    setNotice(null);
    void work.then(onChanged, (error: unknown) => {
      const told = noticeOf(error, action);
      if (told === null) return onChanged();
      if (told === "failed" || told === "deleteFailed") console.error(error);
      setNotice(told);
    });
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
      const form = newForm(actual, {
        calendarId,
        day: options.day,
        minutes,
        timeZone,
        ...(options.at === undefined ? {} : { at: options.at }),
        ...(options.length === undefined ? {} : { length: options.length }),
      });
      setEditing({
        target: null,
        initial: null,
        state: { existing: false, form, problem: null, saving: false },
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
      // A kind its calendar cannot hold moves to the first calendar that can.
      const fits = writable(form.kind, fromOf(current)).some((c) => c.id === form.calendarId);
      const next = fits ? form : { ...form, calendarId: firstFor(form.kind) ?? form.calendarId };
      // A rule moves with the item's day (D105).
      const moved = followed(current.state.form, next);
      return { ...current, state: { ...current.state, form: moved, problem: null } };
    });

  const save = () => {
    if (!editing) return;
    const { target, initial } = editing;
    // A new item whose calendar went while the dialog was open (the calendar
    // on this device stepping aside, foundation D122) goes where the dialog
    // shows it going: the first calendar that takes it.
    const stays = writable(editing.state.form.kind).some(
      (c) => c.id === editing.state.form.calendarId,
    );
    const state =
      target === null && !stays
        ? {
            ...editing.state,
            form: {
              ...editing.state.form,
              calendarId: firstFor(editing.state.form.kind) ?? editing.state.form.calendarId,
            },
          }
        : editing.state;
    const problem = problemOf(state.form, initial);
    if (problem) {
      setEditing({ ...editing, state: { ...state, problem } });
      return;
    }
    const run = (scope: "this" | "following" | "all") => {
      setEditing((current) => current && { ...current, state: { ...current.state, saving: true } });
      saveForm(
        store,
        { target, initial, form: state.form, scope, untitled: t("edit.untitledReminder") },
        {
          now: Date.now(),
          uid: () => crypto.randomUUID(),
        },
      ).then(
        () => {
          setEditing(null);
          setDetails(null);
          onChanged();
        },
        (error: unknown) => {
          // Gone meanwhile, or unclear whether it was saved: the user is told so (D99).
          const failure = failureOf(error);
          setEditing(
            (current) =>
              current && {
                ...current,
                state: { ...current.state, saving: false, problem: failure },
              },
          );
        },
      );
    };
    const scopes = scopesFor(target, initial, state.form, rightsOf(byId(state.form.calendarId)));
    // Only a split could save it, and its calendar takes no new items (D37).
    if (scopes === null) setEditing({ ...editing, state: { ...state, problem: "noSplit" } });
    else if (scopes.length === 0) run("all");
    else setAsking({ action: "edit", kind: state.form.kind, scopes, run });
  };

  const edit = () => {
    if (!details) return;
    const form = formOf(details, timeZone);
    setEditing({
      target: details,
      initial: form,
      state: { existing: true, form, problem: null, saving: false },
    });
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

  const complete = () => {
    if (!details || details.item.kind !== "task") return;
    const { object, recurrenceId, item } = details;
    const seriesDone = object.master !== null && isDone(object.master);
    const done = seriesDone || isDone(item);
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
  const dialogs = (
    <>
      <ItemDetails
        target={details}
        calendar={calendar}
        color={details ? colorOf(details) : ""}
        related={related}
        onClose={() => setDetails(null)}
        onEdit={edit}
        onDelete={remove}
        onComplete={complete}
        onStar={star}
      />
      <ItemEditor
        state={editing?.state ?? null}
        calendars={editing ? writable(editing.state.form.kind, fromOf(editing)) : []}
        onChange={change}
        onSave={save}
        onClose={() => setEditing(null)}
      />
      <ScopeDialog request={asking} onClose={() => setAsking(null)} />
      <ChangeNotice notice={notice} onClose={() => setNotice(null)} />
    </>
  );
  return { value, dialogs };
}
