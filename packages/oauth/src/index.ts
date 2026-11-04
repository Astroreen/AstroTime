// OAuth 2 for the providers that take no password (docs/plans/providers.md#D254):
// the authorization code with PKCE (RFC 7636, S256) and a `state`, the code
// exchanged for tokens, the access token renewed with the refresh token.
// Isomorphic (AGENTS.md rule 1): the platform opens the URL and brings the
// redirect back; requests go through its `HttpClient`. Loaded only when an
// OAuth account is added or syncs (D255).
import type { HttpClient, TokenSource } from "@astrotime/caldav";
import { AuthError, OfflineError, retryAfter, ServerBusyError } from "@astrotime/core/provider";

/**
 * RFC 6749 §5.2's errors that end a sign-in for good, on a refresh: the
 * grant revoked, or its scopes no longer given. `invalid_client` and
 * `unauthorized_client` say the app's client is wrong (a deployment's
 * registration changed), which signing in again would not mend: they are
 * tried again later, as a busy service (D254).
 */
const SIGNED_OUT = new Set(["invalid_grant", "invalid_scope"]);
const CLIENT_REFUSED = new Set(["invalid_client", "unauthorized_client"]);

/** A service's OAuth endpoints and this app's client there. */
export interface OAuthClient {
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly clientId: string;
  /**
   * Google's web clients send one with the code (D254); there the image adds
   * it itself, so the page never holds it: absent everywhere else.
   */
  readonly clientSecret?: string;
  readonly scopes: readonly string[];
  /** More query parameters for the authorization URL (Google's `access_type=offline`). */
  readonly extra?: Readonly<Record<string, string>>;
}

/** Google's endpoints (D252): its CalDAV for events, the Tasks API for tasks. */
export const GOOGLE = {
  authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenEndpoint: "https://oauth2.googleapis.com/token",
  scopes: ["https://www.googleapis.com/auth/calendar", "https://www.googleapis.com/auth/tasks"],
  // A refresh token, and asked for again when the user signs in again.
  extra: { access_type: "offline", prompt: "consent" },
} as const satisfies Omit<OAuthClient, "clientId">;

/** Microsoft's identity platform for personal and work accounts alike (D253). */
export const MICROSOFT = {
  authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes: ["offline_access", "User.Read", "Calendars.ReadWrite", "Tasks.ReadWrite"],
} as const satisfies Omit<OAuthClient, "clientId">;

/**
 * Where a sign-in's answer comes back on a platform (D254): Android's own
 * scheme, the desktop's loopback address, the web's `oauth.html`.
 */
export interface OAuthRedirect {
  /**
   * Makes one sign-in ready: its redirect URI, for the authorization URL.
   * Called in the user's click itself, before anything is awaited: the web
   * opens its window there, where no popup blocker holds it.
   */
  begin(): Promise<OAuthAttempt>;
}

export interface OAuthAttempt {
  readonly redirectUri: string;
  /**
   * Shows the service's page; resolves with the redirect's URL, or `null`
   * when the user left it. Not every platform hears the page closed: on the
   * web the window is cut from the app (no `opener`) and not watched, so
   * there `null` comes only from `cancel`, and the sign-in offers its
   * Cancel; a window the browser refused rejects (`PopupBlockedError`).
   */
  open(url: string): Promise<string | null>;
  /** Stops waiting: `open` resolves `null`, and what waited for the answer goes. */
  cancel(): void;
}

/** The tokens a sign-in gives: the refresh token is kept as a password is (the secret store). */
export interface Tokens {
  readonly accessToken: string;
  /** When the access token stops working, in milliseconds since the epoch. */
  readonly expiresAt: number;
  readonly refreshToken: string;
}

