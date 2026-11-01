// Reminders for the UI (docs/plans/foundation.md#D101): the planner that
// keeps the platform's set, the "Reminders" setting with the platform's
// permission, and the reminders the user taps.
import type { ReminderPermission, ScheduledReminder } from "@astrotime/core";
import type { Store } from "@astrotime/storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { Formats } from "../calendar/format.ts";
import type { LocaleSettings } from "../calendar/locale.ts";
import type { Platform } from "../platform.ts";
import { browserClock, ReminderPlanner } from "../reminders/planner.ts";
import { reminderNotification } from "../reminders/words.ts";
import { useSettings } from "../settings.ts";

export interface RemindersValue {
  readonly permission: ReminderPermission;
  /** The user wants reminders and the platform may show them. */
  readonly enabled: boolean;
  /** Reminders fire only while the app is open (the web). */
  readonly whileOpenOnly: boolean;
  /** The next reminder the platform has, once it has a set; `undefined` before. */
  readonly next: ScheduledReminder | null | undefined;
  /** Turns reminders on (asking the platform's permission, from this gesture) or off. */
  turn(on: boolean): Promise<void>;
  /** Calls `listener` with each reminder the user taps; returns the function that stops it. */
  onOpen(listener: (reminder: ScheduledReminder) => void): () => void;
}

const RemindersContext = createContext<RemindersValue | null>(null);

export function useReminders(): RemindersValue {
  const value = useContext(RemindersContext);
  if (!value) throw new Error("useReminders needs a RemindersProvider.");
  return value;
}

export function RemindersProvider({
  platform,
  store,
  settings,
  timeZone,
  children,
}: {
  platform: Platform;
  store: Store;
  settings: LocaleSettings;
  timeZone: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const scheduler = platform.reminders;
  const formats = useMemo(() => new Formats(settings), [settings]);
  const [permission, setPermission] = useState(() => scheduler.permission());
  // On unless turned off in the settings: where the platform may already notify, reminders show.
  const { settings: chosen, change } = useSettings();
  const enabled = chosen.reminders && permission === "granted";
  const [next, setNext] = useState<ScheduledReminder | null | undefined>(undefined);
  const [planner] = useState(() => {
    const clock = browserClock();
    return new ReminderPlanner({
      store,
      scheduler,
      timeZone,
      clock,
      // The set reaches an hour back (foundation D100); the next is the first still ahead.
      onSet: (set) => setNext(set.find((reminder) => reminder.fireAt >= clock.now()) ?? null),
    });
  });
  const [onOpen] = useState(
    () => (listener: (reminder: ScheduledReminder) => void) => scheduler.onOpen(listener),
  );

  useEffect(() => {
    const words = { t, formats, locale: settings.locale, timeZone };
    planner.update(enabled ? (reminder) => reminderNotification(reminder, words) : null, timeZone);
  }, [planner, enabled, t, formats, settings.locale, timeZone]);
  useEffect(() => () => planner.stop(), [planner]);

  // The permission can change in the browser's settings while the app is open.
  useEffect(() => {
    const update = () => setPermission(scheduler.permission());
    document.addEventListener("visibilitychange", update);
    window.addEventListener("focus", update);
    return () => {
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("focus", update);
    };
  }, [scheduler]);

  const value: RemindersValue = {
    permission,
    enabled,
    whileOpenOnly: scheduler.whileOpenOnly,
    next: enabled ? next : undefined,
    async turn(on) {
      change({ reminders: on });
      if (!on) return;
      const current = scheduler.permission();
      setPermission(current === "default" ? await scheduler.requestPermission() : current);
    },
    onOpen,
  };
  return <RemindersContext.Provider value={value}>{children}</RemindersContext.Provider>;
}
