// What the preload hands the page (docs/plans/desktop.md#D71): one object,
// `window.astrotime`, with exactly what the desktop's adapters need, and the
// IPC channels behind it. The main process checks every argument and that
// the sender is the app's own page.
import type { HttpRequest } from "@astrotime/caldav";
import type { ScheduledReminder } from "@astrotime/core";

/** The app's pages are served here (`protocol.handle`, never `file://`). */
export const APP_SCHEME = "app";
export const APP_HOST = "astrotime";
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/`;

export const CHANNELS = {
  /** One HTTP exchange through the main process, redirects followed (D72). */
  http: "astrotime:http",
  /** An account's credentials: get, set and delete, in the keyring's care (D74). */
  secretsGet: "astrotime:secrets-get",
  secretsSet: "astrotime:secrets-set",
  secretsDelete: "astrotime:secrets-delete",
  /** Opens an http(s) URL in the system browser. */
  openExternal: "astrotime:open-external",
  /** Asks for a port to the store's process; it comes back on the same channel (D73). */
  store: "astrotime:store",
  /** The page's reminders, the whole set, for the main process to show (D76). */
  reminders: "astrotime:reminders",
  /** A reminder the user clicked, from the main process to the page (D76). */
  reminderOpened: "astrotime:reminder-opened",
  /** The main process asks the page to sync: its timer, resume, the tray (D75). */
  sync: "astrotime:sync",
  /** The shell's state from the page's settings: the theme, the close, the words (D75). */
  shell: "astrotime:shell",
} as const;

/** The argument the main process gives the page when the system shows notifications (D76). */
export const NOTIFICATIONS_ARGUMENT = "--astrotime-notifications";

/**
 * What the page's settings set in the main process (D75): the theme the
 * window's frame follows (`nativeTheme.themeSource`), whether closing the
 * window leaves the app running, and the tray's and menu's words in the
 * user's language. The shared UI's `ShellState`.
 */
export interface ShellState {
  readonly theme: "system" | "light" | "dark";
  readonly keepRunning: boolean;
  readonly words: {
    readonly open: string;
    readonly syncNow: string;
    readonly closeWindow: string;
    readonly quit: string;
  };
}

/** The data of the window message that carries the store's port to the page. */
export const STORE_PORT = "astrotime:store-port";

/** An answer as it crosses IPC: headers by lower-case name, repeated ones joined with ", ". */
export type HttpAnswer =
  | {
      readonly status: number;
      readonly url: string;
      readonly headers: Readonly<Record<string, string>>;
      readonly body: string;
    }
  /** The server could not be reached, or the answer broke off. */
  | { readonly offline: string };

/**
 * How a secret is saved (D74): `keyring` encrypted under the keyring's key,
 * and only where a keyring protects it; otherwise as the user chose, kept
 * `until-quit` (never written) or saved `unprotected` in the profile.
 */
export type SecretSaving = "keyring" | "until-quit" | "unprotected";

export const SECRET_SAVINGS: readonly SecretSaving[] = ["keyring", "until-quit", "unprotected"];

export interface Bridge {
  http(request: HttpRequest): Promise<HttpAnswer>;
  readonly secrets: {
    get(key: string): Promise<string | null>;
    /** `no-keyring`: nothing was written, since no keyring would protect it. */
    set(key: string, value: string, saving: SecretSaving): Promise<"saved" | "no-keyring">;
    delete(key: string): Promise<void>;
  };
  openExternal(url: string): void;
  /** The port arrives as a window message from the app's own origin, data `STORE_PORT`. */
  connectStore(): void;
  readonly reminders: {
    /** Whether the system shows notifications, as the main process found at start. */
    readonly supported: boolean;
    /** Replaces the set the main process shows (D76). */
    schedule(reminders: readonly ScheduledReminder[]): void;
    /** Hears a reminder the user clicked; returns the function that stops it. */
    onOpen(listener: (reminder: ScheduledReminder) => void): () => void;
  };
  shell(state: ShellState): void;
  /**
   * Hears the main process ask for a sync, `byUser` for the tray's "Sync
   * now"; returns the function that stops it.
   */
  onSyncRequest(listener: (byUser: boolean) => void): () => void;
}
