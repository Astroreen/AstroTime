// Revoking an app password Nextcloud's Login Flow v2 gave
// (docs/plans/foundation.md#D90): on the first load, as removing an account
// and signing in again use it, while the flow itself (`login-flow.ts`) loads
// with the first sign-in (docs/plans/providers.md#D260).
import { basic } from "./auth.ts";
import type { HttpClient } from "./http.ts";
import type { Credentials } from "./home.ts";

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
