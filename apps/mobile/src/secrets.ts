import type { SecretStore } from "@astrotime/core";

/**
 * What the app uses of `@aparajita/capacitor-secure-storage`: a string under
 * a key, kept as AES-GCM ciphertext in the app's shared preferences under a
 * key of its own in the Android Keystore (docs/plans/android.md#D64).
 */
export interface NativeSecrets {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Credentials under a Keystore key: they survive a restart, and the app's
 * data alone (a copy of its files) does not read them. The key needs no
 * user authentication, so background sync can read them too (D67).
 */
export function keystoreSecrets(plugin: NativeSecrets): SecretStore {
  return {
    async get(key) {
      try {
        return await plugin.getItem(key);
      } catch (error) {
        // Ciphertext that no longer reads, malformed or sealed under another
        // key: as if none were saved, so the account asks to sign in again,
        // as on the web (foundation D89). Any other failure is said.
        if (unreadable(error)) return null;
        throw error;
      }
    },
    set: (key, value) => plugin.setItem(key, value),
    delete: (key) => plugin.removeItem(key),
  };
}

/** The plugin's `StorageError` for ciphertext that does not decrypt: its code, and the cause's name. */
function unreadable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  const message = error instanceof Error ? error.message : "";
  return (
    error.code === "invalidData" ||
    (error.code === "osError" && message.includes("AEADBadTagException"))
  );
}
