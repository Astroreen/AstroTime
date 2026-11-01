// The drawer's settings (design D53): theme, language, week start, clock,
// "hide completed", reminders (foundation D101) and, on the desktop, whether
// closing the window quits (desktop D75). Each applies at once and is kept on
// this device.
import { Switch } from "@base-ui/react/switch";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { LANGUAGES } from "../i18n/index.ts";
import { CLOCKS, THEMES, useSettings, WEEK_STARTS, type Settings } from "../settings.ts";
import { useAccounts } from "./accounts-context.tsx";
import { useCalendar } from "./context.ts";
import { RemindersSwitch } from "./reminders-switch.tsx";

/** A language's name in itself: "English", "Русский". */
const nativeName = (language: string) => {
  const name = new Intl.DisplayNames([language], { type: "language" }).of(language) ?? language;
  return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
};

export function SettingsSection() {
  const { t } = useTranslation();
  const { formats } = useCalendar();
  const { settings, change } = useSettings();
  const { platform } = useAccounts();
  const title = useId();
  return (
    <section aria-labelledby={title} className="flex flex-col">
      <h2 id={title} className="px-4 pt-1 pb-1 text-[13px] font-medium text-ink-muted">
        {t("settings.title")}
      </h2>
      <Choice
        label={t("settings.theme")}
        value={settings.theme}
        onChange={(theme) => change({ theme: theme as Settings["theme"] })}
        options={THEMES.map((theme) => [theme, t(`settings.theme.${theme}`)])}
      />
      <Choice
        label={t("settings.language")}
        value={settings.language}
        onChange={(language) => change({ language: language as Settings["language"] })}
        options={[
          ["system", t("settings.language.system")],
          ...LANGUAGES.map((language) => [language, nativeName(language)] as const),
        ]}
      />
      <Choice
        label={t("settings.weekStart")}
        value={String(settings.weekStart)}
        onChange={(day) =>
          change({ weekStart: day === "locale" ? "locale" : (Number(day) as 1 | 6 | 7) })
        }
        options={[
          ["locale", t("settings.weekStart.locale")],
          ...WEEK_STARTS.map((day) => [String(day), formats.weekdayName(day)] as const),
        ]}
      />
      <Choice
        label={t("settings.clock")}
        value={String(settings.clock)}
        onChange={(clock) =>
          change({ clock: clock === "locale" ? "locale" : (Number(clock) as 12 | 24) })
        }
        options={[
          ["locale", t("settings.clock.locale")],
          ...CLOCKS.map((clock) => [String(clock), t(`settings.clock.${clock}`)] as const),
        ]}
      />
      <Toggle
        label={t("settings.hideCompleted")}
        checked={settings.hideCompleted}
        onChange={(hideCompleted) => change({ hideCompleted })}
      />
      <RemindersSwitch />
      {platform.shell ? (
        <Toggle
          label={t("settings.keepRunning")}
          checked={settings.keepRunning}
          onChange={(keepRunning) => change({ keepRunning })}
          {...(settings.keepRunning ? { hint: t("settings.keepRunning.hint") } : {})}
        />
      ) : null}
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  const hintId = useId();
  return (
    <div className="flex flex-col px-4 text-[14px]">
      <label className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3">
        <span className="min-w-0 flex-1">{label}</span>
        <Switch.Root
          checked={checked}
          onCheckedChange={onChange}
          aria-describedby={hint ? hintId : undefined}
          className="flex h-6 w-10 shrink-0 items-center rounded-full bg-pill p-0.5 transition-colors duration-150 data-checked:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Switch.Thumb className="size-5 rounded-full bg-ink-muted transition-[translate,background-color] duration-150 data-checked:translate-x-4 data-checked:bg-on-accent" />
        </Switch.Root>
      </label>
      {hint ? (
        <p id={hintId} className="pb-2 text-[12.5px] text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Choice({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly (readonly [string, string])[];
}) {
  const id = useId();
  // The name above its value, as Android's settings list them; never squeezed in a sidebar.
  return (
    <div className="flex flex-col gap-1 px-4 py-1.5 text-[14px]">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-full rounded-lg bg-raised-hover px-2 text-[13.5px] text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        {options.map(([option, name]) => (
          <option key={option} value={option}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
