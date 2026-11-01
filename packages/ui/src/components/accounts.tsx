// The accounts in the shell (design D46, docs/plans/foundation.md#D91, D92):
// the account button in the top bar and the accounts dialog it opens, each
// account's section in the drawer with its calendars and menu, the sync
// status, and the first-run screen of an app with no accounts.
import type { Account, Calendar } from "@astrotime/storage";
import type { AccountSync } from "@astrotime/sync";
import { Checkbox } from "@base-ui/react/checkbox";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type { AccountStatus } from "../accounts/scheduler.ts";
import { AddPersonIcon, MoreIcon, SyncIcon } from "./account-icons.tsx";
import { useAccounts, type AccountsValue } from "./accounts-context.tsx";
import { ConflictsDialog } from "./conflicts-dialog.tsx";
import { primaryButton, textButton } from "./sign-in-dialog.tsx";

const syncs = (account: Account) => account.provider === "caldav";

/** Whether an account's last sync left something for the user to do or know. */
function needsAttention(last: AccountSync | undefined): boolean {
  if (!last) return false;
  if (last.status !== "synced" && last.status !== "offline") return true;
  return (last.report?.errors.length ?? 0) > 0 || (last.report?.dropped.length ?? 0) > 0;
}

/** The first letter of an account's name, on its avatar. */
const initial = (account: Account | undefined) =>
  account ? (Array.from(account.name.trim())[0] ?? "?").toLocaleUpperCase() : "?";

function Avatar({ account, size = "size-8" }: { account: Account | undefined; size?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`grid ${size} shrink-0 place-items-center rounded-full bg-accent text-sm font-medium text-on-accent`}
    >
      {initial(account)}
    </span>
  );
}

/** One line on how an account syncs: syncing, when it last did, or what stops it. */
function StatusLine({ account, value }: { account: Account; value: AccountsValue }) {
  const { t } = useTranslation();
  if (!syncs(account)) return <>{t("accounts.demo")}</>;
  const { status, settings, timeZone } = value;
  const known: AccountStatus | undefined = status.accounts.get(account.id);
  if (status.running) return <>{t("sync.syncing")}</>;
  const last = known?.last;
  if (status.offline || last?.status === "offline") return <>{t("sync.offline")}</>;
  if (last && last.status !== "synced") return <>{t(`sync.${last.status}`)}</>;
  if (!known?.syncedAt) return <>{t("sync.never")}</>;
  const time = new Intl.DateTimeFormat(settings.locale, {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: settings.hour12 ? "h12" : "h23",
    timeZone,
  }).format(known.syncedAt);
  return <>{t("sync.syncedAt", { time })}</>;
}

/** What the last sync could not do for an account's items, in words (D37). */
function Problems({ last }: { last: AccountSync | undefined }) {
  const { t } = useTranslation();
  const errors = last?.report?.errors ?? [];
  const dropped = last?.report?.dropped.length ?? 0;
  if (errors.length === 0 && dropped === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-[12.5px] text-danger">
      {errors.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            {t("sync.problems", { count: errors.length })}
          </summary>
          <ul className="mt-1 list-disc pl-5 text-ink-muted">
            {errors.map((error, i) => (
              <li key={i}>{t(`sync.problem.${error.problem}`)}</li>
            ))}
          </ul>
        </details>
      )}
      {dropped > 0 && <p>{t("sync.dropped", { count: dropped })}</p>}
    </div>
  );
}

/** Signing in again opens on Nextcloud's tab for a Nextcloud account. */
const againRequest = (account: Account) => ({
  kind: account.homeUrl?.includes("/remote.php/dav/")
    ? ("nextcloud" as const)
    : ("caldav" as const),
  account,
});

