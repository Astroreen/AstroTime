// The desktop's reminders, the main process's half (docs/plans/desktop.md#D76):
// the page hands over the whole set (`ReminderScheduler.schedule`), and the
// main process arms a timer for the next one and shows each as a desktop
// notification, with the window closed too. Timers stand still while the
// machine sleeps, so the set is checked again on waking (`wake`): a reminder
// missed by up to an hour shows then, saying when it was due; an older one is
// dropped. Apart from Electron, so it is tested in Node with a fake clock.
import { REMINDER_GRACE_MS, type ScheduledReminder } from "@astrotime/core";

/** A reminder missed by up to this much still shows, late (foundation D100's grace). */
const LATE_MS = REMINDER_GRACE_MS;
/** Later than this, a reminder says when it was due instead of how soon its item is. */
const ON_TIME_MS = 60_000;

/** What the reminders need of time: Node's by default, a fake in tests. */
export interface Clock {
  now(): number;
  /** Calls `run` once after `ms`; returns the function that cancels it. */
  after(ms: number, run: () => void): () => void;
}

export interface MainReminders {
  /** Replaces the set: what is due shows, the rest waits for its time. */
  schedule(reminders: readonly ScheduledReminder[]): void;
  /** The machine woke (resume, unlock): what came due meanwhile shows, late. */
  wake(): void;
}

/**
 * The main process's reminders: `show` puts a notification on the screen and
 * calls its `click` when the user clicks it; `open` brings the window forward
 * on the reminder (foundation D101: its occurrence's details).
 */
export function mainReminders(options: {
  clock: Clock;
  show(notification: { title: string; body: string }, click: () => void): void;
  open(reminder: ScheduledReminder): void;
}): MainReminders {
  const { clock, show, open } = options;
  let set: readonly ScheduledReminder[] = [];
  let cancel: (() => void) | null = null;
  /** Reminders shown, or dropped as too old, by id and time: one moved later shows again. */
  const done = new Set<string>();

  // Shows what is due (late by up to LATE_MS), drops what is older, and waits for the next.
  const arm = () => {
    cancel?.();
    cancel = null;
    const now = clock.now();
    for (const reminder of set) {
      if (done.has(shownKey(reminder))) continue;
      if (reminder.fireAt > now) {
        cancel = clock.after(reminder.fireAt - now, arm);
        return;
      }
      done.add(shownKey(reminder));
      const late = now - reminder.fireAt;
      if (late > LATE_MS) continue;
      const { title, body, late: lateBody } = reminder.notification;
      show({ title, body: late > ON_TIME_MS ? (lateBody ?? body) : body }, () => open(reminder));
    }
  };

  return {
    schedule(reminders) {
      set = reminders.toSorted((a, b) => a.fireAt - b.fireAt);
      const keys = new Set(set.map(shownKey));
      for (const key of done) if (!keys.has(key)) done.delete(key);
      arm();
    },
    wake: arm,
  };
}

const shownKey = (reminder: { readonly id: string; readonly fireAt: number }) =>
  `${reminder.id}@${reminder.fireAt}`;
