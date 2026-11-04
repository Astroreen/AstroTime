// How a request proves who sends it (docs/plans/providers.md#D260): HTTP
// Basic at once, as every server AstroTime knew took it; Digest (RFC 7616)
// once a server answers 401 asking for it, as Baïkal does by default. The
// Digest code, MD5 and all, loads only then.
import type { HttpRequest, HttpResponse } from "./http.ts";
import type { Credentials } from "./provider.ts";

/** The `Authorization` header of HTTP Basic for these credentials. */
export function basic({ username, password }: Credentials): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return `Basic ${btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(""))}`;
}

/** A server's Digest challenge, and how many requests answered its nonce. */
export interface DigestChallenge {
  readonly realm: string;
  readonly nonce: string;
  readonly opaque: string | null;
  /** `auth` when the server offers it; `null` for RFC 2069's digest without `qop`. */
  readonly qop: "auth" | null;
  readonly algorithm: "MD5" | "MD5-sess" | "SHA-256" | "SHA-256-sess";
  count: number;
}

/**
 * An OAuth 2 access token and its renewal (docs/plans/providers.md#D254):
 * a server that takes a bearer token, not a password (Google's CalDAV).
 * `renew` gets a new one after the server refused the last, and says
 * whether it did; a refused refresh token throws `AuthError`.
 */
export interface TokenSource {
  token(): Promise<string>;
  /**
   * After a server refused `refused`: a new token, unless one replaced it
   * meanwhile (a request in flight beside it renewed already).
   */
  renew(refused?: string): Promise<boolean>;
}

/**
 * How a server is answered: Basic, a Digest challenge, an OAuth bearer
 * token, or not known yet (`null`): the first request goes without
 * credentials.
 */
export type Scheme = "basic" | "bearer" | DigestChallenge | null;

/**
 * Whether what is sent to `url` crosses a network unencrypted: plain http
 * to another host than this device (D260). There Basic does not go first,
 * and the sign-in dialog says so under the address.
 */
export function inClear(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  return !(
    protocol === "https:" ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    // A literal IPv4 of 127.0.0.0/8, all four parts numbers (URL spells
    // `127.1` so too): `127.evil.example.com` or `127.0.0.1.nip.io` is
    // another host, whatever it resolves to.
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/**
 * Whether Basic may go before the server asks for it: over https, or to
 * this device. Over plain http elsewhere a first Basic would send the
 * password in clear to a server that may want Digest, so the first request
 * there goes without credentials, to learn the scheme (D260).
 */
const basicFirst = (url: string) => !inClear(url);

/**
 * The scheme each server asked of each user, for the app's run (D260): a
 * later sync answers a Digest server at once, with its challenge (nonce,
 * count) as it was left, and sends Basic to a plain-http one without first
 * asking. Not stored: a restart learns it again, for one request.
 */
const known = new Map<string, Scheme>();

/** Forgets every scheme learned (tests, each starting as a new run). */
export const forgetSchemes = (): void => known.clear();

/** One account's credentials, and the scheme its server asked for. */
export class Authorization {
  /** A password's account's credentials; `null` for an OAuth account, which has `tokens`. */
  readonly credentials: Credentials | null;
  /** How its server is answered (`digest.ts` learns it from a 401). */
  scheme: Scheme = null;
  private readonly tokens: TokenSource | null;
  /** Where `known` keeps this server's scheme; set while `scheme` came from it untried. */
  private key = "";
  private recalled = false;

  /** A password's credentials, or a source of OAuth tokens (D254). */
  constructor(credentials: Credentials | TokenSource) {
    if ("token" in credentials) {
      this.tokens = credentials;
      this.credentials = null;
      this.scheme = "bearer";
    } else {
      this.tokens = null;
      this.credentials = credentials;
    }
  }

  /**
   * The `Authorization` header for `request` (`null`: none, to learn the
   * scheme), and the scheme it answers. A Digest answer's count is taken at
   * once, before anything is awaited, so requests signed together never
   * share one; they may still reach the server out of order, which a
   * nonce's count allows.
   */
  async sign(
    request: Pick<HttpRequest, "method" | "url">,
  ): Promise<{ readonly header: string | null; readonly answered: Scheme }> {
    if (this.credentials) {
      this.key = `${new URL(request.url).origin} ${this.credentials.username}`;
      if (this.scheme === null)
        this.recalled = (this.scheme = known.get(this.key) ?? null) !== null;
    }
    if (this.scheme === null && basicFirst(request.url)) this.scheme = "basic";
    const scheme = this.scheme;
    if (this.key && scheme) known.set(this.key, scheme);
    if (scheme === null) return { header: null, answered: null };
    if (scheme === "bearer")
      return {
        header: await (await bearer()).bearerHeader(this.tokens!, request),
        answered: scheme,
      };
    if (scheme === "basic") return { header: basic(this.credentials!), answered: scheme };
    const count = ++scheme.count;
    return {
      header: await (await digest()).digestHeader(scheme, this.credentials!, request, count),
      answered: scheme,
    };
  }

  /**
   * Learns from a 401 to a request signed with `answered` whether sending
   * it again may succeed (`digest.ts`, `answerChallenge`).
   */
  async challenged(
    response: HttpResponse,
    answered: Scheme,
    header: string | null = null,
  ): Promise<boolean> {
    // A refused token is renewed once, unless another request renewed it
    // already; a refused renewal throws AuthError.
    if (answered === "bearer") return (await bearer()).renewBearer(this.tokens!, header);
    const { answerChallenge } = await digest();
    if (answerChallenge(this, response, answered)) return true;
    // A scheme recalled from an earlier sync that the server no longer takes
    // (set up anew): this 401 read as the first answer of a new run, once.
    if (!this.recalled) return false;
    this.recalled = false;
    this.scheme = null;
    return answerChallenge(this, response, null);
  }
}

const digest = () => import("./digest.ts");
const bearer = () => import("./bearer.ts");
