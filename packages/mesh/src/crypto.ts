// The mesh's cryptography, all through WebCrypto so it runs unchanged in
// every shell (docs/plans/server.md#D286, D287): HMAC-SHA-256 proofs of the
// mesh secret, HKDF-SHA-256 keys, AES-GCM sealing.

const subtle = (): SubtleCrypto => globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** Bytes from base64url, or undefined for text that is not. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/** The HMAC-SHA-256 key of a mesh secret: proofs, and the root of the session keys. */
export function proofKey(secret: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/** What a proof is over: its purpose and its parts, unambiguous as JSON. */
function transcript(parts: readonly string[]): Uint8Array<ArrayBuffer> {
  return encoder.encode(JSON.stringify(parts));
}

export async function prove(key: CryptoKey, parts: readonly string[]): Promise<string> {
  return base64url(new Uint8Array(await subtle().sign("HMAC", key, transcript(parts))));
}

/** Whether a proof is right, compared in constant time by WebCrypto. */
export async function verify(
  key: CryptoKey,
  parts: readonly string[],
  proof: string,
): Promise<boolean> {
  const bytes = fromBase64url(proof);
  if (!bytes) return false;
  return subtle().verify("HMAC", key, bytes, transcript(parts));
}

/**
 * The AES-GCM key of one direction of a session: HKDF-SHA-256 from the
 * mesh secret, salted with both sides' nonces (the sender's first), so each
 * direction of each connection has a key of its own.
 */
export async function sealingKey(
  secret: Uint8Array<ArrayBuffer>,
  senderNonce: Uint8Array,
  receiverNonce: Uint8Array,
): Promise<CryptoKey> {
  const root = await subtle().importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  const salt = new Uint8Array(senderNonce.length + receiverNonce.length);
  salt.set(senderNonce);
  salt.set(receiverNonce, senderNonce.length);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: encoder.encode("astrotime-mesh.1 seal") },
    root,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * The IV of a direction's `count`th message. The receiver counts too, so a
 * frame replayed, dropped or reordered does not open.
 */
function iv(count: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(12);
  new DataView(bytes.buffer).setBigUint64(4, BigInt(count));
  return bytes;
}

export async function seal(key: CryptoKey, count: number, text: string): Promise<string> {
  const sealed = await subtle().encrypt(
    { name: "AES-GCM", iv: iv(count) },
    key,
    encoder.encode(text),
  );
  return base64url(new Uint8Array(sealed));
}

/** The text of a sealed frame; throws when it was not sealed with this key and count. */
export async function open(key: CryptoKey, count: number, data: string): Promise<string> {
  const bytes = fromBase64url(data);
  if (!bytes) throw new TypeError("A sealed frame is not base64url");
  return decoder.decode(await subtle().decrypt({ name: "AES-GCM", iv: iv(count) }, key, bytes));
}
