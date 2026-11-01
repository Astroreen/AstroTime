import type { SecretStore } from "@astrotime/core";

/**
 * Credentials in memory, for as long as the app runs: an account asks to sign
 * in again after a restart. PR A2 brings the Keystore-backed store
 * (docs/plans/android.md#D64).
 */
export function memorySecrets(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
}
