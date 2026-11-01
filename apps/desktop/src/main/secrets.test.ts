// Credentials on the desktop (docs/plans/desktop.md#D74): the file's format,
// what is written where no keyring protects it, and entries that no longer
// decrypt; on a fake safeStorage, which marks its ciphertext as Chromium does.
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "vite-plus/test";

import { secretsFile, type Encryption } from "./secrets.ts";

const KEY = "account:7";
const PASSWORD = '{"username":"astro","password":"hunter2"}';

/**
 * A fake safeStorage: `v11` and its keyring's name before the value under a
 * keyring, `v10` under Chromium's fixed key; it decrypts only its own.
 */
function encryption(
  options: {
    backend?: string;
    prefix?: "v10" | "v11";
    keyring?: string;
    available?: boolean;
    shouldReEncrypt?: boolean;
  } = {},
): Encryption & { encrypted: number } {
  const {
    backend = "gnome_libsecret",
    prefix = "v11",
    keyring = "login",
    available = true,
    shouldReEncrypt = false,
  } = options;
  const mark = `${prefix}${keyring}:`;
  return {
    encrypted: 0,
    getSelectedStorageBackend: () => backend,
    isAsyncEncryptionAvailable: async () => available,
    async encryptStringAsync(plainText) {
      this.encrypted++;
      return Buffer.from(mark + plainText);
    },
    async decryptStringAsync(encrypted) {
      const text = encrypted.toString();
      if (!text.startsWith(mark)) throw new Error("Error while decrypting the ciphertext.");
      return { shouldReEncrypt, result: text.slice(mark.length) };
    },
  };
}

const place = () => join(mkdtempSync(join(tmpdir(), "astrotime-secrets-")), "secrets.json");
const open = (path: string, options: Parameters<typeof encryption>[0] = {}) =>
  secretsFile({ path, encryption: encryption(options), linux: true });
const fileOf = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;

test("with a keyring, a secret is saved encrypted, one entry per key, and read again after a restart", async () => {
  const path = place();
  const secrets = open(path);
  expect(await secrets.set(KEY, PASSWORD, "keyring")).toBe("saved");
  expect(await secrets.set("account:8", "other", "keyring")).toBe("saved");
  expect(fileOf(path)).toEqual({
    version: 1,
    secrets: {
      [KEY]: { saved: "keyring", value: Buffer.from(`v11login:${PASSWORD}`).toString("base64") },
      "account:8": { saved: "keyring", value: Buffer.from("v11login:other").toString("base64") },
    },
  });
  // Only the user reads it.
  expect(statSync(path).mode & 0o777).toBe(0o600);

  const restarted = open(path);
  expect(await restarted.get(KEY)).toBe(PASSWORD);
  expect(await restarted.get("account:9")).toBeNull();
  await restarted.delete(KEY);
  expect(await restarted.get(KEY)).toBeNull();
  expect(Object.keys((fileOf(path) as { secrets: object }).secrets)).toEqual(["account:8"]);
});

test("without a keyring nothing is written until the user picks: until the app quits, or unprotected", async () => {
  const path = place();
  const secrets = open(path, { backend: "basic_text", prefix: "v10" });
  expect(await secrets.set(KEY, PASSWORD, "keyring")).toBe("no-keyring");
  expect(existsSync(path)).toBe(false);

  // Until the app quits: in memory only.
  expect(await secrets.set(KEY, PASSWORD, "until-quit")).toBe("saved");
  expect(await secrets.get(KEY)).toBe(PASSWORD);
  expect(existsSync(path)).toBe(false);
  expect(await open(path, { backend: "basic_text", prefix: "v10" }).get(KEY)).toBeNull();

  // Unprotected: written as it is, and said so.
  expect(await secrets.set(KEY, PASSWORD, "unprotected")).toBe("saved");
  expect(fileOf(path)).toEqual({
    version: 1,
    secrets: { [KEY]: { saved: "unprotected", value: PASSWORD } },
  });
  expect(await open(path, { backend: "basic_text", prefix: "v10" }).get(KEY)).toBe(PASSWORD);
});

