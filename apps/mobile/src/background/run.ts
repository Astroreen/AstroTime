// Background sync's run in the headless WebView (docs/plans/android.md#D67):
// the store opened as any tab opens it, `syncAll` under the tabs' sync lock,
// and the reminder set handed to Android again, with HTTP, the credentials
// and the notifications reached through native's handlers instead of
// Capacitor's plugins.
import type { SecretStore } from "@astrotime/core";
import type { Store } from "@astrotime/storage";
import { connectCalDav, syncAll, type AccountSync, type SyncLock } from "@astrotime/sync";
import type { Preferences } from "@astrotime/ui";
import { scheduleReminders } from "@astrotime/ui/background";

import {
  cleartextOrigins,
  nativeClient,
  type NativeRequest,
  type NativeResponse,
} from "../http.ts";
import { androidReminders, type NativeNotifications } from "../reminders.ts";
import type { Channel } from "./channel.ts";

/** What the run did, for native's log: how each account's sync ended, and how many reminders the set held. */
export interface BackgroundReport {
  readonly accounts: readonly Pick<AccountSync, "accountId" | "status">[];
  /** `null`: reminders are off, or there was nothing to sync. */
  readonly reminders: number | null;
}

export interface BackgroundContext {
  readonly native: Channel;
  readonly openStore: () => Promise<Store>;
  readonly preferences: Preferences;
  readonly languages: readonly string[];
  readonly timeZone: string;
  readonly syncLock: SyncLock;
  readonly remindersLock: <T>(work: () => Promise<T>) => Promise<T>;
  readonly now?: () => number;
}

/**
 * Syncs every account and hands Android the reminder set; with no account to
 * sync it does nothing. The store is closed at the end, so the open app, if
 * it started meanwhile, leads it at once (foundation D98).
 */
export async function backgroundSync(context: BackgroundContext): Promise<BackgroundReport> {
  const { native, preferences, now = () => Date.now() } = context;
  const store = await context.openStore();
  try {
    // Signed out of everything: nothing to sync, and the app emptied the set.
    if (!(await store.accounts()).some((account) => account.provider === "caldav")) {
      return { accounts: [], reminders: null };
    }
    const http = nativeClient(
      {
        request: (request) => native.call<NativeResponse>("http", request satisfies NativeRequest),
      },
      async () => cleartextOrigins(await store.accounts(), []),
    );
    const report = await syncAll({
      store,
      secrets: backgroundSecrets(native),
      connect: connectCalDav(http),
      lock: context.syncLock,
    });
    const set = await scheduleReminders({
      store,
      scheduler: androidReminders({
        native: backgroundNotifications(native),
        preferences,
        now,
        lock: context.remindersLock,
      }),
      preferences,
      languages: context.languages,
      timeZone: context.timeZone,
      now: now(),
    });
    return {
      accounts: report.accounts.map(({ accountId, status }) => ({ accountId, status })),
      reminders: set?.length ?? null,
    };
  } finally {
    await store.close();
  }
}

/**
 * The credentials, read only: the run never signs in or out. Native reads
 * them as `@aparajita/capacitor-secure-storage` keeps them (D64), and answers
 * `null` for ciphertext that no longer decrypts, as `keystoreSecrets` does.
 */
function backgroundSecrets(native: Channel): SecretStore {
  const readOnly = () => Promise.reject(new Error("Background sync only reads credentials."));
  return {
    get: (key) => native.call<string | null>("secrets.get", { key }),
    set: readOnly,
    delete: readOnly,
  };
}

/**
 * The notifications, as `@capacitor/local-notifications` schedules them
 * (D66), through native's handler on the plugin's own classes. Nobody can be
 * asked in the background: a permission not granted reads as denied, and
 * `androidReminders` then schedules nothing. Taps reach the open app only.
 */
function backgroundNotifications(native: Channel): NativeNotifications {
  const display = () => native.call<{ display: "granted" | "denied" }>("notifications.check", {});
  return {
    checkPermissions: display,
    requestPermissions: display,
    checkExactNotificationSetting: () =>
      native.call<{ exact_alarm: "granted" | "denied" }>("notifications.exact", {}),
    // A schedule's Date crosses as its ISO string, as over Capacitor's bridge.
    schedule: (options) => native.call("notifications.schedule", options),
    cancel: (options) => native.call("notifications.cancel", options),
    addListener: () => Promise.resolve(),
  };
}
