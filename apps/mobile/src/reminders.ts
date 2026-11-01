// Android's reminders (docs/plans/android.md#D66): local notifications through
// `@capacitor/local-notifications`, which Android holds as alarms, so they
// fire with the app closed, and the plugin's boot receiver arms again after a
// reboot. Each set is diffed against what was scheduled: what left it is
// cancelled, what is new or moved is scheduled. Every reminder has an integer
// id allocated from a counter and kept with its stable id in the app's
// preferences, never a hash, so no two reminders share one.
import type { ReminderPermission, ReminderScheduler, ScheduledReminder } from "@astrotime/core";
import type { Preferences } from "@astrotime/ui";

/**
 * A reminder already past when it first reaches Android (an item synced in
 * late) still shows if it is this late at most; an older one is dropped. One
 * handed over in time has fired already, from Android's alarm.
 */
export const LATE_MS = 5 * 60_000;
/** Later than this, one shown at once says when it was due (`notification.late`), as the desktop's does. */
const ON_TIME_MS = 60_000;

/** The channel the app creates for reminders (`MainActivity`), its name in the system's language. */
export const CHANNEL = "reminders";

/** Where the ids and what was scheduled are kept, in the app's preferences. */
export const KEPT_KEY = "astrotime.reminders";

/** Android's notification ids are Java `int`s; the counter wraps before the largest. */
const MAX_ID = 2_147_483_647;

/** A permission as the plugin says it. */
type NativePermission = "granted" | "denied" | "prompt" | "prompt-with-rationale";

/** One notification as the plugin takes it (`LocalNotificationSchema`, the fields used here). */
export interface NativeNotification {
  id: number;
  title: string;
  body: string;
  largeBody: string;
  channelId: string;
  /** No `schedule`: shown at once. */
  schedule?: { at: Date; allowWhileIdle: true };
  /** Exact (the default) or not, where the system has taken exact alarms away. */
  isExactNotification: boolean;
  /** Comes back with a tap. */
  extra: { reminder: ScheduledReminder };
}

/** What the adapter uses of `@capacitor/local-notifications`. */
export interface NativeNotifications {
  checkPermissions(): Promise<{ display: NativePermission }>;
  requestPermissions(): Promise<{ display: NativePermission }>;
  checkExactNotificationSetting(): Promise<{ exact_alarm: NativePermission }>;
  schedule(options: { notifications: NativeNotification[] }): Promise<unknown>;
  cancel(options: { notifications: { id: number }[] }): Promise<void>;
  addListener(
    event: "localNotificationActionPerformed",
    listener: (action: { notification: { extra?: unknown } }) => void,
  ): Promise<unknown>;
}

/** What is kept between runs: the next id, each scheduled reminder's, and whether the app asked. */
interface Kept {
  next: number;
  asked: boolean;
  scheduled: Record<string, Entry>;
}

/** A reminder handed to Android: its id, and what it was handed with, to tell a change. */
interface Entry {
  id: number;
  /** `null` when scheduling it failed: the next set schedules it again under the same id. */
  fireAt: number | null;
  title: string;
  body: string;
}

function readKept(preferences: Preferences): Kept {
  try {
    const kept = JSON.parse(preferences.get(KEPT_KEY) ?? "null") as Kept | null;
    if (
      kept &&
      Number.isInteger(kept.next) &&
      typeof kept.scheduled === "object" &&
      kept.scheduled !== null &&
      !Array.isArray(kept.scheduled) &&
      Object.values(kept.scheduled).every((entry) => Number.isInteger(entry?.id))
    ) {
      return { ...kept, asked: kept.asked === true };
    }
  } catch {
    // Unreadable: start again; ids already handed out are lost with it.
  }
  return { next: 1, asked: false, scheduled: {} };
}

const permissionOf = (state: NativePermission): ReminderPermission =>
  state === "granted" ? "granted" : state === "denied" ? "denied" : "default";

/**
 * Android's `ReminderScheduler`. `onResume` hears the app come to the front,
 * when the permissions may have changed in the system's settings.
 */
