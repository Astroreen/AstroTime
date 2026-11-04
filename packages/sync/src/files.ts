// An account's files (docs/plans/foundation.md#D231), where its provider
// keeps them beside its calendars: a module of its own
// (`@astrotime/sync/files`), loaded when the edit dialog asks, so neither it
// nor the provider's files code comes with the app's first load.
import { filesOf } from "@astrotime/caldav/files";
import { keepsFiles, type HttpClient } from "@astrotime/caldav";
import type { FileStore, SecretStore } from "@astrotime/core";
import type { Account } from "@astrotime/storage";

import { hasFiles } from "./all.ts";
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

/**
 * Why an account has no files to attach from (design D237): its calendars
 * are on this device, its server keeps none, or it is a Nextcloud whose
 * sync is off; `null` when it has files, or when the cause is not known
 * (a CalDAV account whose home is not saved, the demo's).
 */
export function noFilesOf(account: Account): "device" | "server" | "syncOff" | null {
  if (hasFiles(account)) return null;
  if (account.provider === "local") return "device";
  if (account.provider !== "caldav" || !account.homeUrl) return null;
  return keepsFiles(account.homeUrl) ? "syncOff" : "server";
}
