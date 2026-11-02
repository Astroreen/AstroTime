// An account's files (docs/plans/foundation.md#D231), where its provider
// keeps them beside its calendars: a module of its own
// (`@astrotime/sync/files`), loaded when the edit dialog asks, so neither it
// nor the provider's files code comes with the app's first load.
import { filesOf } from "@astrotime/caldav/files";
import type { HttpClient } from "@astrotime/caldav";
import type { FileStore, SecretStore } from "@astrotime/core";
import type { Account } from "@astrotime/storage";

import { readSecret } from "./secret.ts";

/**
 * An account's files, opened with its saved credentials; none for the
 * calendar on this device, an account whose sync is off (no request goes
 * to its server, D171), one signed out, or a server with none. Opening
 * them makes no request.
 */
export async function accountFiles(
  context: { readonly http: HttpClient; readonly secrets: SecretStore },
  account: Account,
): Promise<FileStore | null> {
  if (account.provider !== "caldav" || account.syncOff || !account.homeUrl) return null;
  const secret = await readSecret(context.secrets, account.id);
  return secret ? filesOf(context.http, secret.credentials, account.homeUrl) : null;
}
