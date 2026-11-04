// HTTP Digest (RFC 7616), loaded only once a server asks for it
// (docs/plans/providers.md#D260). MD5 is not in Web Crypto, so it is here;
// SHA-256 is Web Crypto's.
import type { Authorization, DigestChallenge, Scheme } from "./auth.ts";
import type { HttpRequest, HttpResponse } from "./http.ts";
import type { Credentials } from "./provider.ts";

/**
 * Learns from a 401 to a request signed with `answered` (`null`: sent
 * without credentials) whether sending it again may succeed, and how. A
 * request signed before another's 401 taught the current scheme (requests
 * in flight together) is sent again with that. A Digest challenge is taken
 * up, and the request sent again, when the request did not answer it: a
 * first one, a stale nonce (RFC 7616 §3.3), or a new nonce the server
 * gives without saying `stale` (nginx's and others' Digest). A request sent
 * without credentials, to learn the scheme, is sent again with Basic when
 * the server asks for no Digest. Anything else is the credentials refused.
 */
export function answerChallenge(
  authorization: Authorization,
  response: HttpResponse,
  answered: Scheme,
): boolean {
  if (authorization.scheme !== answered) return true;
  // Through the web proxy, the server's challenge comes under its own name
  // (proxy.ts's CHALLENGE, spelled here so this chunk imports nothing).
  const found = digestChallenge(
    response.header("www-authenticate") ?? response.header("x-astrotime-www-authenticate"),
  );
  const answeredDigest = typeof answered === "object" && answered !== null ? answered : null;
  if (found && (!answeredDigest || found.stale || found.challenge.nonce !== answeredDigest.nonce)) {
    authorization.scheme = { ...found.challenge, count: 0 };
    return true;
  }
  if (answered === null) {
    authorization.scheme = "basic";
    return true;
  }
  // A scheme the server no longer takes (set up anew since an earlier sync
  // learned it: Basic where it took Digest, or back) is asked again in the
  // one this 401 names, once. The same scheme refused is the password
  // refused, never sent twice (a brute-force guard counts the user's).
  authorization.scheme = null;
  return (
    answerChallenge(authorization, response, null) &&
    kindOf(authorization.scheme) !== kindOf(answered)
  );
}

const kindOf = (scheme: Scheme) => (typeof scheme === "object" && scheme ? "digest" : scheme);

/**
 * A request to `url` sent again with the scheme a 401 taught (`answered`):
 * kept for the account's syncs after once the server took it (a 2xx,
 * D260), unless the answer came from elsewhere (where a redirect went). A
 * wrong password's is not kept.
 */
export function taken(
  authorization: Authorization,
  url: string,
  response: HttpResponse,
  answered: Scheme,
): void {
  if (answered !== authorization.scheme || response.status < 200 || response.status > 299) return;
  if (
    answered &&
    authorization.remembered &&
    new URL(response.url || url).origin === new URL(url).origin
  )
    authorization.remembered.scheme = answered;
}

/**
 * A `WWW-Authenticate` header's challenges (RFC 9110 §11.6.1), each its
 * scheme in lower case and its parameters, names in lower case; a quoted
 * value is read whole, commas, `=` and scheme names in it too, its
 * escapes undone. A token68 (Negotiate's) is kept as a parameter of no name.
 */
export function challengesOf(
  header: string,
): { readonly scheme: string; readonly params: Map<string, string> }[] {
  const TOKEN = /[!#$%&'*+.^_`|~0-9A-Za-z-]+/y;
  const found: { scheme: string; params: Map<string, string> }[] = [];
  let at = 0;
  const skip = (pattern: RegExp) => {
    pattern.lastIndex = at;
    const match = pattern.exec(header);
    if (match) at = pattern.lastIndex;
    return match;
  };
  while (at < header.length) {
    skip(/[\s,]*/y);
    const token = skip(TOKEN)?.[0];
    if (!token) {
      // Nothing this grammar reads: the rest is no challenge.
      break;
    }
    const before = at;
    skip(/\s*/y);
    if (header[at] === "=" && found.length > 0) {
      at += 1;
      skip(/\s*/y);
      const quoted = skip(/"((?:[^"\\]|\\.)*)"/y);
      const value = quoted ? quoted[1]!.replace(/\\(.)/g, "$1") : (skip(/[^\s,]*/y)?.[0] ?? "");
      found.at(-1)!.params.set(token.toLowerCase(), value);
      continue;
    }
    at = before;
    found.push({ scheme: token.toLowerCase(), params: new Map() });
    // A token68 right after the scheme (`Negotiate abc==`), not a parameter.
    skip(/\s+/y);
    const token68 = skip(/[A-Za-z0-9\-._~+/]+=*(?=\s*(,|$))/y);
    if (token68) found.at(-1)!.params.set("", token68[0]);
  }
  return found;
}

/**
 * The first Digest challenge of a `WWW-Authenticate` header with an
 * algorithm and a `qop` this client speaks; `null` when there is none.
 */
export function digestChallenge(
  header: string | null,
): { readonly challenge: Omit<DigestChallenge, "count">; readonly stale: boolean } | null {
  if (!header) return null;
  for (const { scheme, params } of challengesOf(header)) {
    if (scheme !== "digest") continue;
    const read = readDigest(params);
    if (read) return read;
  }
  return null;
}

function readDigest(
  params: Map<string, string>,
): { readonly challenge: Omit<DigestChallenge, "count">; readonly stale: boolean } | null {
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

/** The `Authorization` header answering `challenge` for `request`, its `count`-th use of the nonce. */
export async function digestHeader(
  challenge: DigestChallenge,
  { username, password }: Credentials,
  request: Pick<HttpRequest, "method" | "url">,
  /** This answer's use of the nonce, from 1 (`nc`). */
  count: number,
  cnonce: string = randomHex(),
): Promise<string> {
  const hash = challenge.algorithm.startsWith("SHA-256") ? sha256 : md5;
  const url = new URL(request.url);
  const uri = `${url.pathname}${url.search}`;
  let ha1 = await hash(`${username}:${challenge.realm}:${password}`);
  if (challenge.algorithm.endsWith("-sess"))
    ha1 = await hash(`${ha1}:${challenge.nonce}:${cnonce}`);
  const ha2 = await hash(`${request.method}:${uri}`);
  const nc = count.toString(16).padStart(8, "0");
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
