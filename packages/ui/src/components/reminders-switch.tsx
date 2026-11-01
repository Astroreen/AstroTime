// The "Reminders" setting in Settings (docs/plans/foundation.md#D101, design D131): a
// switch that asks the platform's permission when it is turned on, so the
// browser asks from the user's tap and never at start; it names the next
// reminder, and says when reminders show (the web: while the app is open)
// or why they cannot.
import { wallClockIn, type ScheduledReminder } from "@astrotime/core";
import { Switch } from "@base-ui/react/switch";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { useCalendar } from "./context.ts";
import { useReminders } from "./reminders-context.tsx";

export function RemindersSwitch() {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const { permission, enabled, whileOpenOnly, inexact, native, next, turn } = useReminders();
  const hint = useId();
  const blocked = permission === "denied" || permission === "unsupported";
  // "Next: Call with Anna, Wed, Nov 4, 11:00 AM", once the set is known.
  const nextLine = (reminder: ScheduledReminder | null) => {
    if (!reminder) return t("reminders.none");
    const local = wallClockIn(reminder.fireAt, timeZone);
    const time = formats.time({ type: "floating", local }, timeZone);
    const when = t("reminder.onDay", { day: formats.shortDate(local.slice(0, 10)), time });
    return t("reminders.next", { title: reminder.notification.title, when });
  };
  // An app's permission is the system's, a page's the browser's.
  const notes = blocked
    ? [t(native ? `reminders.${permission}.app` : `reminders.${permission}`)]
    : enabled
      ? [
          ...(next === undefined ? [] : [nextLine(next)]),
          ...(whileOpenOnly ? [t("reminders.whileOpen")] : []),
          ...(inexact ? [t("reminders.inexact")] : []),
        ]
      : [];
  return (
    <div className="flex flex-col px-4 py-1 text-[14px]">
      <label className="flex min-h-11 cursor-pointer items-center gap-3 has-disabled:cursor-default">
        <span className="min-w-0 flex-1">{t("reminders.setting")}</span>
        <Switch.Root
          checked={enabled}
          disabled={blocked}
          onCheckedChange={(on) => void turn(on)}
          aria-describedby={notes.length > 0 ? hint : undefined}
          className="flex h-6 w-10 shrink-0 items-center rounded-full bg-pill p-0.5 shadow-[inset_0_0_0_2px_var(--color-ink-muted)] transition-colors duration-150 data-checked:bg-accent data-checked:shadow-none data-disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Switch.Thumb className="size-5 rounded-full bg-ink-muted transition-[translate,background-color] duration-150 data-checked:translate-x-4 data-checked:bg-on-accent" />
        </Switch.Root>
      </label>
      {notes.length > 0 && (
        <div id={hint} className="flex flex-col gap-0.5 pb-1 text-[12.5px] text-ink-muted">
          {notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
    </div>
  );
}
