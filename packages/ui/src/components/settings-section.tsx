// The Settings screen (design D53, D131): the whole screen on a phone, a
// dialog from 640 px, in groups: general (theme, language), the views (week
// start, clock, "hide completed"), the calendars and whether each shows,
// reminders (foundation D101) and, on the desktop, whether closing the
// window quits (desktop D75). Each applies at once and is kept on this device.
import type { Account, Calendar } from "@astrotime/storage";
import { Checkbox } from "@base-ui/react/checkbox";
import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import { useId, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { LANGUAGES } from "../i18n/index.ts";
import { CLOCKS, THEMES, useSettings, WEEK_STARTS, type Settings } from "../settings.ts";
import { accountName } from "./accounts.tsx";
import { useAccounts } from "./accounts-context.tsx";
import { useCalendar } from "./context.ts";
import { CheckIcon, CloseIcon } from "./icons.tsx";
import { dialogIcon, sheet } from "./item-details.tsx";
import { RemindersSwitch } from "./reminders-switch.tsx";

/** A language's name in itself: "English", "Русский". */
const nativeName = (language: string) => {
  const name = new Intl.DisplayNames([language], { type: "language" }).of(language) ?? language;
  return name.charAt(0).toLocaleUpperCase(language) + name.slice(1);
};

export function SettingsScreen({
  open,
  onClose,
  accounts,
  calendars,
  hidden,
  onToggle,
  colorOf,
}: {
  open: boolean;
  onClose: () => void;
  accounts: readonly Account[];
  calendars: readonly Calendar[];
  hidden: ReadonlySet<string>;
  onToggle: (calendarId: string, visible: boolean) => void;
  colorOf: (calendar: Calendar) => string;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[100] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className={`${sheet} z-[110] pt-(--inset-top) pb-(--inset-bottom) sm:w-[min(40rem,calc(100vw-2rem))] sm:pt-0 sm:pb-0`}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2">
            <Dialog.Close className={dialogIcon} aria-label={t("settings.close")}>
              <CloseIcon className="size-5" />
            </Dialog.Close>
            <Dialog.Title className="min-w-0 flex-1 truncate text-title">
              {t("settings.title")}
            </Dialog.Title>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pt-4 pb-8 sm:px-5">
            <SettingsGroups
              accounts={accounts}
              calendars={calendars}
              hidden={hidden}
              onToggle={onToggle}
              colorOf={colorOf}
            />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingsGroups({
  accounts,
  calendars,
  hidden,
  onToggle,
  colorOf,
}: {
  accounts: readonly Account[];
  calendars: readonly Calendar[];
  hidden: ReadonlySet<string>;
  onToggle: (calendarId: string, visible: boolean) => void;
  colorOf: (calendar: Calendar) => string;
}) {
  const { t } = useTranslation();
  const { formats } = useCalendar();
  const { settings, change } = useSettings();
  const { platform } = useAccounts();
  return (
    <>
      <Group title={t("settings.general")}>
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
      </Group>
      <Group title={t("settings.views")}>
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
      </Group>
      {accounts.map((account) => {
        const own = calendars.filter((calendar) => calendar.accountId === account.id);
        if (own.length === 0) return null;
        // Each account's calendars and whether the views show them: the
        // drawer's checkbox, in the calendar's colour, so one state is one
        // widget wherever it is met (D131).
        return (
          <Group
            key={account.id}
            title={t("settings.calendarsOf", { account: accountName(account, t) })}
          >
            {own.map((calendar) => (
              <label
                key={calendar.id}
                className="flex min-h-12 cursor-pointer items-center gap-4 px-4 text-body"
              >
                <Checkbox.Root
                  checked={!hidden.has(calendar.id)}
                  onCheckedChange={(shown) => onToggle(calendar.id, shown)}
                  className="item-color grid size-[18px] shrink-0 place-items-center rounded-[4px] border-2 border-[var(--item-fill)] data-checked:bg-[var(--item-fill)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  style={{ "--item": colorOf(calendar) } as CSSProperties}
                >
                  <Checkbox.Indicator className="flex text-white data-unchecked:hidden">
                    <CheckIcon className="size-3.5" strokeWidth="2.6" />
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
              </label>
            ))}
          </Group>
        );
      })}
      <Group title={t("settings.notifications")}>
        <RemindersSwitch />
      </Group>
      {platform.shell ? (
        <Group title={t("settings.desktop")}>
          <Toggle
            label={t("settings.keepRunning")}
            checked={settings.keepRunning}
            onChange={(keepRunning) => change({ keepRunning })}
            {...(settings.keepRunning ? { hint: t("settings.keepRunning.hint") } : {})}
          />
        </Group>
      ) : null}
    </>
  );
}

/** A group of settings under its name, on a card of its own, as Android's settings group them. */
function Group({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="px-4 text-small font-medium text-accent">
        {title}
      </h2>
      <div className="flex flex-col rounded-2xl bg-canvas py-1">{children}</div>
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
    <div className="flex flex-col px-4 text-body">
      <label className="flex min-h-12 min-w-0 cursor-pointer items-center gap-3">
        <span className="min-w-0 flex-1">{label}</span>
        <Switch.Root
          checked={checked}
          onCheckedChange={onChange}
          aria-describedby={hint ? hintId : undefined}
          className="flex h-6 w-10 shrink-0 items-center rounded-full bg-pill p-0.5 shadow-[inset_0_0_0_2px_var(--color-ink-muted)] transition-colors duration-150 data-checked:bg-accent data-checked:shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <Switch.Thumb className="size-5 rounded-full bg-ink-muted transition-[translate,background-color] duration-150 data-checked:translate-x-4 data-checked:bg-on-accent" />
        </Switch.Root>
      </label>
      {hint ? (
        <p id={hintId} className="pb-2 text-note text-ink-muted">
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
  // The name on the left, its value on the right; the value wraps below on a narrow screen.
  return (
    <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-body">
      <label htmlFor={id} className="min-w-0 flex-1">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 max-w-full min-w-40 rounded-lg bg-raised px-2 text-input text-ink focus-visible:outline-2 focus-visible:outline-accent"
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
