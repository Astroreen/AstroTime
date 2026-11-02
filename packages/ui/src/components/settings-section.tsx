// The Settings screen (design D53, D131): the whole screen on a phone, a
// dialog from 640 px, in groups: general (theme, language, the burst on a
// completed task, D198), the views (week
// start, clock, "hide completed", week numbers), the colours (D172, D173),
// the accounts with how each syncs, whether it syncs at all (foundation
// D171), its menu and its calendars, each shown or not (D137), reminders
// (foundation D101), places on the map (D175) and, on the desktop, whether
// closing the window quits
// (desktop D75). Each applies at once and is kept on this device.
import type { Account, Calendar } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { LANGUAGES } from "../i18n/index.ts";
import { CLOCKS, THEMES, useSettings, WEEK_STARTS, type Settings } from "../settings.ts";
import { AccountRow, accountName, AddAccountButton } from "./accounts.tsx";
import { useAccounts } from "./accounts-context.tsx";
import { CalendarRow } from "./calendar-row.tsx";
import { ColorSettings } from "./color-settings.tsx";
import { useCalendar } from "./context.ts";
import { CloseIcon } from "./icons.tsx";
import { RemindersSwitch } from "./reminders-switch.tsx";
import { Select } from "./select.tsx";
import { DialogBackdrop, DialogPopup, dialogIcon, sheet } from "./dialog-parts.tsx";

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
        <DialogBackdrop className="fixed inset-0 z-[100] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPopup
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
              onLeave={onClose}
            />
          </div>
        </DialogPopup>
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
  onLeave,
}: {
  accounts: readonly Account[];
  calendars: readonly Calendar[];
  hidden: ReadonlySet<string>;
  onToggle: (calendarId: string, visible: boolean) => void;
  colorOf: (calendar: Calendar) => string;
  /** Closes Settings before an account's dialog opens over it. */
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const { formats } = useCalendar();
  const { settings, change } = useSettings();
  const { platform, setSyncing } = useAccounts();
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
        <Toggle
          label={t("settings.celebrate")}
          checked={settings.celebrate}
          onChange={(celebrate) => change({ celebrate })}
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
        <Toggle
          label={t("settings.weekNumbers")}
          checked={settings.weekNumbers}
          onChange={(weekNumbers) => change({ weekNumbers })}
        />
      </Group>
      {/* What new items start with, and the user's own colours (D172, D173). */}
      <Group title={t("settings.colors")}>
        <ColorSettings rowClassName={choiceRow} />
      </Group>
      {/* Each account with how it syncs, its menu and its calendars, each
          shown or not as the drawer's checkbox says (D131, D137). */}
      <Group title={t("accounts.title")}>
        {accounts.map((account, index) => {
          const own = calendars.filter((calendar) => calendar.accountId === account.id);
          return (
            <section
              key={account.id}
              aria-label={accountName(account, t)}
              className={`flex flex-col pb-1 ${index > 0 ? "border-t border-line pt-1" : ""}`}
            >
              <div className="px-4 py-2">
                <AccountRow account={account} onLeave={onLeave} />
              </div>
              {/* Whether it syncs at all (foundation D171); off, its calendars stay. */}
              {account.provider === "caldav" && (
                <Toggle
                  label={t("accounts.sync")}
                  checked={!account.syncOff}
                  onChange={(on) => void setSyncing(account, on).catch(console.error)}
                  {...(account.syncOff ? { hint: t("accounts.sync.hint") } : {})}
                />
              )}
              {own.length === 0 && (
                <p className="px-4 pb-2 text-small text-ink-muted">{t("accounts.noCalendars")}</p>
              )}
              {own.map((calendar) => (
                <CalendarRow
                  key={calendar.id}
                  calendar={calendar}
                  color={colorOf(calendar)}
                  shown={!hidden.has(calendar.id)}
                  onToggle={onToggle}
                  className="min-h-11"
                />
              ))}
            </section>
          );
        })}
        <div className="border-t border-line px-2 py-1">
          <AddAccountButton onLeave={onLeave} />
        </div>
      </Group>
      {platform.places ? (
        <Group title={t("settings.places")}>
          <Toggle
            label={t("settings.places.search")}
            checked={settings.places}
            onChange={(places) => change({ places })}
            hint={t("settings.places.hint", {
              search: new URL(platform.places.photon).host,
              tiles: new URL(platform.places.tiles).host,
            })}
          />
        </Group>
      ) : null}
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

/** A setting's row with its name on the left and its dropdown on the right (D131). */
const choiceRow = "flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-body";

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
  // The name on the left, its value on the right; the value wraps below on a narrow screen.
  return (
    <div className={choiceRow}>
      <Select
        label={label}
        labelClassName="min-w-0 flex-1"
        value={value}
        onChange={onChange}
        options={options.map(([option, name]) => ({ value: option, label: name }))}
        className="h-9 max-w-full min-w-40 rounded-lg bg-raised pr-1 pl-2"
      />
    </div>
  );
}
