import type { ReminderScheduler, ScheduledReminder } from "@astrotime/core";

import type { Bridge } from "../bridge.ts";

/**
 * The desktop's reminders (docs/plans/desktop.md#D76): the page hands the
 * set to the main process, which shows each as a desktop notification,
 * the window closed or not, and says which one the user clicked.
 */
export function desktopReminders(reminders: Bridge["reminders"]): ReminderScheduler {
  const listeners = new Set<(reminder: ScheduledReminder) => void>();
  reminders.onOpen((reminder) => {
    for (const listener of listeners) listener(reminder);
  });
  const permission = () => (reminders.supported ? "granted" : "unsupported");
  return {
    schedule: (set) => reminders.schedule(set),
    onOpen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    permission,
    requestPermission: async () => permission(),
    whileOpenOnly: false,
    // The system's notifications: the setting does not speak of a browser (android D60).
    native: true,
  };
}
