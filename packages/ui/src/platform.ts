import type { HttpClient } from "@astrotime/caldav";
import type { ReminderScheduler, SecretStore } from "@astrotime/core";
import type { Store } from "@astrotime/storage";
import type { SyncLock } from "@astrotime/sync";

import type { UnprotectedPrompt } from "./accounts/unprotected.ts";
import type { Preferences } from "./preferences.ts";
import type { Theme } from "./settings.ts";

/** What a shell's own chrome shows, from the settings, in the user's language (desktop D75). */
export interface ShellState {
  /** The theme the window's frame follows. */
  readonly theme: Theme;
  /** Closing the window leaves the app running; off, it quits. */
  readonly keepRunning: boolean;
  /** The words of the shell's tray and menu. */
  readonly words: {
    readonly open: string;
    readonly syncNow: string;
    readonly closeWindow: string;
    readonly quit: string;
  };
}

/**
 * What a shell hands the UI's root: its adapters of the platform interfaces
 * (docs/plans/android.md#D60), the same shape on the web, Android and the
 * desktop.
 */
export interface Platform {
  /** The local store, opening; created once, outside React. */
  readonly store: Promise<Store>;
  /** How the providers reach servers (through the proxy on the web, D39). */
  readonly http: HttpClient;
  /** Where accounts' credentials are kept; never the store (foundation D36). */
  readonly secrets: SecretStore;
  /**
   * Where `secrets` may find nothing to protect a password with (the desktop
   * without a keyring, desktop D74), it asks here before saving, and the UI
   * asks the user.
   */
  readonly unprotectedPrompt?: UnprotectedPrompt;
  /** Opens a URL in the system browser: Login Flow v2's page (a new tab on the web). */
  readonly openExternal: (url: string) => void;
  /**
   * Signing in to `server` (the address typed, or the one Nextcloud named)
   * begins; the function it returns ends it. A shell that sends plain http
   * only to saved accounts lets it reach this server meanwhile (android D62).
   */
  readonly signingInTo?: (server: string) => () => void;
  /**
   * The system's back button (Android's, android D68): the UI hands it a
   * function that closes what is open, the topmost first, and says whether
   * anything was; when nothing was, the shell leaves the app. Returns the
   * function that stops it. A platform with no back button leaves it out.
   */
  readonly onBack?: (close: () => boolean) => () => void;
  /**
   * Where a Login Flow under way is kept (its token gets an app password, so
   * a secret store), so a page the browser discarded, or an app the system
   * ended, while the user approved on Nextcloud's page takes it up again on
   * its next start (foundation D121). The web and Android, whose page may go
   * while Nextcloud's is in front, have one; the desktop's window lives on.
   */
  readonly pendingSignIn?: SecretStore;
  /**
   * Asks that the store's data be kept, not evicted when the device runs
   * short of space: the web's `navigator.storage.persist()` (foundation
   * D121); resolves with whether it is. Called once the store holds an
   * account, and never again once answered (the answer is kept in
   * `preferences`), since Firefox asks the user.
   */
  readonly keepData?: () => Promise<boolean>;
  /**
   * Where the store lives, for a platform where the same app at another
   * address has a store of its own: the web's origin (foundation D121).
   */
  readonly dataHome?: string;
  /** Where this device's choices are kept (the view, hidden calendars). */
  readonly preferences: Preferences;
  /**
   * Keeps syncs apart where several instances share the store: the web's
   * tabs (foundation D91), Android's app and its background sync (android
   * D67). A shell with one instance of its store has none.
   */
  readonly syncLock?: SyncLock;
  /** Shows the reminders the UI works out (docs/plans/foundation.md#D101). */
  readonly reminders: ReminderScheduler;
  /**
   * A shell that lives on with its window closed (the desktop, desktop D75):
   * the UI hands it its chrome's state on start and at every change, and the
   * settings offer to quit on close instead.
   */
  readonly shell?: (state: ShellState) => void;
  /**
   * A shell's own sync triggers (the desktop's timer, resume and tray, desktop
   * D75): the UI runs each as a sync of its own, so two never run at once;
   * `byUser` (the tray's "Sync now") is the user's own, which tries accounts
   * a server turned away too (foundation D128). Returns the function that
   * stops listening.
   */
  readonly onSyncRequest?: (listener: (byUser: boolean) => void) => () => void;
}