/** What a sign-in under way keeps until the redirect comes back. */
export interface Pending {
  readonly state: string;
  readonly verifier: string;
  readonly redirectUri: string;
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const random = (length: number) => base64url(crypto.getRandomValues(new Uint8Array(length)));

/** RFC 7636's S256: the verifier's SHA-256, base64url. */
export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Starts a sign-in: the URL to open, and what to keep until the redirect
 * comes back (a fresh verifier of 43 characters and state each time).
 */
export async function authorization(
  client: OAuthClient,
  redirectUri: string,
): Promise<{ readonly url: string; readonly pending: Pending }> {
  const pending = { state: random(24), verifier: random(32), redirectUri };
  const url = new URL(client.authorizationEndpoint);
  url.search = new URLSearchParams({
    // A client's own parameters first: none of them can stand in for the
    // sign-in's own (its state, challenge, redirect) that follow.
    ...client.extra,
    response_type: "code",
    client_id: client.clientId,
    redirect_uri: redirectUri,
    scope: client.scopes.join(" "),
    state: pending.state,
    code_challenge: await challengeOf(pending.verifier),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.href, pending };
}

/** The user said no, or the service did; `error` is OAuth's code (`access_denied`). */
export class OAuthRefusedError extends Error {
  override name = "OAuthRefusedError";
  readonly error: string;
  constructor(error: string, description: string | null) {
    super(`The sign-in was refused (${error})${description ? `: ${description}` : ""}.`);
    this.error = error;
  }
}

/**
 * The redirect back, read: its code, once its `state` is the one this
 * sign-in sent (a redirect another page started, or one forged, is refused).
 */
export function codeOf(redirect: string, pending: Pending): string {
  const params = new URL(redirect).searchParams;
  // The service's refusal first: a denied sign-in may come back without a state.
  const error = params.get("error");
  if (error) throw new OAuthRefusedError(error, params.get("error_description"));
  if (params.get("state") !== pending.state)
    throw new OAuthRefusedError("state_mismatch", "the answer is not to this sign-in");
  const code = params.get("code");
  if (!code) throw new OAuthRefusedError("no_code", null);
  return code;
}

async function token(
  http: HttpClient,
  client: OAuthClient,
  grant: Record<string, string>,
  now: number,
): Promise<{
  readonly accessToken: string;
  readonly expiresAt: number;
  readonly refreshToken: string | null;
}> {
  const response = await http({
    method: "POST",
    url: client.tokenEndpoint,
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
      ...grant,
    }).toString(),
  });
  let answer: {
    access_token?: unknown;
    expires_in?: unknown;
    refresh_token?: unknown;
    error?: unknown;
    error_description?: unknown;
  } = {};
  try {
    answer = JSON.parse(response.body) as typeof answer;
  } catch {
    // Not JSON (a captive portal, a proxy's page): said below by its status.
  }
  // RFC 6749 §5.2: a refresh token that no longer works is the account
  // signed out; a code that does not (used, expired, another verifier) is
  // this sign-in refused, the account untouched.
  // A refresh the service refuses for good (the grant revoked, this client
  // or its scopes no longer allowed) is the account to sign in again.
  if (
    grant["grant_type"] === "refresh_token" &&
    typeof answer.error === "string" &&
    SIGNED_OUT.has(answer.error)
  )
    throw new AuthError(`The service refused the sign-in (${answer.error}): sign in again.`);
  if (
    grant["grant_type"] === "refresh_token" &&
    typeof answer.error === "string" &&
    CLIENT_REFUSED.has(answer.error)
  )
    throw new ServerBusyError(`The service refused this app's client (${answer.error}).`, null);
  if (answer.error === "invalid_grant")
    throw new OAuthRefusedError("invalid_grant", "the code is used, expired or not this sign-in's");
  if (response.status >= 500)
    throw new OfflineError(`The token endpoint answered ${response.status}.`);
  // Rate limited, or a 4xx that is no OAuth answer (a proxy's, a portal's):
  // tried again later, never taken for a refusal of the sign-in.
  if (response.status === 429 || (response.status >= 400 && typeof answer.error !== "string"))
    throw new ServerBusyError(
      `The token endpoint answered ${response.status}.`,
      retryAfter(response.header("retry-after")),
    );
  if (typeof answer.error === "string")
    throw new OAuthRefusedError(
      answer.error,
      typeof answer.error_description === "string" ? answer.error_description : null,
    );
  if (response.status !== 200 || typeof answer.access_token !== "string")
    throw new Error(`The token endpoint answered ${response.status} without a token.`);
  // A number, or a number in a string (some services write it so); an hour without one.
  const given = Number(answer.expires_in);
  const seconds = Number.isFinite(given) && given > 0 ? given : 3600;
  return {
    accessToken: answer.access_token,
    expiresAt: now + seconds * 1000,
    refreshToken: typeof answer.refresh_token === "string" ? answer.refresh_token : null,
  };
}

