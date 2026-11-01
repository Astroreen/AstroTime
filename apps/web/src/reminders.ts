// The web's reminders (docs/plans/foundation.md#D101): the Notifications API,
// while AstroTime is open in a tab. One tab shows them, the one holding the
// `astrotime-reminders` Web Lock, so several tabs never notify twice; the
// others wait in the lock's queue and take over when it closes. The browser
// asks the permission only when the user turns the setting on.
import type { ReminderPermission, ReminderScheduler, ScheduledReminder } from "@astrotime/core";

/**
 * A reminder missed by up to this much still shows: a hidden tab's timers
 * run once a minute, and a laptop may wake just after. An older one would
 * only say something stale, and is dropped.
 */
export const LATE_MS = 5 * 60_000;

/** The Web Lock the tab that shows reminders holds. */
const REMINDERS_LOCK = "astrotime-reminders";

/** The longest `setTimeout` browsers keep (about 24.8 days); a longer wait is armed again. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/** A notification on the screen. */
export interface Shown {
  addEventListener(type: "click", listener: () => void): void;
  close(): void;
}

/** The parts of the Notifications API used here. */
interface Notifications {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  show(title: string, options: { body: string; tag: string }): Shown;
}

/** What the reminders need of the page; the browser's by default, a fake in tests. */
export interface ReminderPage {
  now(): number;
  /** Calls `run` once after `ms`; returns the function that cancels it. */
  after(ms: number, run: () => void): () => void;
  /** Calls `listener` when the tab is in front again, its timers maybe asleep meanwhile. */
  onWake(listener: () => void): () => void;
  /** Calls `granted` once this tab holds the reminders' lock; it keeps it while it lives. */
  lead(granted: () => void): void;
  /** `null` where the browser has no Notifications API. */
  readonly notifications: Notifications | null;
  /** Brings the tab to the front. */
  focus(): void;
}

function browserReminderPage(): ReminderPage {
  return {
    now: () => Date.now(),
    after(ms, run) {
      const timer = setTimeout(run, Math.min(ms, MAX_TIMEOUT_MS));
      return () => clearTimeout(timer);
    },
    onWake(listener) {
      const onVisible = () => {
        if (document.visibilityState === "visible") listener();
      };
      document.addEventListener("visibilitychange", onVisible);
      // A frozen tab thawed (the Page Lifecycle API), and one back from the bfcache.
      document.addEventListener("resume", listener);
      window.addEventListener("pageshow", listener);
      window.addEventListener("focus", listener);
      return () => {
        document.removeEventListener("visibilitychange", onVisible);
        document.removeEventListener("resume", listener);
        window.removeEventListener("pageshow", listener);
        window.removeEventListener("focus", listener);
      };
    },
    lead(granted) {
      if (!("locks" in navigator)) {
        granted();
        return;
      }
      // Held until the tab closes: the promise never settles.
      navigator.locks
        .request(REMINDERS_LOCK, () => {
          granted();
          return new Promise<never>(() => {});
        })
        .catch((error: unknown) => console.error(error));
    },
    notifications:
      typeof Notification === "undefined"
        ? null
        : {
            get permission() {
              return Notification.permission;
            },
            requestPermission: () => Notification.requestPermission(),
            show: (title, options) => new Notification(title, options),
          },
    focus: () => window.focus(),
  };
}

/** The web's `ReminderScheduler` (docs/plans/android.md#D60). */
export function webReminders(page: ReminderPage = browserReminderPage()): ReminderScheduler {
  let set: readonly ScheduledReminder[] = [];
  let leading = false;
  let cancel: (() => void) | null = null;
  // Shown or dropped already, so a set handed over again never repeats one.
  /** Reminders already shown, or dropped as stale, by id and time: one moved later shows again. */
  const done = new Set<string>();
  const listeners = new Set<(reminder: ScheduledReminder) => void>();

  const show = (reminder: ScheduledReminder) => {
    const notifications = page.notifications;
    if (notifications?.permission !== "granted") return;
    try {
      // The tag is the reminder's id: the browser replaces, never stacks, one shown again.
      const shown = notifications.show(reminder.notification.title, {
        body: reminder.notification.body,
        tag: reminder.id,
      });
      shown.addEventListener("click", () => {
        page.focus();
        shown.close();
        for (const listener of listeners) listener(reminder);
      });
    } catch (error) {
      // Mobile browsers show notifications only through a service worker (foundation's Deferred).
      console.error(error);
    }
  };

  // Shows what is due, late by up to LATE_MS, drops what is older, and waits for the next.
  const arm = () => {
    cancel?.();
    cancel = null;
    if (!leading) return;
    const now = page.now();
    for (const reminder of set) {
      if (done.has(shownKey(reminder))) continue;
      if (reminder.fireAt > now) {
        cancel = page.after(reminder.fireAt - now, arm);
        return;
      }
      done.add(shownKey(reminder));
      if (now - reminder.fireAt <= LATE_MS) show(reminder);
    }
  };

  page.onWake(arm);
  page.lead(() => {
    leading = true;
    arm();
  });

  return {
    schedule(reminders) {
      set = reminders.toSorted((a, b) => a.fireAt - b.fireAt);
      const keys = new Set(set.map(shownKey));
      for (const key of done) if (!keys.has(key)) done.delete(key);
      arm();
    },
    onOpen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    permission: (): ReminderPermission => page.notifications?.permission ?? "unsupported",
    requestPermission: async (): Promise<ReminderPermission> =>
      page.notifications ? await page.notifications.requestPermission() : "unsupported",
    whileOpenOnly: true,
  };
}

const shownKey = (reminder: { readonly id: string; readonly fireAt: number }) =>
  `${reminder.id}@${reminder.fireAt}`;
