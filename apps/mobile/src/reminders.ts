// Reminders on Android come with PR A3 (docs/plans/android.md#D66): until
// then the app says it has none, and the setting shows it cannot turn on.
import type { ReminderScheduler } from "@astrotime/core";

export const noReminders: ReminderScheduler = {
  schedule: () => {},
  onOpen: () => () => {},
  permission: () => "unsupported",
  requestPermission: async () => "unsupported",
  whileOpenOnly: false,
};
