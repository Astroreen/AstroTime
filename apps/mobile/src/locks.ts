// The Web Locks the app's two WebViews share (docs/plans/android.md#D67):
// the open app's and background sync's headless one, on one origin, as a
// browser's tabs share them (docs/plans/foundation.md#D91).
import type { SyncLock } from "@astrotime/sync";

/** The web store's name (`webDriver`'s default), which both WebViews open. */
const STORE = "astrotime";

/** One sync of the store at a time: the web's lock, by the same name (apps/web's `tabsSyncLock`). */
export const syncLock: SyncLock = (work) =>
  navigator.locks.request(`astrotime-sync:${STORE}`, work);

/** One reminder set's diff at a time, over the ids kept in the preferences (`androidReminders`). */
export const remindersLock = <T>(work: () => Promise<T>): Promise<T> =>
  navigator.locks.request("astrotime-reminder-ids", work);
