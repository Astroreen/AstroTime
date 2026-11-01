import type { HttpClient } from "@astrotime/caldav";
import type { SecretStore } from "@astrotime/core";
import type { Store } from "@astrotime/storage";
import type { SyncLock } from "@astrotime/sync";

import type { Preferences } from "./preferences.ts";

/**
 * What a shell hands the UI's root: its adapters of the platform interfaces
 * (docs/plans/android.md#D60), the same shape on the web, Android and the
 * desktop. Reminders join with PR 6.
 */
export interface Platform {
  /** The local store, opening; created once, outside React. */
  readonly store: Promise<Store>;
  /** How the providers reach servers (through the proxy on the web, D39). */
  readonly http: HttpClient;
  /** Where accounts' credentials are kept; never the store (foundation D36). */
  readonly secrets: SecretStore;
  /** Opens a URL in the system browser: Login Flow v2's page (a new tab on the web). */
  readonly openExternal: (url: string) => void;
  /** Where this device's choices are kept (the view, hidden calendars). */
  readonly preferences: Preferences;
  /**
   * Keeps syncs apart where several instances share the store: the web's
   * tabs (foundation D91). A shell with one instance of its store has none.
   */
  readonly syncLock?: SyncLock;
}
