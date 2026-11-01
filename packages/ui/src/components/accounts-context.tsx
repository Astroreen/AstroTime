// The accounts and their syncing, for every part of the UI that shows them
// (docs/plans/foundation.md#D91, D92): the scheduler of the UI's syncs, its
// status, the conflicts count, and the sign-in and removal dialogs.
import type { Account, Store } from "@astrotime/storage";
import { connectCalDav, removeAccount, syncAll, type SyncContext } from "@astrotime/sync";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTranslation } from "react-i18next";

import { browserEnvironment, SyncScheduler, type SyncStatus } from "../accounts/scheduler.ts";
import { hasPendingFlow, heldApproval, SignIn } from "../accounts/sign-in.ts";
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
  /** Login Flow's approval held while its server cannot be reached, saved once it can (D121). */
  readonly held: { readonly server: string; readonly username: string } | null;
  signIn(request: SignInRequest): void;
  remove(account: Account): void;
}

const AccountsContext = createContext<AccountsValue | null>(null);

/** The calendar on this device's colour, the demo's first calendar's blue (design D47). */
const LOCAL_COLOR = "#4f8fd6";

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
    () => new SyncScheduler((request) => syncAll(context, request), browserEnvironment()),
  );
  useEffect(() => scheduler.start(), [scheduler]);
  // The shell's own triggers (desktop D75), each a sync that starts after
  // it; the tray's "Sync now" is the user's own (D128).
  useEffect(
    () =>
      platform.onSyncRequest?.(
        (byUser) => void (byUser ? scheduler.syncNow() : scheduler.requested()),
      ),
    [platform, scheduler],
  );
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

  // No account at all: the calendar on this device, so the app opens on a
  // calendar to write in, with no server (D122). Made in the language
  // spoken now; again after the last account is removed.
  const { t } = useTranslation();
  const [localNames] = useState(() => ({
    account: t("local.account"),
    calendar: t("local.calendar"),
  }));
  useEffect(
    () =>
      liveQuery(
        store,
        async () => (await store.accounts()).length,
        (count) => {
          if (count > 0) return;
          store
            .addLocalCalendarIfEmpty({ ...localNames, color: LOCAL_COLOR })
            .catch((error: unknown) => console.error(error));
        },
      ),
    [store, localNames],
  );

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

  // Login Flow's approval held while its server could not be reached (its
  // page's, or one whose page went): saved in the background, on start and
  // whenever the network comes back, with no dialog (D121).
  const [held, setHeld] = useState<AccountsValue["held"]>(null);
  const retryHeld = useRef<() => void>(() => {});
  useEffect(() => {
    const pending = platform.pendingSignIn;
    if (!pending) return;
    let live = true;
    let running = false;
    const run = async () => {
      if (running) return;
      running = true;
      try {
        const signIn = new SignIn({
          store,
          secrets: platform.secrets,
          http: platform.http,
          openExternal: platform.openExternal,
          pending,
          ...(platform.signingInTo ? { signingInTo: platform.signingInTo } : {}),
        });
        if ((await signIn.saveHeld()) === "saved") {
          void scheduler.syncNow();
          // An unused calendar on this device steps aside for the server's (D122).
          await store.removeLocalCalendarIfUnused();
        }
        const now = await heldApproval(pending);
        if (live) setHeld(now);
      } catch (error) {
        console.error(error);
      } finally {
        running = false;
      }
    };
    void run();
    retryHeld.current = () => void run();
    window.addEventListener("online", run);
    return () => {
      live = false;
      window.removeEventListener("online", run);
    };
  }, [platform, store, scheduler]);

  // A single-user deployment (D123): while no server's account is here, the
  // sign-in opens by itself on the password, once per page, until the user
  // closes it unsigned.
  const { preset, preferences } = platform;
  // The dialog closes after a sign-in too; that is no dismissal.
  const signedIn = useRef(false);
  useEffect(() => {
    if (!preset || preferences.get(KEYS.presetSignIn) === "dismissed") return;
    let asked = false;
    return liveQuery(
      store,
      async () => (await store.accounts()).some((account) => account.provider === "caldav"),
      (hasServer) => {
        if (hasServer || asked) return;
        asked = true;
        setSigningIn((open) => open ?? { kind: "preset" });
      },
    );
  }, [preset, preferences, store]);

  // Once the store holds an account, the browser is asked to keep its data
  // rather than evict it under pressure, once on this device: its answer is
  // kept, granted or refused (D121).
  useEffect(() => {
    const { keepData } = platform;
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
  }, [platform, preferences, store]);

  const value: AccountsValue = {
    platform,
    store,
    settings,
    timeZone,
    scheduler,
    status,
    conflicts,
    held,
    signIn: setSigningIn,
    remove: setRemoving,
  };
  return (
    <AccountsContext.Provider value={value}>
      {children}
      <SignInDialog
        request={signingIn}
        onClose={() => {
          // Closed unsigned: the preset's sign-in opens by itself no more.
          if (signingIn?.kind === "preset" && !signedIn.current)
            preferences.set(KEYS.presetSignIn, "dismissed");
          signedIn.current = false;
          setSigningIn(null);
          // A sign-in that ended offline after its approval leaves it held.
          retryHeld.current();
        }}
        onSignedIn={() => {
          signedIn.current = true;
          void scheduler.syncNow();
          // Signed in: removed one day, the preset's sign-in opens by itself again.
          preferences.set(KEYS.presetSignIn, "");
          // An unused calendar on this device steps aside for the server's (D122).
          store.removeLocalCalendarIfUnused().catch((error: unknown) => console.error(error));
        }}
      />
      <RemoveAccountDialog
        account={removing}
        onClose={() => setRemoving(null)}
        onRemove={(account) => removeAccount({ ...context, http: platform.http }, account.id)}
      />
    </AccountsContext.Provider>
  );
}
