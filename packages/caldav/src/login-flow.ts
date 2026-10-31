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
      const result = JSON.parse(response.body) as {
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
  const data = JSON.parse(body) as {
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
  const origin = new URL(serverUrl).origin;
  for (const url of [login, poll.endpoint]) {
    if (new URL(url).origin !== origin)
      throw new Error(`The login flow points to ${new URL(url).origin}, not ${origin}.`);
  }
  return { login, poll: { token: poll.token, endpoint: poll.endpoint } };
}
