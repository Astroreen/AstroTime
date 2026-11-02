// Accounts' credentials (docs/plans/foundation.md#D36): the platform's
// (`SecretStore`), never the store's; the key and the JSON are spelled
// here only. A module of its own, so the files' lazy code
// (`files.ts`) reads them without the sync engine.
import type { Credentials } from "@astrotime/caldav";
import type { SecretStore } from "@astrotime/core";

export const keyOf = (accountId: string) => `account:${accountId}`;

/** The credentials kept for an account, and whether Login Flow v2 gave its password. */
export async function readSecret(
  secrets: SecretStore,
  accountId: string,
): Promise<{ readonly credentials: Credentials; readonly loginFlow: boolean } | null> {
  return parseSecret(await secrets.get(keyOf(accountId)));
}

export function parseSecret(
  value: string | null,
): { readonly credentials: Credentials; readonly loginFlow: boolean } | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value) as {
      username?: unknown;
      password?: unknown;
      loginFlow?: unknown;
    };
    if (typeof parsed.username === "string" && typeof parsed.password === "string") {
      return {
        credentials: { username: parsed.username, password: parsed.password },
        loginFlow: parsed.loginFlow === true,
      };
    }
  } catch {
    // Unreadable: as if none were saved, so the user signs in again.
  }
  return null;
}
