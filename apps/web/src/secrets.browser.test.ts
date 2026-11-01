// The web's secret store in Chromium's IndexedDB (docs/plans/foundation.md#D89).
import { expect, test } from "vite-plus/test";

import { indexedDbSecrets } from "./secrets.ts";

let n = 0;
const database = () => `secrets-test-${Date.now()}-${n++}`;

/** Every value IndexedDB holds in a database's store, as the browser keeps it. */
async function raw(name: string, store: string): Promise<unknown[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name);
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
  const values = await new Promise<unknown[]>((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
  db.close();
  return values;
}

test("a secret is kept, read back, replaced and deleted, and outlives the page's handle", async () => {
  const name = database();
  const secrets = indexedDbSecrets(name);
  expect(await secrets.get("account:a")).toBeNull();
  await secrets.set("account:a", '{"username":"astro","password":"first"}');
  await secrets.set("account:a", '{"username":"astro","password":"second"}');
  await secrets.set("account:b", "other");
  // Another handle on the same database, as after a reload.
  const again = indexedDbSecrets(name);
  expect(await again.get("account:a")).toBe('{"username":"astro","password":"second"}');
  await again.delete("account:a");
  expect([await again.get("account:a"), await again.get("account:b")]).toEqual([null, "other"]);
});

test("the password is not stored in clear, and the key cannot be exported", async () => {
  const name = database();
  await indexedDbSecrets(name).set("account:a", "correct horse battery staple");
  const [sealed] = (await raw(name, "secrets")) as { iv: Uint8Array; data: ArrayBuffer }[];
  const bytes = new TextDecoder().decode(sealed!.data);
  expect(bytes).not.toContain("correct horse");
  expect(sealed!.iv).toHaveLength(12);
  const [key] = (await raw(name, "keys")) as CryptoKey[];
  expect([key!.extractable, key!.algorithm.name]).toEqual([false, "AES-GCM"]);
  await expect(crypto.subtle.exportKey("raw", key!)).rejects.toThrow();
});

test("a secret sealed under a key that is gone reads as none, so the account asks to sign in again", async () => {
  const name = database();
  await indexedDbSecrets(name).set("account:a", "secret");
  // The key alone is cleared, as a partial wipe of the site's data would.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(name);
    req.addEventListener("success", () => {
      const tx = req.result.transaction("keys", "readwrite");
      tx.objectStore("keys").clear();
      tx.addEventListener("complete", () => {
        req.result.close();
        resolve();
      });
    });
    req.addEventListener("error", () => reject(req.error));
  });
  expect(await indexedDbSecrets(name).get("account:a")).toBeNull();
});