/** The code the redirect brought, exchanged with the verifier for the tokens. */
export async function exchange(
  http: HttpClient,
  client: OAuthClient,
  code: string,
  pending: Pending,
  now = Date.now(),
): Promise<Tokens> {
  const tokens = await token(
    http,
    client,
    {
      grant_type: "authorization_code",
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirectUri,
    },
    now,
  );
  if (!tokens.refreshToken)
    throw new OAuthRefusedError("no_refresh_token", "the service gave no lasting sign-in");
  return { ...tokens, refreshToken: tokens.refreshToken };
}

/** How long before it expires an access token is renewed, so a request does not meet its end. */
const EARLY_MS = 60_000;

/**
 * The service gave a new refresh token (rotated) that the secret store
 * would not keep: it works for now, in memory, but not after a restart,
 * when the account will have to sign in again (D254).
 */
export class TokenNotKeptError extends Error {
  override name = "TokenNotKeptError";
}

/**
 * The tokens as the CalDAV provider asks for them (`TokenSource`): the
 * access token while it lasts, renewed with the refresh token when it is
 * about to end or a server refused it. A service that gives a new refresh
 * token with the access token (Microsoft) has it kept through `keep`.
 * Renewals at once share one request.
 */
export function tokenSource(
  http: HttpClient,
  client: OAuthClient,
  tokens: Tokens,
  keep: (tokens: Tokens) => Promise<void>,
  clock: () => number = Date.now,
  /**
   * Hears a rotated refresh token the device could not keep
   * (`TokenNotKeptError`): requests go on with the new access token, and the
   * account says it will need signing in again after a restart.
   */
  report: (problem: TokenNotKeptError) => void = () => {},
): TokenSource {
  let current = tokens;
  let renewing: Promise<boolean> | null = null;
  const renew = (refused?: string) => {
    // A request refused with a token that another renewal replaced meanwhile:
    // the new one is there already, no refresh more (and none rotated).
    if (refused !== undefined && refused !== current.accessToken) return Promise.resolve(true);
    return (renewing ??= (async () => {
      try {
        const next = await token(
          http,
          client,
          { grant_type: "refresh_token", refresh_token: current.refreshToken },
          clock(),
        );
        const rotated = next.refreshToken !== null && next.refreshToken !== current.refreshToken;
        current = { ...next, refreshToken: next.refreshToken ?? current.refreshToken };
        try {
          await keep(current);
        } catch (error) {
          // In use now, so the request goes on; reported, since a restart
          // would lose a rotated one, on every path (early or after a 401).
          if (rotated)
            report(
              new TokenNotKeptError("The new sign-in could not be kept on this device.", {
                cause: error,
              }),
            );
        }
        return true;
      } finally {
        renewing = null;
      }
    })());
  };
  return {
    async token() {
      if (clock() >= current.expiresAt - EARLY_MS) {
        try {
          await renew();
        } catch (error) {
          // Early, offline or a busy service: the token still works until it
          // ends; the renewal is tried again with the next request.
          if (error instanceof AuthError || clock() >= current.expiresAt) throw error;
        }
      }
      return current.accessToken;
    },
    renew,
  };
}