/** An account's menu: sync now, sign in again, remove. `onLeave` closes what it sits in first. */
function AccountMenu({ account, onLeave }: { account: Account; onLeave: () => void }) {
  const { t } = useTranslation();
  const value = useAccounts();
  const item =
    "flex h-10 cursor-default items-center rounded-lg px-3 text-sm -outline-offset-2 data-highlighted:bg-raised-hover";
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("accounts.menu", { name: account.name })}
        className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <MoreIcon className="size-5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-[120]">
          <Menu.Popup className="min-w-52 origin-[var(--transform-origin)] rounded-xl bg-raised p-1 text-ink shadow-xl ring-1 ring-line transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {syncs(account) && (
              <>
                <Menu.Item className={item} onClick={() => void value.scheduler.syncNow()}>
                  {t("accounts.syncNow")}
                </Menu.Item>
                <Menu.Item
                  className={item}
                  onClick={() => {
                    onLeave();
                    value.signIn(againRequest(account));
                  }}
                >
                  {t("accounts.signInAgain")}
                </Menu.Item>
              </>
            )}
            <Menu.Item
              className={`${item} text-danger`}
              onClick={() => {
                onLeave();
                value.remove(account);
              }}
            >
              {t("accounts.remove")}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** The account button at the end of the top bar (design D46): the accounts dialog. */
export function AccountButton({ accounts }: { accounts: readonly Account[] }) {
  const { t } = useTranslation();
  const value = useAccounts();
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const attention =
    value.conflicts > 0 ||
    accounts.some((account) => needsAttention(value.status.accounts.get(account.id)?.last));
  const label = value.status.running
    ? t("accounts.buttonSyncing")
    : attention
      ? t("accounts.buttonAttention")
      : t("accounts.button");
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger
        aria-label={label}
        title={label}
        className="relative grid size-10 shrink-0 place-items-center rounded-full hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Avatar account={accounts[0]} />
        {value.status.running && (
          <span
            aria-hidden="true"
            className="absolute inset-0.5 animate-spin rounded-full border-2 border-transparent border-t-accent"
          />
        )}
        {attention && !value.status.running && (
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 size-2.5 rounded-full bg-danger ring-2 ring-canvas"
          />
        )}
      </Dialog.Trigger>
      {/* A sync that comes to need the user is said, not only shown as the dot. */}
      <span role="status" className="sr-only">
        {attention && !value.status.running ? t("accounts.buttonAttention") : ""}
      </span>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[80] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-3 left-1/2 z-[90] max-h-[calc(100dvh-1.5rem)] w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-y-auto rounded-3xl bg-raised p-4 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 lg:right-3 lg:left-auto lg:translate-x-0">
          <div className="mb-2 flex items-center justify-between pl-2">
            <Dialog.Title className="text-lg font-medium">{t("accounts.title")}</Dialog.Title>
            <Dialog.Close className={textButton}>{t("accounts.close")}</Dialog.Close>
          </div>
          <ul className="flex flex-col gap-1">
            {accounts.map((account) => (
              <li key={account.id} className="flex flex-col gap-1 rounded-2xl bg-canvas p-3">
                <div className="flex items-center gap-3">
                  <Avatar account={account} size="size-9" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14.5px] font-medium">{account.name}</p>
                    {/* Said as it changes, so Sync now is heard to run and end. */}
                    <p role="status" className="truncate text-[12.5px] text-ink-muted">
                      <StatusLine account={account} value={value} />
                    </p>
                  </div>
                  <AccountMenu account={account} onLeave={() => setOpen(false)} />
                </div>
                {value.status.accounts.get(account.id)?.last.status === "signed-out" && (
                  <button
                    type="button"
                    className={`${textButton} self-end`}
                    onClick={() => {
                      setOpen(false);
                      value.signIn(againRequest(account));
                    }}
                  >
                    {t("accounts.signInAgain")}
                  </button>
                )}
                <Problems last={value.status.accounts.get(account.id)?.last} />
              </li>
            ))}
          </ul>
          {value.conflicts > 0 && (
            <div role="note" className="mt-3 rounded-2xl bg-danger-soft p-3 text-[13px]">
              <p className="font-medium text-danger">
                {t("conflicts", { count: value.conflicts })}
              </p>
              <p className="mt-1 text-ink-muted">{t("conflicts.hint")}</p>
              <div className="mt-1 flex justify-end">
                <button type="button" className={textButton} onClick={() => setReviewing(true)}>
                  {t("conflicts.review")}
                </button>
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {accounts.some(syncs) && (
              <button
                type="button"
                className={`${textButton} flex items-center gap-2`}
                disabled={value.status.running}
                onClick={() => void value.scheduler.syncNow()}
              >
                <SyncIcon className="size-4" />
                {t("accounts.syncNow")}
              </button>
            )}
            <button
              type="button"
              className={`${primaryButton} flex items-center gap-2`}
              onClick={() => {
                setOpen(false);
                value.signIn({ kind: "nextcloud" });
              }}
            >
              <AddPersonIcon className="size-4" />
              {t("accounts.add")}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
      <ConflictsDialog
        store={value.store}
        open={reviewing}
        onClose={() => setReviewing(false)}
        onChanged={() => value.scheduler.changed()}
      />
    </Dialog.Root>
  );
}

