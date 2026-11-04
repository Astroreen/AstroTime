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

/** One account's credentials, and the scheme its server asked for. */
export class Authorization {
  readonly credentials: Credentials;
  /** The server's Digest challenge, once it asked for Digest (`digest.ts`). */
  digest: DigestChallenge | null = null;

  constructor(credentials: Credentials) {
    this.credentials = credentials;
  }

  /** The `Authorization` header for `request`. */
  async header(request: Pick<HttpRequest, "method" | "url">): Promise<string> {
    return this.digest
      ? (await digest()).digestHeader(this.digest, this.credentials, request)
      : basic(this.credentials);
  }

  /**
   * Learns from a 401 how the server wants to be answered: whether the
   * request is worth sending again (`digest.ts`, `answerChallenge`).
   */
  async challenged(response: HttpResponse): Promise<boolean> {
    return (await digest()).answerChallenge(this, response);
  }
}

const digest = () => import("./digest.ts");
