// The Keystore-backed secret store's TypeScript side (docs/plans/android.md#D64):
// the plugin is replaced, so this runs in Node; the Keystore itself is
// checked on a device (PR A2's evidence).
import { expect, test } from "vite-plus/test";

import { keystoreSecrets, type NativeSecrets } from "../src/secrets.ts";

/** The plugin over a map, or one whose reads reject as it does. */
function plugin(read?: { code: string; message: string }) {
  const values = new Map<string, string>();
  const native: NativeSecrets = {
    getItem: async (key) => {
      if (read) throw Object.assign(new Error(read.message), { code: read.code });
      return values.get(key) ?? null;
    },
    setItem: async (key, value) => void values.set(key, value),
    removeItem: async (key) => void values.delete(key),
  };
  return { native, values };
}

test("a secret is kept, replaced and removed under its key", async () => {
  const { native, values } = plugin();
  const secrets = keystoreSecrets(native);
  expect(await secrets.get("account:a")).toBeNull();
  await secrets.set("account:a", '{"username":"astro","password":"first"}');
  await secrets.set("account:a", '{"username":"astro","password":"second"}');
  await secrets.set("account:b", "other");
  expect(await secrets.get("account:a")).toBe('{"username":"astro","password":"second"}');
  await secrets.delete("account:a");
  expect(await secrets.get("account:a")).toBeNull();
  expect([...values.keys()]).toEqual(["account:b"]);
});

test("ciphertext that no longer decrypts reads as none, so the account signs in again; other failures are said", async () => {
  const malformed = keystoreSecrets(
    plugin({ code: "invalidData", message: "The data in the store is in an invalid format" })
      .native,
  );
  expect(await malformed.get("account:a")).toBeNull();
  const otherKey = keystoreSecrets(
    plugin({ code: "osError", message: "An OS error occurred (AEADBadTagException)" }).native,
  );
  expect(await otherKey.get("account:a")).toBeNull();
  const keystore = keystoreSecrets(
    plugin({ code: "osError", message: "An OS error occurred (KeyStoreException)" }).native,
  );
  await expect(keystore.get("account:a")).rejects.toMatchObject({ code: "osError" });
});
