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
 * How a server is answered: Basic, a Digest challenge, or not known yet
 * (`null`): the first request goes without credentials.
 */
export type Scheme = "basic" | DigestChallenge | null;

/**
 * Whether Basic may go before the server asks for it: over https, or to
 * this device. Over plain http elsewhere a first Basic would send the
 * password in clear to a server that may want Digest, so the first request
 * there goes without credentials, to learn the scheme (D260).
 */
function basicFirst(url: string): boolean {
  const { protocol, hostname } = new URL(url);
  return (
    protocol === "https:" ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "[::1]" ||
    /^127\.\d+\.\d+\.\d+$/.test(hostname)
  );
}

/** One account's credentials, and the scheme its server asked for. */
export class Authorization {
  readonly credentials: Credentials;
  /** How its server is answered (`digest.ts` learns it from a 401). */
  scheme: Scheme = null;

  constructor(credentials: Credentials) {
    this.credentials = credentials;
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
    if (this.scheme === null && basicFirst(request.url)) this.scheme = "basic";
    const scheme = this.scheme;
    if (scheme === null) return { header: null, answered: null };
    if (scheme === "basic") return { header: basic(this.credentials), answered: scheme };
    const count = ++scheme.count;
    return {
      header: await (await digest()).digestHeader(scheme, this.credentials, request, count),
      answered: scheme,
    };
  }

  /**
   * Learns from a 401 to a request signed with `answered` whether sending
   * it again may succeed (`digest.ts`, `answerChallenge`).
   */
  async challenged(response: HttpResponse, answered: Scheme): Promise<boolean> {
    return (await digest()).answerChallenge(this, response, answered);
  }
}

const digest = () => import("./digest.ts");
