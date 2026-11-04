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

  /**
   * The `Authorization` header for `request`, and the challenge it answers
   * (`null`: Basic). A Digest answer's count is taken at once, before
   * anything is awaited, so requests signed together never share one; they
   * may still reach the server out of order, which a nonce's count allows.
   */
  async sign(
    request: Pick<HttpRequest, "method" | "url">,
  ): Promise<{ readonly header: string; readonly answered: DigestChallenge | null }> {
    const challenge = this.digest;
    if (!challenge) return { header: basic(this.credentials), answered: null };
    const count = ++challenge.count;
    return {
      header: await (await digest()).digestHeader(challenge, this.credentials, request, count),
      answered: challenge,
    };
  }

  /**
   * Learns from a 401 to a request signed for `answered` whether sending it
   * again may succeed (`digest.ts`, `answerChallenge`).
   */
  async challenged(response: HttpResponse, answered: DigestChallenge | null): Promise<boolean> {
    return (await digest()).answerChallenge(this, response, answered);
  }
}

const digest = () => import("./digest.ts");