/** An account in the drawer: its name, how it syncs, its menu, its calendars (design D46). */
export function AccountSection({
  account,
  calendars,
  hidden,
  onToggle,
  colorOf,
  onLeave,
}: {
  account: Account;
  calendars: readonly Calendar[];
  hidden: ReadonlySet<string>;
  onToggle: (calendarId: string, visible: boolean) => void;
  colorOf: (calendar: Calendar) => string;
  onLeave: () => void;
}) {
  const { t } = useTranslation();
  const value = useAccounts();
  return (
    <section aria-label={account.name} className="flex flex-col">
      <div className="flex items-center gap-1 pt-2 pr-1 pl-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-xs text-ink-muted">{account.name}</h3>
          <p className="truncate text-[11px] text-ink-muted">
            <StatusLine account={account} value={value} />
          </p>
        </div>
        <AccountMenu account={account} onLeave={onLeave} />
      </div>
      {calendars.length === 0 && (
        <p className="px-4 py-2 text-[13px] text-ink-muted">{t("accounts.noCalendars")}</p>
      )}
      {calendars.map((calendar) => (
        <label
          key={calendar.id}
          className="flex h-10 cursor-pointer items-center gap-4 rounded-full px-4 text-[14px] hover:bg-raised-hover"
        >
          <Checkbox.Root
            checked={!hidden.has(calendar.id)}
            onCheckedChange={(checked) => onToggle(calendar.id, checked)}
            className="grid size-[18px] shrink-0 place-items-center rounded-[4px] border-2 border-[var(--calendar)] data-checked:bg-[var(--calendar)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            style={{ "--calendar": colorOf(calendar) } as CSSProperties}
          >
            <Checkbox.Indicator className="item-on-color flex data-unchecked:hidden">
              <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
                <path
                  d="M3.5 8.5l3 3 6-7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Checkbox.Indicator>
          </Checkbox.Root>
          <span className="min-w-0 flex-1 truncate">{calendar.name}</span>
        </label>
      ))}
    </section>
  );
}

/** At the end of the drawer's accounts. */
export function AddAccountButton({ onLeave }: { onLeave: () => void }) {
  const { t } = useTranslation();
  const value = useAccounts();
  return (
    <button
      type="button"
      onClick={() => {
        onLeave();
        value.signIn({ kind: "nextcloud" });
      }}
      className="mt-1 flex h-10 items-center gap-4 rounded-full px-4 text-left text-[14px] hover:bg-raised-hover"
    >
      <AddPersonIcon className="size-5 text-ink-muted" />
      {t("accounts.add")}
    </button>
  );
}

/** An app with no account and no demo: what AstroTime is, and the way in. */
export function FirstRun() {
  const { t } = useTranslation();
  const value = useAccounts();
  return (
    <main className="grid h-dvh place-items-center bg-canvas p-6 text-ink">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <p className="text-[15px] font-medium tracking-tight text-accent">{t("app.name")}</p>
        <h1 className="text-[26px] leading-tight">{t("firstRun.title")}</h1>
        <p className="text-[15px] text-ink-muted">{t("firstRun.body")}</p>
        <div className="mt-2 flex flex-col items-center gap-2">
          <button
            type="button"
            className={primaryButton}
            onClick={() => value.signIn({ kind: "nextcloud" })}
          >
            {t("firstRun.nextcloud")}
          </button>
          <button
            type="button"
            className={textButton}
            onClick={() => value.signIn({ kind: "caldav" })}
          >
            {t("firstRun.caldav")}
          </button>
        </div>
      </div>
    </main>
  );
}
