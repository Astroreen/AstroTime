// HTTP Digest (RFC 7616), loaded only once a server asks for it
// (docs/plans/providers.md#D260). MD5 is not in Web Crypto, so it is here;
// SHA-256 is Web Crypto's.
import type { Authorization, DigestChallenge } from "./auth.ts";
import type { HttpRequest, HttpResponse } from "./http.ts";
import type { Credentials } from "./provider.ts";

/**
 * Takes up a server's Digest challenge: a first one, or a stale nonce
 * (RFC 7616 §3.3), is worth sending the request again; a second refusal
 * of the same scheme is the credentials refused.
 */
export function answerChallenge(authorization: Authorization, response: HttpResponse): boolean {
  // Through the web proxy, the server's challenge comes under its own name
  // (proxy.ts's CHALLENGE, spelled here so this chunk imports nothing).
  const found = digestChallenge(
    response.header("www-authenticate") ?? response.header("x-astrotime-www-authenticate"),
  );
  if (!found || (authorization.digest && !found.stale)) return false;
  authorization.digest = { ...found.challenge, count: 0 };
  return true;
}

const PARAM = /([a-z0-9-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi;

/**
 * The Digest challenge among a `WWW-Authenticate` header's, with an
 * algorithm this client speaks; `null` when there is none. A header may
 * hold several challenges (Basic beside Digest); only Digest's parameters
 * are read.
 */
export function digestChallenge(
  header: string | null,
): { readonly challenge: Omit<DigestChallenge, "count">; readonly stale: boolean } | null {
  if (!header) return null;
  const start = header.search(/(^|,)\s*digest\s/i);
  if (start < 0) return null;
  const rest = header.slice(start).replace(/^,?\s*digest\s+/i, "");
  // Up to the next scheme: a bare token followed by a space, not a parameter.
  const end = rest.search(/,\s*[a-z0-9-]+\s+[a-z0-9-]+\s*=/i);
  const params = new Map<string, string>();
  for (const match of (end < 0 ? rest : rest.slice(0, end)).matchAll(PARAM)) {
    params.set(match[1]!.toLowerCase(), match[2]?.replace(/\\(.)/g, "$1") ?? match[3] ?? "");
  }
  const realm = params.get("realm");
  const nonce = params.get("nonce");
  if (realm === undefined || nonce === undefined) return null;
  const named = (params.get("algorithm") ?? "MD5").toUpperCase();
  const algorithm = (["MD5", "MD5-SESS", "SHA-256", "SHA-256-SESS"] as const).find(
    (known) => known === named,
  );
  if (!algorithm) return null;
  const qops = new Set((params.get("qop") ?? "").split(",").map((qop) => qop.trim().toLowerCase()));
  if (params.has("qop") && !qops.has("auth")) return null;
  return {
    challenge: {
      realm,
      nonce,
      opaque: params.get("opaque") ?? null,
      qop: qops.has("auth") ? "auth" : null,
      algorithm: algorithm.replace("-SESS", "-sess") as DigestChallenge["algorithm"],
    },
    stale: params.get("stale")?.toLowerCase() === "true",
  };
}

/** The `Authorization` header answering `challenge` for `request`; counts the nonce's use. */
export async function digestHeader(
  challenge: DigestChallenge,
  { username, password }: Credentials,
  request: Pick<HttpRequest, "method" | "url">,
  cnonce: string = randomHex(),
): Promise<string> {
  const hash = challenge.algorithm.startsWith("SHA-256") ? sha256 : md5;
  const url = new URL(request.url);
  const uri = `${url.pathname}${url.search}`;
  let ha1 = await hash(`${username}:${challenge.realm}:${password}`);
  if (challenge.algorithm.endsWith("-sess"))
    ha1 = await hash(`${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = await hash(`${request.method}:${uri}`);
  challenge.count += 1;
  const nc = challenge.count.toString(16).padStart(8, "0");
  const response = await hash(
    challenge.qop
      ? `${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`
      : `${ha1}:${challenge.nonce}:${ha2}`,
  );
  const quoted = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;
  const params = [
    `username=${quoted(username)}`,
    `realm=${quoted(challenge.realm)}`,
    `nonce=${quoted(challenge.nonce)}`,
    `uri=${quoted(uri)}`,
    `algorithm=${challenge.algorithm}`,
    `response=${quoted(response)}`,
    ...(challenge.opaque === null ? [] : [`opaque=${quoted(challenge.opaque)}`]),
    ...(challenge.qop ? [`qop=${challenge.qop}`, `nc=${nc}`, `cnonce=${quoted(cnonce)}`] : []),
  ];
  return `Digest ${params.join(", ")}`;
}

function randomHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), hex).join("");
}

const hex = (byte: number) => byte.toString(16).padStart(2, "0");

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), hex).join("");
}

// RFC 1321's MD5, of the text's UTF-8 bytes, as lower-case hex.
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const SINES = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

export function md5(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const length = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(length);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(length - 4, Math.floor(bytes.length / 2 ** 29), true);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let block = 0; block < length; block += 64) {
    let [a, b, c, d] = state as [number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      const f =
        round === 0
          ? (b & c) | (~b & d)
          : round === 1
            ? (d & b) | (~d & c)
            : round === 2
              ? b ^ c ^ d
              : c ^ (b | ~d);
      const g =
        round === 0
          ? i
          : round === 1
            ? (5 * i + 1) % 16
            : round === 2
              ? (3 * i + 5) % 16
              : (7 * i) % 16;
      const sum = (a + f + SINES[i]! + view.getUint32(block + g * 4, true)) | 0;
      const shift = SHIFTS[round * 4 + (i % 4)]!;
      [a, d, c] = [d, c, b];
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
    }
    state[0] = (state[0]! + a) | 0;
    state[1] = (state[1]! + b) | 0;
    state[2] = (state[2]! + c) | 0;
    state[3] = (state[3]! + d) | 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  state.forEach((word, i) => outView.setUint32(i * 4, word, true));
  return Promise.resolve(Array.from(out, hex).join(""));
}