test("a keyring named but not running encrypts with the fixed key: that is no keyring either", async () => {
  // As `--password-store=gnome-libsecret` with no Secret Service, which Chromium answers with `v10`.
  const path = place();
  const fallback = open(path, { backend: "gnome_libsecret", prefix: "v10" });
  expect(await fallback.set(KEY, PASSWORD, "keyring")).toBe("no-keyring");
  const unavailable = open(path, { available: false });
  expect(await unavailable.set(KEY, PASSWORD, "keyring")).toBe("no-keyring");
  expect(existsSync(path)).toBe(false);
  // Off Linux, `v10` is the system's own encryption (Windows' DPAPI), not a fixed key.
  const windows = secretsFile({ path, encryption: encryption({ prefix: "v10" }), linux: false });
  expect(await windows.set(KEY, PASSWORD, "keyring")).toBe("saved");
});

test("an entry that does not decrypt reads as none, so its account signs in again, and it stays", async () => {
  const path = place();
  await open(path, { keyring: "login" }).set(KEY, PASSWORD, "keyring");
  const before = readFileSync(path, "utf8");
  // A changed keyring, a profile copied to another machine, no keyring now.
  expect(await open(path, { keyring: "another" }).get(KEY)).toBeNull();
  expect(await open(path, { backend: "basic_text", prefix: "v10" }).get(KEY)).toBeNull();
  expect(readFileSync(path, "utf8")).toBe(before);
  // The keyring back: it decrypts again.
  expect(await open(path, { keyring: "login" }).get(KEY)).toBe(PASSWORD);
});

test("a value safeStorage asks to re-encrypt is written again", async () => {
  const path = place();
  await open(path, { keyring: "old" }).set(KEY, PASSWORD, "keyring");
  const rotated = encryption({ keyring: "old", shouldReEncrypt: true });
  const secrets = secretsFile({ path, encryption: rotated, linux: true });
  expect(await secrets.get(KEY)).toBe(PASSWORD);
  expect(rotated.encrypted).toBe(1);
  expect(fileOf(path)).toEqual({
    version: 1,
    secrets: {
      [KEY]: { saved: "keyring", value: Buffer.from(`v11old:${PASSWORD}`).toString("base64") },
    },
  });
});

test("an entry saved unprotected is never taken for ciphertext, and moves into a keyring once there is one", async () => {
  const path = place();
  await open(path, { backend: "basic_text", prefix: "v10" }).set(KEY, PASSWORD, "unprotected");
  expect(await open(path).get(KEY)).toBe(PASSWORD);
  expect(fileOf(path)).toEqual({
    version: 1,
    secrets: {
      [KEY]: { saved: "keyring", value: Buffer.from(`v11login:${PASSWORD}`).toString("base64") },
    },
  });
});

test("keeping a secret until the app quits drops the one saved before; a file not ours reads as none", async () => {
  const path = place();
  const secrets = open(path, { backend: "basic_text", prefix: "v10" });
  await secrets.set(KEY, "old password", "unprotected");
  await secrets.set(KEY, PASSWORD, "until-quit");
  expect(await secrets.get(KEY)).toBe(PASSWORD);
  expect(fileOf(path)).toEqual({ version: 1, secrets: {} });

  writeFileSync(path, "not json");
  expect(await open(path).get(KEY)).toBeNull();
  // A newer build's file is kept aside, not overwritten by the next write.
  const newer = JSON.stringify({ version: 2, secrets: { other: "kept" } });
  writeFileSync(path, newer);
  const reopened = open(path, { backend: "basic_text", prefix: "v10" });
  expect(await reopened.get(KEY)).toBeNull();
  await reopened.set(KEY, PASSWORD, "unprotected");
  const aside = readdirSync(dirname(path)).filter((name) => name.includes(".unreadable-"));
  expect(aside.map((name) => readFileSync(join(dirname(path), name), "utf8"))).toContain(newer);
});
