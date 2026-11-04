// Recordings of a service (docs/plans/providers.md#D249): every request a
// scenario sent and the answer it got, with the account's own values put
// out, kept in fixtures/services/; replayed by a client that answers from
// the recording alone and fails on a request it does not hold, so a change
// that asks a service something it was never asked fails at once.
import { digestChallenge, digestHeader } from "../src/digest.ts";
import type { Credentials, HttpClient, HttpRequest, HttpResponse } from "../src/index.ts";

export interface Exchange {
  readonly request: {
    readonly method: string;
    /** Path and query, on the recording's `origin`. */
    readonly path: string;
    readonly depth: string | null;
    /** How the request was signed: its `Authorization`'s scheme alone, never its value. */
    readonly scheme: "Basic" | "Digest" | null;
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
  /** The calendar the scenario made, its name unique to the run. */
  readonly calendar: string;
  readonly exchanges: readonly Exchange[];
}

/** Response headers a recording keeps: what the provider reads, nothing that says who asked. */
const KEPT = ["content-type", "etag", "dav", "location", "retry-after", "www-authenticate"];

const schemeOf = (header: string | undefined): "Basic" | "Digest" | null =>
  header?.startsWith("Basic ") ? "Basic" : header?.startsWith("Digest ") ? "Digest" : null;

/**
 * Wraps `http`, keeping every exchange. `Authorization` is kept as its
 * scheme alone; its values (`sent`) stay in memory, for `leaks` to look for.
 */
export function recorder(http: HttpClient): {
  readonly http: HttpClient;
  readonly exchanges: Exchange[];
  /** Every `Authorization` sent, never written. */
  readonly sent: string[];
} {
  const exchanges: Exchange[] = [];
  const sent: string[] = [];
  return {
    exchanges,
    sent,
    http: async (request) => {
      const authorization = request.headers["Authorization"];
      if (authorization) sent.push(authorization);
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
          depth: request.headers["Depth"] ?? null,
          scheme: schemeOf(authorization),
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

/** Mail domains so common that finding one says nothing of the account. */
const PUBLIC_DOMAINS = new Set([
  "icloud.com",
  "me.com",
  "mac.com",
  "gmail.com",
  "googlemail.com",
  "fastmail.com",
  "fastmail.fm",
  "yandex.ru",
  "ya.ru",
  "yandex.com",
  "mailbox.org",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "zoho.com",
  "gmx.net",
  "gmx.de",
  "web.de",
  "posteo.de",
  "example.com",
]);

/** What the account is, to look for in a recording. */
export interface Account {
  readonly username: string;
  readonly password: string;
  /** More of the account's own values: e-mails the service shows, ids in its paths. */
  readonly extra: readonly string[];
  /** Every `Authorization` the recording sent (`recorder`'s `sent`). */
  readonly sent: readonly string[];
  /**
   * The user name is public: a local test server's fixed one (the interop
   * run's `astro`), which may stand in a recording; never a cloud account's.
   */
  readonly publicUsername?: boolean;
}

/**
 * Every spelling of the account's values a recording could hold: each one
 * raw, URL-encoded, JSON-escaped and XML-escaped, matched in any case; an
 * e-mail's local part (five letters or more) and its domain (unless a
 * public mail domain); and, matched exactly, Basic's base64 of the user
 * and password, of each alone, and the values of every Digest answer sent
 * (`response`, `cnonce`).
 */
function spellings(account: Account): { readonly caseless: string[]; readonly exact: string[] } {
  const values = [account.password, ...account.extra];
  if (!account.publicUsername) values.push(account.username);
  for (const email of [account.username, ...account.extra].filter((value) => value.includes("@"))) {
    if (account.publicUsername && email === account.username) continue;
    const [local = "", domain = ""] = email.split("@");
    if (local.length >= 5) values.push(local);
    if (domain && !PUBLIC_DOMAINS.has(domain.toLowerCase())) values.push(domain);
  }
  const caseless = values
    .flatMap((value) =>
      value.length === 0
        ? []
        : [
            value,
            encodeURIComponent(value),
            JSON.stringify(value).slice(1, -1),
            value
              .replaceAll("&", "&amp;")
              .replaceAll("<", "&lt;")
              .replaceAll(">", "&gt;")
              .replaceAll('"', "&quot;"),
          ],
    )
    .map((value) => value.toLowerCase());
  const base64 = (text: string) =>
    btoa(Array.from(new TextEncoder().encode(text), (byte) => String.fromCodePoint(byte)).join(""));
  const exact = [
    base64(`${account.username}:${account.password}`),
    base64(account.password),
    ...(account.publicUsername ? [] : [base64(account.username)]),
  ];
  for (const header of account.sent) {
    if (header.startsWith("Basic ")) exact.push(header.slice(6));
    for (const name of ["response", "cnonce"]) {
      const value = new RegExp(`${name}="([^"]+)"`).exec(header)?.[1];
      if (value) exact.push(value);
    }
  }
  return { caseless: [...new Set(caseless)], exact: [...new Set(exact)] };
}

/**
 * Which kinds of the account's values `text` still holds, as raw
 * substrings, whatever any scrubbing did; none, for a file safe to write.
 * Says what kind it found, never the value.
 */
export function leaks(text: string, account: Account): string[] {
  const { caseless, exact } = spellings(account);
  const lower = text.toLowerCase();
  const found: string[] = [];
  if (caseless.some((value) => lower.includes(value))) found.push("a value of the account");
  if (exact.some((value) => value.length >= 4 && text.includes(value)))
    found.push("an encoded credential");
  return found;
}

/**
 * The recording with each of `standIns`' values (the account's name,
 * e-mail, the ids a service puts in its paths) replaced by its stand-in,
 * everywhere: paths, bodies, headers. Then `leaks` looks at the result on
 * its own, and any value of the account left, in any spelling, refuses it:
 * no such file is ever written.
 */
export function redacted(
  recording: Recording,
  standIns: ReadonlyMap<string, string>,
  account: Account,
): Recording {
  // Longest first, so an e-mail is replaced before the name inside it; a
  // whole word only, so a short name inside another word stays.
  const pairs = [...standIns].filter(([value]) => value.length > 0);
  pairs.sort((a, b) => b[0].length - a[0].length);
  const word = (value: string) =>
    new RegExp(
      `(?<![A-Za-z0-9])${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`,
      "g",
    );
  const scrub = (text: string) => {
    let out = text;
    for (const [value, standIn] of pairs) {
      out = out.replace(word(value), standIn);
      if (encodeURIComponent(value) !== value)
        out = out.replace(word(encodeURIComponent(value)), encodeURIComponent(standIn));
    }
    return out;
  };
  const result = JSON.parse(scrub(JSON.stringify(recording))) as Recording;
  const found = leaks(JSON.stringify(result), account);
  if (found.length > 0)
    throw new Error(`The recording still holds ${found.join(" and ")}; not written.`);
  return result;
}

/**
 * An `HttpClient` that answers from `recording` in its order, and fails on
 * anything else: another request, another scheme of `Authorization`, or a
 * Digest answer that is not right for the challenge the recording gave
 * last, recomputed with `credentials`.
 */
export function replay(
  recording: Recording,
  credentials: Credentials,
): HttpClient & { readonly left: () => number } {
  let next = 0;
  /** Every challenge the recording gave so far: each signer answers its own. */
  const challenges: string[] = [];
  const client = async (request: HttpRequest): Promise<HttpResponse> => {
    const exchange = recording.exchanges[next];
    const url = new URL(request.url);
    const authorization = request.headers["Authorization"];
    const asked = {
      method: request.method,
      path: `${url.pathname}${url.search}`,
      depth: request.headers["Depth"] ?? null,
      scheme: schemeOf(authorization),
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
    if (asked.scheme === "Digest")
      await checkDigest(authorization!, challenges, request, credentials);
    next += 1;
    const headers = new Map(Object.entries(exchange.response.headers));
    const challenge = headers.get("www-authenticate");
    if (challenge) challenges.push(challenge);
    return {
      status: exchange.response.status,
      url: new URL(exchange.response.path, recording.origin).href,
      header: (name) => headers.get(name.toLowerCase()) ?? null,
      body: exchange.response.body,
    };
  };
  return Object.assign(client, { left: () => recording.exchanges.length - next });
}

/**
 * Whether a Digest answer is right for the recorded challenge whose nonce it
 * names: what the server would check. Each signer answers the challenge its
 * own 401 gave (sabre/dav gives a new nonce with each).
 */
async function checkDigest(
  answer: string,
  headers: readonly string[],
  request: HttpRequest,
  credentials: Credentials,
): Promise<void> {
  const said = (name: string) => new RegExp(`${name}="?([^",]+)"?`).exec(answer)?.[1] ?? "";
  const found = headers
    .map((header) => digestChallenge(header))
    .find((challenge) => challenge?.challenge.nonce === said("nonce"));
  if (!found || said("realm") !== found.challenge.realm)
    throw new Error("A Digest answer to a challenge the recording never gave.");
  const expected = await digestHeader(
    { ...found.challenge, count: 0 },
    credentials,
    request,
    Number.parseInt(said("nc"), 16),
    said("cnonce"),
  );
  const response = (header: string) => /response="([^"]+)"/.exec(header)?.[1];
  if (response(answer) !== response(expected))
    throw new Error(
      "A Digest answer the server would refuse: its response is not the challenge's.",
    );
}
