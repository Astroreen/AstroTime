// "Changed by an assistant" (docs/plans/assistant.md#D311): every change made
// through MCP, kept in the store on this device with the item before and
// after. "Undo" puts the item back only while it is still the very object
// the assistant left: an edit by the user, or a sync bringing another's,
// is never overwritten.
import { sameObjects } from "@astrotime/core";
import type { AssistantChange, Store, StoredObject } from "@astrotime/storage";

/**
 * Whether an entry can be undone: `undoable` while the item is what the
 * assistant left, `changed` once it is not, `undone` once the user undid it.
 */
export type ChangeState = "undoable" | "changed" | "undone";

export interface LoggedChange extends AssistantChange {
  readonly state: ChangeState;
  /** The item as the store holds it now, to open; `null` when there is none. */
  readonly objectId: string | null;
}

/** The item an entry is about, as the store holds it now; a deletion not yet uploaded is none. */
const currentOf = (found: readonly StoredObject[]) => found[0] ?? null;

/**
 * Whether the item is still what the assistant left: the same text, or the
 * same items field for field, so a server that writes the object again in
 * its own way (Nextcloud) after the upload is no change (`sameObjects`,
 * bookkeeping aside).
 */
function stateOf(change: AssistantChange, current: StoredObject | null): ChangeState {
  if (change.undoneAt !== null) return "undone";
  const now = current?.ics ?? null;
  const left = change.afterIcs;
  const same = now === left || (now !== null && left !== null && sameObjects(now, left));
  return same ? "undoable" : "changed";
}

/** The log, the latest first, each entry with whether it can be undone now. */
export async function loggedChanges(store: Store): Promise<LoggedChange[]> {
  const changes = await store.assistantChanges();
  // Each calendar's items are read once, whatever the entries.
  const byCalendar = new Map<string, Set<string>>();
  for (const change of changes) {
    const uids = byCalendar.get(change.calendarId) ?? new Set();
    uids.add(change.uid);
    byCalendar.set(change.calendarId, uids);
  }
  const current = new Map<string, StoredObject>();
  for (const [calendarId, uids] of byCalendar) {
    for (const object of await store.withUids(calendarId, [...uids])) {
      current.set(`${calendarId} ${object.uid}`, object);
    }
  }
  return changes.map((change) => {
    const object = current.get(`${change.calendarId} ${change.uid}`) ?? null;
    // The rows are this read's own: each gets its state in place.
    return Object.assign(change, { state: stateOf(change, object), objectId: object?.id ?? null });
  });
}

/**
 * Undoes the entry `id` in one transaction: the item made again as it was
 * before (a deleted one with all its properties, foundation D7), or a
 * created one deleted. Only while nothing changed it since: otherwise
 * nothing is written, and the answer says so.
 */
export function undoChange(store: Store, id: string, now = Date.now()): Promise<ChangeState> {
  return store.changeLocal(async (local, log) => {
    const change = await log.get(id);
    if (!change) return "changed";
    const current = currentOf(await local.withUids(change.calendarId, [change.uid]));
    const state = stateOf(change, current);
    if (state !== "undoable") return state;
    if (change.beforeIcs === null) await local.delete(current!.id);
    else await local.save(change.calendarId, change.beforeIcs, current?.href);
    await log.undone(id, now);
    return "undone";
  });
}
