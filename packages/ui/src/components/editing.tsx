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
  type Task,
} from "@astrotime/core";
import type { Calendar, Store, StoredObject } from "@astrotime/storage";
import { createContext, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  changeLocal,
  deleteTarget,
  followed,
  formOf,
  GoneError,
  InDoubtError,
  isOccurrence,
  itemOf,
  newForm,
  problemOf,
  saveForm,
  scopesFor,
  writableFor,
  type Form,
  type Target,
} from "../calendar/editing.ts";
import { liveQuery } from "../calendar/live.ts";
import { ItemDetails } from "./item-details.tsx";
import { ItemEditor, type EditorState } from "./item-editor.tsx";
import { ScopeDialog, type ScopeRequest } from "./scope-dialog.tsx";

interface CreateOptions {
  /** The day it is on; `null`: an undated task. */
  readonly day: string | null;
  /** Minutes past midnight of a tapped slot of the time grid. */
  readonly at?: number;
  /** The calendar (a task list) it goes in; the first writable one by default. */
  readonly calendarId?: string;
}

export interface EditingValue {
  /** Shows an item's details. */
  open(target: Target): void;
  /** Opens the edit dialog for a new item. */
  create(kind: "event" | "task", options: CreateOptions): void;
  /** Whether any calendar can take a new item. */
  readonly canCreate: boolean;
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

  const writable = (kind: "event" | "task") => writableFor(calendars, kind);
  const firstFor = (kind: "event" | "task") => {
    const list = writable(kind);
    return (list.find((c) => !hidden.has(c.id)) ?? list[0])?.id ?? null;
  };

  const write = (work: Promise<unknown>) =>
    work.then(onChanged, (error: unknown) => console.error(error));

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
      });
      setEditing({
        target: null,
        initial: null,
        state: { existing: false, form, problem: null, saving: false },
      });
    },
    canCreate: writable("event").length > 0 || writable("task").length > 0,
  };

  const change = (form: Form) =>
    setEditing((current) => {
      if (!current) return current;
      // A kind its calendar cannot hold moves to the first calendar that can.
      const fits = writable(form.kind).some((c) => c.id === form.calendarId);
      const next = fits ? form : { ...form, calendarId: firstFor(form.kind) ?? form.calendarId };
      // A rule moves with the item's day (D105).
      const moved = followed(current.state.form, next);
      return { ...current, state: { ...current.state, form: moved, problem: null } };
    });

  const save = () => {
    if (!editing) return;
    const { target, initial, state } = editing;
    const problem = problemOf(state.form);
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
          const failure =
            error instanceof GoneError
              ? "gone"
              : error instanceof InDoubtError
                ? "inDoubt"
                : "failed";
          if (failure === "failed") console.error(error);
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
    const scopes = scopesFor(target, initial, state.form);
    if (scopes.length === 0) run("all");
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
      scopes: isOccurrence(target) ? ["this", "following", "all"] : [],
      run: (scope) => {
        setDetails(null);
        void write(deleteTarget(store, target, scope, Date.now()));
      },
    });
  };

  const rewrite = (target: Target, ics: (object: CalendarObject) => string) =>
    changeLocal(store, async (local) => {
      const row = await local.object(target.objectId);
      if (!row) return;
      await local.save(row.calendarId, ics(CalendarObject.parse(row.ics)), row.href);
    });

  const complete = () => {
    if (!details || details.item.kind !== "task") return;
    const { object, recurrenceId, item } = details;
    const seriesDone = object.master !== null && isDone(object.master);
    const done = seriesDone || isDone(item);
    void write(
      rewrite(details, (current) =>
        completeTask(current, !done, {
          now: Date.now(),
          recurrenceId: seriesDone ? null : recurrenceId,
        }),
      ),
    );
  };

  const star = () => {
    if (!details) return;
    const starred = details.object.master?.kind === "task" && details.object.master.starred;
    void write(rewrite(details, (current) => starTask(current, !starred, Date.now())));
  };

  const calendar = details ? calendars.find((c) => c.id === details.calendarId) : undefined;
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
        calendars={editing ? writable(editing.state.form.kind) : []}
        onChange={change}
        onSave={save}
        onClose={() => setEditing(null)}
      />
      <ScopeDialog request={asking} onClose={() => setAsking(null)} />
    </>
  );
  return { value, dialogs };
}
