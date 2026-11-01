// The reminders the platform shows (docs/plans/foundation.md#D101): the set
// is worked out from the local store and handed to the platform whole
// (`ReminderScheduler.schedule` replaces the one before) on start, after
// every write to the store (a sync's, or a change made here), when the day
// rolls over, and when the last of a full set has fired.
import {
  MAX_REMINDERS,
  type Reminder,
  type ReminderScheduler,
  type ScheduledReminder,
  REMINDER_GRACE_MS,
  soonestReminders,
  zonedToEpoch,
} from "@astrotime/core";
import type { Store } from "@astrotime/storage";

import { addDays, nowIn } from "../calendar/dates.ts";
import { liveQuery } from "../calendar/live.ts";

/** What the planner needs of time; the browser's by default, a fake in tests. */
export interface PlannerClock {
  now(): number;
  /** Calls `run` once after `ms`; returns the function that cancels it. */
  after(ms: number, run: () => void): () => void;
}

export function browserClock(): PlannerClock {
  return {
    now: () => Date.now(),
    after(ms, run) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  };
}

/** The notification's words for a reminder, in the user's language. */
export type Notification = (reminder: Reminder) => ScheduledReminder["notification"];

export class ReminderPlanner {
  readonly #store: Store;
  readonly #scheduler: ReminderScheduler;
  #timeZone: string;
  readonly #clock: PlannerClock;
  readonly #onSet: (set: readonly ScheduledReminder[]) => void;
  #stop: (() => void) | null = null;
  #cancelRefresh: (() => void) | null = null;

  constructor(options: {
    store: Store;
    scheduler: ReminderScheduler;
    timeZone: string;
    clock: PlannerClock;
    /** Hears each set once the platform has it (the setting names the next reminder). */
    onSet?: (set: readonly ScheduledReminder[]) => void;
  }) {
    this.#store = options.store;
    this.#scheduler = options.scheduler;
    this.#timeZone = options.timeZone;
    this.#clock = options.clock;
    this.#onSet = options.onSet ?? (() => {});
  }

  /**
   * Keeps the platform's set with these words; `null` turns reminders off,
   * which hands the platform an empty set. A new `timeZone` (the user's
   * changed while the app is open) places dates and midnight there from now on.
   */
  update(notification: Notification | null, timeZone = this.#timeZone): void {
    this.stop();
    this.#timeZone = timeZone;
    if (!notification) {
      this.#schedule([]);
      return;
    }
    this.#stop = liveQuery(
      this.#store,
      () => this.#compute(notification),
      ({ set, refreshAt }) => {
        this.#schedule(set);
        this.#cancelRefresh?.();
        this.#cancelRefresh = this.#clock.after(Math.max(0, refreshAt - this.#clock.now()), () =>
          this.update(notification),
        );
      },
    );
  }

  /** Stops following the store; the platform keeps the set it has. */
  stop(): void {
    this.#stop?.();
    this.#stop = null;
    this.#cancelRefresh?.();
    this.#cancelRefresh = null;
  }

  #compute(notification: Notification) {
    return reminderSet(this.#store, this.#clock.now(), this.#timeZone, notification);
  }

  #schedule(set: readonly ScheduledReminder[]): void {
    try {
      void Promise.resolve(this.#scheduler.schedule(set)).catch((error: unknown) =>
        console.error(error),
      );
    } catch (error) {
      console.error(error);
    }
    this.#onSet(set);
  }
}

/**
 * The set the platform is handed at `now`, and when it needs computing
 * again: the next midnight in `timeZone`, or once the last of a full set has
 * fired. The open app's planner and a shell's headless run
 * (docs/plans/android.md#D67) hand over the same one.
 */
export async function reminderSet(
  store: Store,
  now: number,
  timeZone: string,
  notification: Notification,
): Promise<{ set: ScheduledReminder[]; refreshAt: number }> {
  const { today } = nowIn(now, timeZone);
  // Whole days in the user's zone, so the store's computation is kept for
  // the day; the set itself starts now and reaches 7 days ahead.
  // From yesterday, so the hour back crosses midnight too.
  const all = await store.reminders({
    from: addDays(today, -1),
    to: addDays(today, 8),
    timeZone,
  });
  // New objects: the store keeps the reminders it computed.
  // An hour back too: a reminder missed in a sleep, which the platform
  // shows within its own grace, is not lost to a set computed on waking.
  const set = soonestReminders(all, now, { backMs: REMINDER_GRACE_MS }).map(
    (reminder): ScheduledReminder =>
      Object.assign({}, reminder, { notification: notification(reminder) }),
  );
  // Tomorrow the horizon reaches a day further; a full set needs its next
  // reminders once its last one has fired.
  const midnight = zonedToEpoch(`${addDays(today, 1)}T00:00:00`, timeZone);
  const ahead = set.filter((reminder) => reminder.fireAt >= now);
  const last = ahead.length === MAX_REMINDERS ? ahead.at(-1)!.fireAt + 1 : Infinity;
  return { set, refreshAt: Math.min(midnight, last) };
}
