import type { HttpClient } from "./http.ts";
import type { Credentials } from "./provider.ts";

/** A Nextcloud Login Flow v2 in progress (docs/plans/foundation.md#D19). */
export interface LoginFlow {
  /** The page where the user approves access; open it in a browser. */
  readonly loginUrl: string;
  /** Asks once whether the user approved: their credentials, or `null` while they have not. */
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
  return {
    loginUrl: login,
    async poll() {
      const response = await http({
        method: "POST",
        url: poll.endpoint,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: `token=${encodeURIComponent(poll.token)}`,
      });
      // 404 until the user approves.
      if (response.status === 404) return null;
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
      return { server: result.server, username: result.loginName, password: result.appPassword };
    },
  };
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
