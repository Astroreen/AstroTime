import type { ReminderScheduler } from "@astrotime/core";

/**
 * No reminders until PR D3 brings them from the main process
 * (docs/plans/desktop.md#D76): notifications are unsupported, so the
 * setting stays off and says why.
 */
export const noReminders: ReminderScheduler = {
  schedule: () => {},
  onOpen: () => () => {},
  permission: () => "unsupported",
  requestPermission: async () => "unsupported",
  whileOpenOnly: false,
};
