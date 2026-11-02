// The accounts in the shell (design D46, docs/plans/foundation.md#D91, D92):
// the account button in the top bar and the accounts dialog it opens, each
// account's section in the drawer with its calendars and menu, and the sync
// status. The calendar on this device (D122) is an account here too.
import type { Account, Calendar } from "@astrotime/storage";
import type { AccountSync } from "@astrotime/sync";
import { Dialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { AccountStatus } from "../accounts/scheduler.ts";
import { AddPersonIcon, MoreIcon, SyncIcon } from "./account-icons.tsx";
import { useAccounts, type AccountsValue } from "./accounts-context.tsx";
import { CalendarRow } from "./calendar-row.tsx";
import { CloseIcon } from "./icons.tsx";
import { dialogIcon } from "./item-details.tsx";
import { ConflictsDialog } from "./lazy.tsx";
import { primaryButton, textButton } from "./sign-in-dialog.tsx";
import { DialogBackdrop, DialogPopup } from "./dialog-parts.tsx";

const syncs = (account: Account) => account.provider === "caldav";

/** An account's name; the calendar on this device's in the language spoken now (D122). */
export const accountName = (account: Account, t: TFunction) =>
  account.provider === "local" ? t("local.account") : account.name;

/** Whether an account's last sync left something for the user to do or know. */
function needsAttention(last: AccountSync | undefined): boolean {
  if (!last) return false;
  if (last.status !== "synced" && last.status !== "offline") return true;
  return (last.report?.errors.length ?? 0) > 0 || (last.report?.dropped.length ?? 0) > 0;
}

/** The first letter of an account's name, on its avatar. */
const initial = (name: string | undefined) =>
  name ? (Array.from(name.trim())[0] ?? "?").toLocaleUpperCase() : "?";

function Avatar({ account, size = "size-8" }: { account: Account | undefined; size?: string }) {
  const { t } = useTranslation();
  return (
    <span
      aria-hidden="true"
      className={`grid ${size} shrink-0 place-items-center rounded-full bg-accent text-body font-medium text-on-accent`}
    >
      {initial(account && accountName(account, t))}
    </span>
  );
}

/** One line on how an account syncs: syncing, when it last did, or what stops it. */
function StatusLine({ account, value }: { account: Account; value: AccountsValue }) {
  const { t } = useTranslation();
  if (account.provider === "local") return <>{t("local.status")}</>;
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
    <div className="flex flex-col gap-1 text-note text-danger">
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

/**
 * An account's menu: sign in again, remove. `onLeave` closes what it sits in
 * first. No "Sync now" here: a sync is every account's (the accounts
 * dialog's button says so), and one for a single account is Deferred
 * (design D137).
 */
function AccountMenu({ account, onLeave }: { account: Account; onLeave: () => void }) {
  const { t } = useTranslation();
  const value = useAccounts();
  const item =
    "flex h-10 cursor-default items-center rounded-lg px-3 text-body -outline-offset-2 data-highlighted:bg-raised-hover";
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={t("accounts.menu", { name: accountName(account, t) })}
        className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent"
      >
        <MoreIcon className="size-5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-[120]">
          <Menu.Popup className="min-w-52 origin-[var(--transform-origin)] rounded-xl bg-raised p-1 text-ink shadow-xl ring-1 ring-line transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
            {syncs(account) && (
              <Menu.Item
                className={item}
                onClick={() => {
                  onLeave();
                  value.signIn(againRequest(account));
                }}
              >
                {t("accounts.signInAgain")}
              </Menu.Item>
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

/**
 * An account: its avatar, its name, how it syncs and its menu, then "Sign in
 * again" when it is signed out and what its last sync could not do; the same
 * in the accounts dialog, Settings and, compact, the drawer (design D137).
 * Compact, it is the drawer's head: no avatar, its name a heading, and the
 * sync's problems left to the accounts dialog, where the account button's
 * dot leads. Its status is text: the account button's one live region says
 * what changes (D120).
 */
export function AccountRow({
  account,
  onLeave,
  compact = false,
}: {
  account: Account;
  onLeave: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const value = useAccounts();
  const last = value.status.accounts.get(account.id)?.last;
  const Name = compact ? "h3" : "p";
  return (
    <div className="flex flex-col gap-1">
      <div className={`flex items-center ${compact ? "gap-1" : "gap-3"}`}>
        {!compact && <Avatar account={account} size="size-9" />}
        <div className="min-w-0 flex-1">
          <Name
            className={`truncate ${compact ? "text-note text-ink-muted" : "text-body font-medium"}`}
          >
            {accountName(account, t)}
          </Name>
          <p className={`truncate text-ink-muted ${compact ? "text-tiny" : "text-note"}`}>
            <StatusLine account={account} value={value} />
          </p>
        </div>
        <AccountMenu account={account} onLeave={onLeave} />
      </div>
      {last?.status === "signed-out" && (
        <button
          type="button"
          className={`${textButton} self-end`}
          onClick={() => {
            onLeave();
            value.signIn(againRequest(account));
          }}
        >
          {t("accounts.signInAgain")}
        </button>
      )}
      {!compact && <Problems last={last} />}
    </div>
  );
}

/** The account button at the end of the top bar (design D46): the accounts dialog. */
export function AccountButton({ accounts }: { accounts: readonly Account[] }) {
  const { t } = useTranslation();
  const value = useAccounts();
  const [open, setOpen] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  // A sync that ended unable to reach a server: said in the calm words the
  // rows use, never as synced (D122).
  const offline =
    value.status.offline ||
    accounts.some((account) => value.status.accounts.get(account.id)?.last.status === "offline");
  // A sync ran while the dialog was open: its end is said.
  const [syncedWhileOpen, setSyncedWhileOpen] = useState(false);
  const [wasRunning, setWasRunning] = useState(value.status.running);
  if (wasRunning !== value.status.running) {
    setWasRunning(value.status.running);
    if (!value.status.running && open) setSyncedWhileOpen(true);
  }
  const attention =
    value.conflicts > 0 ||
    accounts.some((account) => needsAttention(value.status.accounts.get(account.id)?.last));
  const label = value.status.running
    ? t("accounts.buttonSyncing")
    : attention
      ? t("accounts.buttonAttention")
      : t("accounts.button");
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setSyncedWhileOpen(false);
      }}
    >
      <Dialog.Trigger
        aria-label={label}
        title={label}
        className="relative grid size-10 shrink-0 place-items-center rounded-full hover:bg-raised focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Avatar account={accounts[0]} />
        {value.status.running && (
          <span
            aria-hidden="true"
            data-spinner
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
      {/*
        The accounts' one live region while the dialog is closed (design D120,
        D137). A sync that comes to need the user is said, not only shown as
        the dot: once, as it starts to. The text stays while the need does,
        through the syncs that run meanwhile, so it is not said again after
        each. While the dialog is open the page around it is hidden from a
        screen reader, so the dialog has its own, below.
      */}
      <span role="status" className="sr-only">
        {attention ? t("accounts.buttonAttention") : ""}
      </span>
      <Dialog.Portal>
        <DialogBackdrop className="fixed inset-0 z-[80] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPopup className="fixed top-3 left-1/2 z-[90] max-h-[calc(100dvh-1.5rem)] w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 overflow-y-auto rounded-3xl bg-raised p-4 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 lg:right-3 lg:left-auto lg:translate-x-0">
          {/* Closed by ✕ before its title, as every other dialog (design D137). */}
          <div className="mb-2 flex items-center gap-2">
            <Dialog.Close className={dialogIcon} aria-label={t("accounts.close")}>
              <CloseIcon className="size-5" />
            </Dialog.Close>
            <Dialog.Title className="text-title font-medium">{t("accounts.title")}</Dialog.Title>
          </div>
          {/*
            The accounts' one live region while the dialog is open: a sync is
            said to run and to end (Sync now) once for every account, and how
            it ended: synced, offline, or needing the user. The rows' status
            lines are text.
          */}
          <p role="status" className="sr-only">
            {value.status.running
              ? t("accounts.buttonSyncing")
              : !syncedWhileOpen
                ? ""
                : attention
                  ? t("accounts.buttonAttention")
                  : offline
                    ? t("sync.offline")
                    : t("accounts.synced")}
          </p>
          <ul className="flex flex-col gap-1">
            {accounts.map((account) => (
              <li key={account.id} className="flex flex-col gap-1 rounded-2xl bg-canvas p-3">
                <AccountRow account={account} onLeave={() => setOpen(false)} />
                {/* The web keeps a store per origin: another address starts empty (D121). */}
                {account.provider === "local" && value.platform.dataHome ? (
                  <p className="text-note text-ink-muted">
                    {t("local.dataHome", { home: value.platform.dataHome })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
          {value.held && (
            <p role="status" className="mt-3 px-2 text-small text-ink-muted">
              {t("accounts.held", {
                name: `${value.held.username}@${new URL(value.held.server).host}`,
              })}
            </p>
          )}
          {!accounts.some(syncs) && (
            <p className="mt-3 px-2 text-small text-ink-muted">{t("local.hint")}</p>
          )}
          {value.conflicts > 0 && (
            <div role="note" className="mt-3 rounded-2xl bg-danger-soft p-3 text-small">
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
                value.signIn({ kind: value.platform.preset ? "preset" : "nextcloud" });
              }}
            >
              <AddPersonIcon className="size-4" />
              {t("accounts.add")}
            </button>
          </div>
        </DialogPopup>
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
  return (
    <section aria-label={accountName(account, t)} className="flex flex-col">
      <div className="pt-2 pr-1 pl-4">
        <AccountRow account={account} onLeave={onLeave} compact />
      </div>
      {calendars.length === 0 && (
        <p className="px-4 py-2 text-small text-ink-muted">{t("accounts.noCalendars")}</p>
      )}
      {calendars.map((calendar) => (
        <CalendarRow
          key={calendar.id}
          calendar={calendar}
          color={colorOf(calendar)}
          shown={!hidden.has(calendar.id)}
          onToggle={onToggle}
          className="h-10 rounded-full hover:bg-raised-hover"
        />
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
        value.signIn({ kind: value.platform.preset ? "preset" : "nextcloud" });
      }}
      className="mt-1 flex h-10 items-center gap-4 rounded-full px-4 text-left text-body hover:bg-raised-hover"
    >
      <AddPersonIcon className="size-5 text-ink-muted" />
      {t("accounts.add")}
    </button>
  );
}
