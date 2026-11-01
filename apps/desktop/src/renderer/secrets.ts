import type { SecretStore } from "@astrotime/core";

/**
 * Credentials kept in memory until the app quits; the keyring comes with PR
 * D2 (docs/plans/desktop.md#D74). After a restart every account asks to sign
 * in again.
 */
export function memorySecrets(): SecretStore {
  const values = new Map<string, string>();
  return {
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
}
