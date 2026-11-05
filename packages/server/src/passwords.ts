// Passwords as the server keeps them (docs/plans/server.md#D282): scrypt
// with N=2¹⁵, r=8, p=1 and a 16-byte salt, written as
// `scrypt$<N>$<r>$<p>$<salt>$<key>` (base64), so a later change of the
// parameters still reads the hashes made before it.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 2 ** 15;
const R = 8;
const P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  // scrypt needs 128·N·r bytes: 32 MiB here, which is Node's default ceiling.
  const maxmem = 256 * (options.N ?? N) * (options.r ?? R);
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFC"), salt, KEY_BYTES, { ...options, maxmem }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = hash.split("$");
  if (scheme !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
