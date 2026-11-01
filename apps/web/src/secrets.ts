// The web app's secret store (docs/plans/foundation.md#D19, D89): accounts'
// credentials in IndexedDB, on this device only, encrypted with an AES-GCM
// key that is kept in the same database and cannot be exported. That keeps
// the passwords out of plain sight (the browser's storage inspector, a search
// through the profile's files); it does not stop script running in the page,
// which may use the key, nor a reader of the disk who knows the format.
import type { SecretStore } from "@astrotime/core";

const SECRETS = "secrets";
const KEYS = "keys";
const KEY = "aes-gcm";

interface Sealed {
  readonly iv: Uint8Array<ArrayBuffer>;
  readonly data: ArrayBuffer;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.addEventListener("success", () => resolve(req.result));
    req.addEventListener("error", () => reject(req.error));
  });
}

function open(name: string): Promise<IDBDatabase> {
  const req = indexedDB.open(name, 1);
  req.addEventListener("upgradeneeded", () => {
    req.result.createObjectStore(SECRETS);
    req.result.createObjectStore(KEYS);
  });
  return request(req);
}

/** Runs `work` on one store in a transaction and resolves when it is committed. */
async function inStore<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const transaction = db.transaction(store, mode);
  const result = request(work(transaction.objectStore(store)));
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
  return result;
}

/** The database's key, made on first use; the browser never hands out its bytes. */
async function keyOf(db: IDBDatabase): Promise<CryptoKey> {
  const found = await inStore<CryptoKey | undefined>(db, KEYS, "readonly", (s) => s.get(KEY));
  if (found) return found;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  // Two tabs making one at once: the first written wins, and both use it.
  await inStore(db, KEYS, "readwrite", (s) => s.add(key, KEY)).catch(() => {});
  return (await inStore<CryptoKey | undefined>(db, KEYS, "readonly", (s) => s.get(KEY))) ?? key;
}

export function indexedDbSecrets(name = "astrotime-secrets"): SecretStore {
  let opened: Promise<{ db: IDBDatabase; key: CryptoKey }> | null = null;
  const ready = () =>
    (opened ??= open(name)
      .then(async (db) => ({ db, key: await keyOf(db) }))
      .catch((error) => {
        opened = null;
        throw error;
      }));
  return {
    async get(id) {
      const { db, key } = await ready();
      const sealed = await inStore<Sealed | undefined>(db, SECRETS, "readonly", (s) => s.get(id));
      if (!sealed) return null;
      try {
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: sealed.iv },
          key,
          sealed.data,
        );
        return new TextDecoder().decode(plain);
      } catch {
        // Sealed under another key (its database was cleared in part): the user signs in again.
        return null;
      }
    },
    async set(id, value) {
      const { db, key } = await ready();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(value),
      );
      await inStore(db, SECRETS, "readwrite", (s) => s.put({ iv, data } satisfies Sealed, id));
    },
    async delete(id) {
      const { db } = await ready();
      await inStore(db, SECRETS, "readwrite", (s) => s.delete(id));
    },
  };
}