export function androidReminders(options: {
  native: NativeNotifications;
  preferences: Preferences;
  now?: () => number;
  onResume?: (listener: () => void) => void;
}): ReminderScheduler {
  const { native, preferences, now = () => Date.now() } = options;
  let kept = readKept(preferences);
  let permission: ReminderPermission = "default";
  let exact = true;
  // The first set of a run arms every reminder ahead again: alarms do not
  // survive the app being force-stopped, updated or its exact alarms revoked.
  let armed = false;
  let pending: readonly ScheduledReminder[] | null = null;
  let queue = Promise.resolve();
  const permissionListeners = new Set<() => void>();
  const openListeners = new Set<(reminder: ScheduledReminder) => void>();
  // A tap that started the app, before the UI listens.
  let tapped: ScheduledReminder | null = null;

  const save = () => preferences.set(KEPT_KEY, JSON.stringify(kept));

  const allocate = (): number => {
    const used = new Set(Object.values(kept.scheduled).map((entry) => entry.id));
    let id = kept.next;
    while (used.has(id)) id = id >= MAX_ID ? 1 : id + 1;
    kept.next = id >= MAX_ID ? 1 : id + 1;
    return id;
  };

  // Each read of the permissions counts, so an answer older than another is not kept.
  let reads = 0;
  const update = (next: { permission?: ReminderPermission; exact?: boolean }) => {
    const changed =
      (next.permission ?? permission) !== permission || (next.exact ?? exact) !== exact;
    permission = next.permission ?? permission;
    exact = next.exact ?? exact;
    if (changed) for (const listener of permissionListeners) listener();
  };

  /** Reads both permissions; tells the UI when either changed. */
  const refresh = async () => {
    const read = ++reads;
    const [{ display }, { exact_alarm }] = await Promise.all([
      native.checkPermissions(),
      native.checkExactNotificationSetting(),
    ]);
    if (read === reads)
      update({ permission: permissionOf(display), exact: exact_alarm === "granted" });
  };

  /** Asks the user; the answer outranks any read still on its way. */
  const request = async (): Promise<ReminderPermission> => {
    kept.asked = true;
    save();
    const { display } = await native.requestPermissions();
    reads++;
    update({ permission: permissionOf(display) });
    return permission;
  };

  const apply = async (set: readonly ScheduledReminder[]) => {
    await refresh();
    const at = now();
    // Android asks once by itself, the first time there is a reminder to
    // schedule (D66); after that it is the setting's switch that asks.
    if (permission === "default" && !kept.asked && set.some((r) => r.fireAt >= at)) await request();
    // The plugin would ask on every set without the permission.
    if (permission !== "granted") return;

    const ids = new Set(set.map((reminder) => reminder.id));
    const gone: number[] = [];
    // Forgotten only once Android cancelled them: a failed cancel is tried again.
    const forget: string[] = [];
    for (const [id, entry] of Object.entries(kept.scheduled)) {
      if (ids.has(id)) continue;
      gone.push(entry.id);
      forget.push(id);
    }
    const notifications: NativeNotification[] = [];
    for (const reminder of set) {
      const entry = kept.scheduled[reminder.id];
      const { title, body } = reminder.notification;
      const past = reminder.fireAt < at;
      // Handed over for a time now passed: it has fired, and is never shown twice.
      const fired = entry !== undefined && entry.fireAt !== null && entry.fireAt < at;
      if (past) {
        if (fired) continue;
        // Missed by more than the grace: dropped, and an alarm for a later time it had, cancelled.
        if (at - reminder.fireAt > LATE_MS) {
          if (entry) {
            gone.push(entry.id);
            forget.push(reminder.id);
          }
          continue;
        }
      } else {
        const same =
          entry?.fireAt === reminder.fireAt && entry.title === title && entry.body === body;
        if (same && armed) continue;
      }
      // One that fired and moved ahead gets an id of its own, so the
      // notification already shown stays until the user dismisses it.
      const id = entry && !fired ? entry.id : allocate();
      kept.scheduled[reminder.id] = { id, fireAt: reminder.fireAt, title, body };
      const shown =
        past && at - reminder.fireAt > ON_TIME_MS ? (reminder.notification.late ?? body) : body;
      notifications.push({
        id,
        title,
        body: shown,
        largeBody: shown,
        channelId: CHANNEL,
        ...(past ? {} : { schedule: { at: new Date(reminder.fireAt), allowWhileIdle: true } }),
        isExactNotification: exact,
        extra: { reminder },
      });
    }
    armed = true;
    // Kept before Android has them: an id once handed out is never handed out again.
    save();
    // A delivered notification stays on the screen: cancelling only stops what is still to come.
    if (gone.length > 0) {
      await native.cancel({ notifications: gone.map((id) => ({ id })) });
      for (const id of forget) delete kept.scheduled[id];
      save();
    }
    if (notifications.length === 0) return;
    try {
      await native.schedule({ notifications });
    } catch (error) {
      for (const { extra } of notifications) {
        const entry = kept.scheduled[extra.reminder.id];
        if (entry) entry.fireAt = null;
      }
      save();
      throw error;
    }
  };

  const open = (reminder: ScheduledReminder) => {
    if (openListeners.size === 0) tapped = reminder;
    for (const listener of openListeners) listener(reminder);
  };
  void native
    .addListener("localNotificationActionPerformed", ({ notification }) => {
      const reminder = (notification.extra as { reminder?: ScheduledReminder } | undefined)
        ?.reminder;
      if (reminder && typeof reminder.id === "string") open(reminder);
    })
    .catch((error: unknown) => console.error(error));

  void refresh().catch((error: unknown) => console.error(error));
  options.onResume?.(() => void refresh().catch((error: unknown) => console.error(error)));

  return {
    schedule(set) {
      // One set at a time, the latest: a burst of writes costs one more run.
      pending = set;
      const run = queue.then(async () => {
        const next = pending;
        pending = null;
        if (next) await apply(next);
      });
      queue = run.catch(() => {});
      return run;
    },
    onOpen(listener) {
      openListeners.add(listener);
      if (tapped) {
        const reminder = tapped;
        tapped = null;
        listener(reminder);
      }
      return () => openListeners.delete(listener);
    },
    permission: () => permission,
    requestPermission: request,
    whileOpenOnly: false,
    asksWhenNeeded: true,
    native: true,
    inexact: () => !exact,
    onPermissionChange(listener) {
      permissionListeners.add(listener);
      return () => permissionListeners.delete(listener);
    },
  };
}
