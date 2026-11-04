// Recordings of a service (docs/plans/providers.md#D249): every request a
// scenario sent and the answer it got, with the account's own values put
// out, kept in fixtures/services/; replayed by a client that answers from
// the recording alone and fails on a request it does not hold, so a change
// that asks a service something it was never asked fails at once.
import type { HttpClient, HttpRequest, HttpResponse } from "../src/index.ts";

export interface Exchange {
  readonly request: {
    readonly method: string;
    /** Path and query, on the recording's `origin`. */
    readonly path: string;
    readonly depth: string | null;
    readonly body: string | null;
  };
  readonly response: {
    readonly status: number;
    /** The path that answered, after redirects (the well-known address's). */
    readonly path: string;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  };
}

export interface Recording {
  /** The service, and what recorded it and when, for fixtures/services/README.md. */
  readonly service: string;
  readonly recorded: string;
  readonly origin: string;
  /** The address the scenario was given, as a user types it. */
  readonly server: string;
  readonly exchanges: readonly Exchange[];
}

/** Response headers a recording keeps: what the provider reads, nothing that says who asked. */
const KEPT = ["content-type", "etag", "dav", "location", "retry-after", "www-authenticate"];

/** Wraps `http`, keeping every exchange; `Authorization` and cookies are never kept. */
export function recorder(http: HttpClient): {
  readonly http: HttpClient;
  readonly exchanges: Exchange[];
} {
  const exchanges: Exchange[] = [];
  return {
    exchanges,
    http: async (request) => {
      const response = await http(request);
      const url = new URL(request.url);
      const headers: Record<string, string> = {};
      for (const name of KEPT) {
        const value = response.header(name);
        if (value !== null) headers[name] = value;
      }
      exchanges.push({
        request: {
          method: request.method,
          path: `${url.pathname}${url.search}`,
          depth: request.headers["Depth"] ?? request.headers["depth"] ?? null,
          body: typeof request.body === "string" ? request.body : null,
        },
        response: {
          status: response.status,
          path: `${new URL(response.url).pathname}${new URL(response.url).search}`,
          headers,
          body: response.body,
        },
      });
      return response;
    },
  };
}

/**
 * The recording with each of `secrets` (the account's name, e-mail, the
 * ids a service puts in its paths) replaced by its stand-in, everywhere:
 * paths, bodies, headers. Refuses to give one that still holds any of
 * them, or `password`, so no such file is ever written.
 */
export function redacted(
  recording: Recording,
  secrets: ReadonlyMap<string, string>,
  password: string,
): Recording {
  // Longest first, so an e-mail is replaced before the name inside it; a
  // whole word only, so a short name inside another word stays.
  const pairs = [...secrets].filter(([secret]) => secret.length > 0);
  pairs.sort((a, b) => b[0].length - a[0].length);
  const word = (secret: string) =>
    new RegExp(
      `(?<![A-Za-z0-9])${secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`,
      "g",
    );
  const scrub = (text: string) => {
    let out = text;
    for (const [secret, standIn] of pairs) {
      out = out.replace(word(secret), standIn);
      if (encodeURIComponent(secret) !== secret)
        out = out.replace(word(encodeURIComponent(secret)), encodeURIComponent(standIn));
    }
    return out;
  };
  const result = JSON.parse(scrub(JSON.stringify(recording))) as Recording;
  const text = JSON.stringify(result);
  for (const secret of [password, ...secrets.keys()]) {
    if (
      secret.length > 0 &&
      (word(secret).test(text) ||
        (encodeURIComponent(secret) !== secret && word(encodeURIComponent(secret)).test(text)))
    )
      throw new Error("The recording still holds one of the account's own values; not written.");
  }
  return result;
}

/** An `HttpClient` that answers from `recording` in its order, and fails on anything else. */
export function replay(recording: Recording): HttpClient & { readonly left: () => number } {
  let next = 0;
  const client = async (request: HttpRequest): Promise<HttpResponse> => {
    const exchange = recording.exchanges[next];
    const url = new URL(request.url);
    const asked = {
      method: request.method,
      path: `${url.pathname}${url.search}`,
      depth: request.headers["Depth"] ?? request.headers["depth"] ?? null,
      body: typeof request.body === "string" ? request.body : null,
    };
    if (
      !exchange ||
      url.origin !== recording.origin ||
      JSON.stringify(asked) !== JSON.stringify(exchange.request)
    ) {
      throw new Error(
        `Request ${next + 1} is not the recording's: asked ${JSON.stringify(asked)}, recorded ${JSON.stringify(exchange?.request ?? null)}.`,
      );
    }
    next += 1;
    const headers = new Map(Object.entries(exchange.response.headers));
    return {
      status: exchange.response.status,
      url: new URL(exchange.response.path, recording.origin).href,
      header: (name) => headers.get(name.toLowerCase()) ?? null,
      body: exchange.response.body,
    };
  };
  return Object.assign(client, { left: () => recording.exchanges.length - next });
}
