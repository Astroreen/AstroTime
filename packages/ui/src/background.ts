// What a shell's headless run needs of the UI (docs/plans/android.md#D67):
// the reminder set and the widget's snapshot (D317) as the open app works
// them out, from the same settings and in the same words, without React or
// a screen.
import type { ReminderScheduler, ScheduledReminder } from "@astrotime/core";
import type { Store } from "@astrotime/storage";

import { Formats } from "./calendar/format.ts";
import { localeSettings } from "./calendar/locale.ts";
import { createI18n } from "./i18n/index.ts";
import { ObjectCache } from "./calendar/query.ts";
import { KEYS, readHidden, type Preferences } from "./preferences.ts";
import { reminderSet } from "./reminders/planner.ts";
import { reminderNotification } from "./reminders/words.ts";
import { readSettings, withSettings } from "./settings.ts";
import { scheduleSnapshot, type ScheduleSnapshot, type WidgetHost } from "./widget/schedule.ts";

export type { ScheduleSnapshot, WidgetHost, WidgetOpen } from "./widget/schedule.ts";

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

/**
 * Hands `widget` the snapshot of `now`, as the open app does (android
 * D317): the calendars shown and the completed tasks hidden as the user
 * chose on this device, in the language chosen; returns it.
 */
export async function showWidget(options: {
  readonly store: Store;
  readonly widget: WidgetHost;
  readonly preferences: Preferences;
  /** The user's languages, most preferred first (`navigator.languages`). */
  readonly languages: readonly string[];
  readonly timeZone: string;
  readonly now: number;
}): Promise<ScheduleSnapshot> {
  const { store, widget, preferences, languages, timeZone, now } = options;
  const chosen = readSettings(preferences.get(KEYS.settings));
  const language = chosen.language === "system" ? undefined : chosen.language;
  const settings = withSettings(localeSettings(languages, language), chosen);
  const i18n = createI18n(settings.language);
  const snapshot = await scheduleSnapshot({
    store,
    cache: new ObjectCache(),
    hidden: readHidden(preferences.get(KEYS.hiddenCalendars)),
    hideCompleted: chosen.hideCompleted,
    words: {
      t: i18n.t.bind(i18n),
      formats: new Formats(settings),
      timeZone,
      locale: settings.locale,
    },
    now,
  });
  await widget.show(snapshot);
  return snapshot;
}
