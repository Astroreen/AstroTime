// The accounts and their syncing, for every part of the UI that shows them
// (docs/plans/foundation.md#D91, D92): the scheduler of the UI's syncs, its
// status, the conflicts count, and the sign-in and removal dialogs.
import type { Account, Store } from "@astrotime/storage";
import { connectCalDav, removeAccount, syncAll, type SyncContext } from "@astrotime/sync";
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";

import { browserEnvironment, SyncScheduler, type SyncStatus } from "../accounts/scheduler.ts";
import { hasPendingFlow } from "../accounts/sign-in.ts";
import { liveQuery } from "../calendar/live.ts";
import type { LocaleSettings } from "../calendar/locale.ts";
import type { Platform } from "../platform.ts";
import { KEYS } from "../preferences.ts";
import { RemoveAccountDialog } from "./remove-account.tsx";
import { SignInDialog, type SignInRequest } from "./sign-in-dialog.tsx";

export interface AccountsValue {
  readonly platform: Platform;
  readonly store: Store;
  readonly settings: LocaleSettings;
  readonly timeZone: string;
  readonly scheduler: SyncScheduler;
  readonly status: SyncStatus;
  /** Our changes the server refused, waiting in the Conflicts list (D6). */
  readonly conflicts: number;
  signIn(request: SignInRequest): void;
  remove(account: Account): void;
}

const AccountsContext = createContext<AccountsValue | null>(null);

export function useAccounts(): AccountsValue {
  const value = useContext(AccountsContext);
  if (!value) throw new Error("useAccounts needs an AccountsProvider.");
  return value;
}

export function AccountsProvider({
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
  const [context] = useState<SyncContext>(() => ({
    store,
    secrets: platform.secrets,
    connect: connectCalDav(platform.http),
    ...(platform.syncLock ? { lock: platform.syncLock } : {}),
  }));
  const [scheduler] = useState(
    () => new SyncScheduler((fresh) => syncAll(context, { fresh }), browserEnvironment()),
  );
  useEffect(() => scheduler.start(), [scheduler]);
  // The shell's own triggers (desktop D75), each a sync that starts after it.
  useEffect(() => platform.onSyncRequest?.(() => void scheduler.syncNow()), [platform, scheduler]);
  const status = useSyncExternalStore(
    (onChange) => scheduler.subscribe(onChange),
    () => scheduler.status,
  );

  const [conflicts, setConflicts] = useState(0);
  useEffect(
    () => liveQuery(store, async () => (await store.conflicts()).length, setConflicts),
    [store],
  );

  const [signingIn, setSigningIn] = useState<SignInRequest | null>(null);
  const [removing, setRemoving] = useState<Account | null>(null);

  // A Login Flow the page before this one started, discarded by the browser
  // or ended by the system while the user approved on Nextcloud's page: this
  // page takes it up again (D121).
  useEffect(() => {
    const pending = platform.pendingSignIn;
    if (!pending) return;
    let live = true;
    hasPendingFlow(pending).then(
      (found) => {
        if (live && found) setSigningIn((open) => open ?? { kind: "nextcloud", resume: true });
      },
      (error: unknown) => console.error(error),
    );
    return () => {
      live = false;
    };
  }, [platform]);

  // Once the store holds an account, the browser is asked to keep its data
  // rather than evict it under pressure, once on this device: its answer is
  // kept, granted or refused (D121).
  useEffect(() => {
    const { keepData, preferences } = platform;
    if (!keepData || preferences.get(KEYS.keepData) !== null) return;
    let asked = false;
    return liveQuery(
      store,
      async () => (await store.accounts()).some((account) => account.provider !== "demo"),
      (some) => {
        if (!some || asked || preferences.get(KEYS.keepData) !== null) return;
        asked = true;
        // One tab asks at a time, and none once another has its answer.
        const ask = async () => {
          if (preferences.get(KEYS.keepData) !== null) return;
          const kept = await keepData();
          preferences.set(KEYS.keepData, kept ? "granted" : "refused");
        };
        const locks = globalThis.navigator?.locks;
        (locks ? locks.request("astrotime-keep-data", ask) : ask()).catch((error: unknown) =>
          console.error(error),
        );
      },
    );
  }, [platform, store]);

  const value: AccountsValue = {
    platform,
    store,
    settings,
    timeZone,
    scheduler,
    status,
    conflicts,
    signIn: setSigningIn,
    remove: setRemoving,
  };
  return (
    <AccountsContext.Provider value={value}>
      {children}
      <SignInDialog
        request={signingIn}
        onClose={() => setSigningIn(null)}
        onSignedIn={() => void scheduler.syncNow()}
      />
      <RemoveAccountDialog
        account={removing}
        onClose={() => setRemoving(null)}
        onRemove={(account) => removeAccount({ ...context, http: platform.http }, account.id)}
      />
    </AccountsContext.Provider>
  );
}
