// Credentials on the desktop (docs/plans/desktop.md#D74): each account's,
// encrypted with safeStorage under a key in the desktop's keyring, in
// `userData/secrets.json`; or, where no keyring protects them, kept until the
// app quits or saved unprotected, as the user chose. Apart from Electron, so
// the decisions are tested in Node with a fake safeStorage.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { SecretSaving } from "../bridge.ts";

/** The part of Electron's `safeStorage` this uses: the asynchronous API only. */
export interface Encryption {
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(
    encrypted: Buffer,
  ): Promise<{ readonly shouldReEncrypt: boolean; readonly result: string }>;
  /** Linux only: which keyring the key lives in, `basic_text` for none. */
  getSelectedStorageBackend(): string;
}

/**
 * One entry of `secrets.json`, with how it was saved, so an unprotected one is
 * never taken for ciphertext once a keyring appears.
 */
type Entry =
  /** Encrypted under the keyring's key; `value` is the ciphertext in base64. */
  | { readonly saved: "keyring"; readonly value: string }
  /** As the user chose where no keyring protects it: the value itself. */
  | { readonly saved: "unprotected"; readonly value: string };

/** `secrets.json`: one entry per key (`account:<id>`, foundation D90). */
interface SecretsFile {
  readonly version: 1;
  readonly secrets: Readonly<Record<string, Entry>>;
}

export interface Secrets {
  get(key: string): Promise<string | null>;
  /**
   * `keyring` saves only where the keyring protects the value, and otherwise
   * writes nothing and answers `no-keyring`, for the page to ask the user.
   */
  set(key: string, value: string, saving: SecretSaving): Promise<"saved" | "no-keyring">;
  delete(key: string): Promise<void>;
}

/**
 * The secrets in the file at `path`. On Linux, Chromium encrypts with a fixed
 * key when it finds no keyring, whatever backend it names (one forced by
 * `--password-store=gnome-libsecret` with no Secret Service running still
 * says `gnome_libsecret`), and marks that ciphertext `v10`; the keyring's is
 * `v11`. So a value is protected only when the backend is a keyring and its
 * ciphertext is not `v10`.
 */
export function secretsFile(options: {
  readonly path: string;
  readonly encryption: Encryption;
  readonly linux: boolean;
}): Secrets {
  const { path, encryption, linux } = options;
  /** Values kept until the app quits, never written. */
  const untilQuit = new Map<string, string>();
  // One operation at a time, so two writes never interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const done = queue.then(work);
    queue = done.catch(() => undefined);
    return done;
  };

  /** The value encrypted, if the keyring protects it; `null` where nothing does. */
  async function encrypt(value: string): Promise<string | null> {
    if (linux && encryption.getSelectedStorageBackend() === "basic_text") return null;
    if (!(await encryption.isAsyncEncryptionAvailable())) return null;
    const encrypted = await encryption.encryptStringAsync(value);
    if (linux && encrypted.subarray(0, 3).toString("latin1") === "v10") return null;
    return encrypted.toString("base64");
  }

  async function read(): Promise<Record<string, Entry>> {
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    try {
      const file = JSON.parse(text) as Partial<SecretsFile>;
      if (file.version === 1 && typeof file.secrets === "object" && file.secrets !== null) {
        return { ...file.secrets };
      }
    } catch {
      // Below: a file that is not ours reads as no secrets.
    }
    console.error(`${path} is not a secrets file; its accounts sign in again.`);
    return {};
  }

  /** Written whole to a file beside it, then moved over it: never half a file. */
  async function write(secrets: Record<string, Entry>): Promise<void> {
    const file: SecretsFile = { version: 1, secrets };
    await mkdir(dirname(path), { recursive: true });
    const next = `${path}.next`;
    await writeFile(next, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
    await rename(next, path);
  }

  async function update(key: string, entry: Entry | null): Promise<void> {
    const secrets = await read();
    if (entry) secrets[key] = entry;
    else if (key in secrets) delete secrets[key];
    else return;
    await write(secrets);
  }

  return {
    get: (key) =>
      serial(async () => {
        const kept = untilQuit.get(key);
        if (kept !== undefined) return kept;
        const entry = (await read())[key];
        if (!entry || typeof entry.value !== "string") return null;
        if (entry.saved === "unprotected") {
          // Saved unprotected for want of a keyring: into the keyring once one is here.
          const encrypted = await encrypt(entry.value);
          if (encrypted) await update(key, { saved: "keyring", value: encrypted });
          return entry.value;
        }
        if (entry.saved !== "keyring") return null;
        let decrypted: { shouldReEncrypt: boolean; result: string };
        try {
          decrypted = await encryption.decryptStringAsync(Buffer.from(entry.value, "base64"));
        } catch {
          // Another keyring, or none now, or a profile copied from elsewhere:
          // the account asks to sign in again. The entry stays, for the
          // keyring that may come back.
          console.warn(`The secret ${key} does not decrypt; its account signs in again.`);
          return null;
        }
        if (decrypted.shouldReEncrypt) {
          const encrypted = await encrypt(decrypted.result);
          if (encrypted) await update(key, { saved: "keyring", value: encrypted });
        }
        return decrypted.result;
      }),

    set: (key, value, saving) =>
      serial(async () => {
        if (saving === "until-quit") {
          untilQuit.set(key, value);
          // Not kept on disk, as the user chose: an older entry goes too.
          await update(key, null);
          return "saved";
        }
        let entry: Entry;
        if (saving === "keyring") {
          const encrypted = await encrypt(value);
          if (!encrypted) return "no-keyring";
          entry = { saved: "keyring", value: encrypted };
        } else {
          entry = { saved: "unprotected", value };
        }
        await update(key, entry);
        untilQuit.delete(key);
        return "saved";
      }),

    delete: (key) =>
      serial(async () => {
        untilQuit.delete(key);
        await update(key, null);
      }),
  };
}
