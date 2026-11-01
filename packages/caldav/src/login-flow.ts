import { retryAfter, ServerBusyError } from "@astrotime/core";

import type { HttpClient } from "./http.ts";
import { basic, type Credentials } from "./provider.ts";

/** Server errors in a row after which a poll gives up. */
const SERVER_ERRORS = 5;

/**
 * What a Login Flow v2 under way needs to be polled again, by a page loaded
 * anew after the browser discarded the one that started it
 * (docs/plans/foundation.md#D121). The token gets the app password once the
 * user approves: keep it as a secret.
 */
export interface LoginFlowState {
  /** The server the user named. */
  readonly server: string;
  readonly loginUrl: string;
  readonly endpoint: string;
  readonly token: string;
}

/** A Nextcloud Login Flow v2 in progress (docs/plans/foundation.md#D19). */
export interface LoginFlow {
  /** The page where the user approves access; open it in a browser. */
  readonly loginUrl: string;
  /** What `resumeLoginFlow` takes up again. */
  readonly state: LoginFlowState;
  /**
   * Asks once whether the user approved: their credentials, or `null` while
   * they have not. A rate limit (429) or a server down for a while (503)
   * throws `ServerBusyError`, with its `Retry-After` (foundation D130).
   */
  poll(): Promise<(Credentials & { readonly server: string }) | null>;
}

/**
 * Starts Nextcloud's Login Flow v2: the user approves access on their own
 * server and AstroTime receives an app password, never their password.
 * https://docs.nextcloud.com/server/latest/developer_manual/client_apis/LoginFlow/
 */
export async function startLoginFlow(http: HttpClient, serverUrl: string): Promise<LoginFlow> {
  const start = await http({
    method: "POST",
    url: new URL("index.php/login/v2", serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`).href,
    headers: { Accept: "application/json", "User-Agent": "AstroTime" },
  });
  if (start.status !== 200)
    throw new Error(`${serverUrl} does not offer Nextcloud's Login Flow v2 (${start.status}).`);
  const { login, poll } = parseStart(start.body, serverUrl);
  return resumeLoginFlow(http, {
    server: serverUrl,
    loginUrl: login,
    endpoint: poll.endpoint,
    token: poll.token,
  });
}

/** A Login Flow v2 started before, polled again from its `state`. */
export function resumeLoginFlow(http: HttpClient, state: LoginFlowState): LoginFlow {
  const serverUrl = state.server;
  // Server errors in a row; a server that keeps failing is said to, not waited on.
  let failing = 0;
  return {
    loginUrl: state.loginUrl,
    state,
    async poll() {
      const response = await http({
        method: "POST",
        url: state.endpoint,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: `token=${encodeURIComponent(state.token)}`,
      });
      // 404 until the user approves. Rate limited (429, as a proxy in front
      // of Nextcloud may answer) or a passing server error: not yet, asked
      // again later; the same error several times in a row is the server's.
      // A server that says how long to wait is busy, not failing: it is
      // waited out, never counted toward giving up (foundation D130).
      const wait = retryAfter(response.header("retry-after"));
      const busy = response.status === 429 || response.status === 503;
      failing = response.status >= 500 && !(busy && wait !== null) ? failing + 1 : 0;
      if (failing >= SERVER_ERRORS) {
        throw new Error(`The login flow failed: the server keeps answering ${response.status}.`);
      }
      if (busy) {
        throw new ServerBusyError(`The login flow's poll answered ${response.status}.`, wait);
      }
      if (response.status === 404 || response.status >= 500) return null;
      if (response.status !== 200) throw new Error(`The login flow failed (${response.status}).`);
      const result = json(response.body) as {
        server?: unknown;
        loginName?: unknown;
        appPassword?: unknown;
      };
      if (
        typeof result.server !== "string" ||
        typeof result.loginName !== "string" ||
        typeof result.appPassword !== "string"
      ) {
        throw new Error("The login flow's answer is not Nextcloud's.");
      }
      // The app password goes only to the server the user named.
      if (new URL(result.server).host !== new URL(serverUrl).host) {
        throw new Error(
          `The login flow names ${new URL(result.server).host}, not ${new URL(serverUrl).host}.`,
        );
      }
      // On the user's scheme, like the flow's own pages: the app password is never sent in clear.
      const server = result.server.replace(/^https?:/i, new URL(serverUrl).protocol);
      return { server, username: result.loginName, password: result.appPassword };
    },
  };
}

/**
 * Revokes an app password Login Flow v2 gave (Nextcloud's
 * `DELETE ocs/v2.php/core/apppassword`, signed in with that password), so a
 * device that no longer uses it leaves no way in behind
 * (docs/plans/foundation.md#D90). A password the server refuses already
 * (401: revoked in Nextcloud's settings) has nothing left to revoke. Throws
 * `OfflineError` when the server cannot be reached, and an `Error` when it
 * would not revoke it.
 */
export async function revokeAppPassword(
  http: HttpClient,
  serverUrl: string,
  credentials: Credentials,
): Promise<void> {
  const response = await http({
    method: "DELETE",
    url: new URL(
      "ocs/v2.php/core/apppassword",
      serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`,
    ).href,
    headers: {
      "OCS-APIRequest": "true",
      Accept: "application/json",
      Authorization: basic(credentials),
    },
  });
  if (response.status === 200) return;
  // A 401 means revoked only if the password no longer signs in at all (it
  // was revoked before); a refused call of any other kind is not a revocation.
  if (response.status === 401) {
    const check = await http({
      method: "GET",
      url: new URL("ocs/v2.php/cloud/user", serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`)
        .href,
      headers: {
        "OCS-APIRequest": "true",
        Accept: "application/json",
        Authorization: basic(credentials),
      },
    });
    if (check.status === 401) return;
  }
  throw new Error(`${serverUrl} would not revoke the app password (${response.status}).`);
}

/**
 * The start answer, checked: its pages must be on the server the user named,
 * or a server could send the user (and the poll's token) anywhere.
 */
function parseStart(
  body: string,
  serverUrl: string,
): { login: string; poll: { token: string; endpoint: string } } {
  const data = json(body) as {
    login?: unknown;
    poll?: { token?: unknown; endpoint?: unknown };
  };
  const { login, poll } = data;
  if (
    typeof login !== "string" ||
    typeof poll?.token !== "string" ||
    typeof poll.endpoint !== "string"
  ) {
    throw new Error("The login flow's answer is not Nextcloud's.");
  }
  // The host is compared: behind a TLS terminator Nextcloud may name its
  // pages http:// while the user reached it on https://. They are then used
  // on the user's https, so the token and the app password never go in clear.
  const user = new URL(serverUrl);
  const onUsersScheme = (url: string) => {
    const parsed = new URL(url);
    if (parsed.host !== user.host)
      throw new Error(`The login flow points to ${parsed.host}, not ${user.host}.`);
    parsed.protocol = user.protocol;
    return parsed.href;
  };
  return {
    login: onUsersScheme(login),
    poll: { token: poll.token, endpoint: onUsersScheme(poll.endpoint) },
  };
}

/** The answer's JSON; a page that is not (a captive portal, a proxy's error) says what it is. */
function json(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("The server's answer to the login flow is not Nextcloud's (not JSON).");
  }
}
