/**
 * Where a platform keeps secrets: an account's credentials, as JSON
 * (docs/plans/android.md#D60). Each shell brings one: IndexedDB on the web
 * (docs/plans/foundation.md#D89), the Keystore on Android, the keyring on the
 * desktop. Secrets never go into the local store (foundation D36).
 */
export interface SecretStore {
  /** The secret under `key`, or `null` when there is none (or it can no longer be read). */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
