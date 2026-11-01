// What a shell's headless run needs of the UI (docs/plans/android.md#D67):
// the reminder set as the open app works it out, from the same settings and
// in the same words, without React or a screen.
import type { ReminderScheduler, ScheduledReminder } from "@astrotime/core";
import type { Store } from "@astrotime/storage";

import { Formats } from "./calendar/format.ts";
import { localeSettings } from "./calendar/locale.ts";
import { createI18n } from "./i18n/index.ts";
import { KEYS, type Preferences } from "./preferences.ts";
import { reminderSet } from "./reminders/planner.ts";
import { reminderNotification } from "./reminders/words.ts";
import { readSettings, withSettings } from "./settings.ts";

/**
 * Hands `scheduler` the reminder set of `now`, as the open app's planner
 * would (foundation D101), and returns it; `null`, handing nothing, when the
 * user turned reminders off (the app emptied the set then).
 */
export async function scheduleReminders(options: {
  readonly store: Store;
  readonly scheduler: ReminderScheduler;
  readonly preferences: Preferences;
  /** The user's languages, most preferred first (`navigator.languages`). */
  readonly languages: readonly string[];
  readonly timeZone: string;
  readonly now: number;
}): Promise<readonly ScheduledReminder[] | null> {
  const { store, scheduler, preferences, languages, timeZone, now } = options;
  const chosen = readSettings(preferences.get(KEYS.settings));
  if (!chosen.reminders) return null;
  const language = chosen.language === "system" ? undefined : chosen.language;
  const settings = withSettings(localeSettings(languages, language), chosen);
  const i18n = createI18n(settings.language);
  const words = {
    t: i18n.t.bind(i18n),
    formats: new Formats(settings),
    locale: settings.locale,
    timeZone,
  };
  const { set } = await reminderSet(store, now, timeZone, (reminder) =>
    reminderNotification(reminder, words),
  );
  await scheduler.schedule(set);
  return set;
}
