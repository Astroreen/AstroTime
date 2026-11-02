// People for a mention (docs/plans/design.md#D208), a subpath of its own
// (`@astrotime/sync/people`), so the web app loads it with the edit dialog.
import type { Person } from "@astrotime/core";

import type { HttpClient } from "@astrotime/caldav";

import { connectCalDav, type Connect, type SyncContext } from "./all.ts";
import { readSecret } from "./secret.ts";

/**
 * People the server of an account knows by name or e-mail, for a mention in
 * a description (docs/plans/design.md#D208): asked of its provider with its
 * credentials, now. Nobody for an account that is not on a server, has no
 * credentials, or whose provider has no people; `null` when the server could
 * not be asked (offline, refused): no answer, which a caller does not keep,
 * and a mention can still be typed.
 */
export async function peopleOf(
  // The platform's HTTP, through which this opens the account's provider as
  // a sync does; or the provider's opening itself (a test's).
  context: Pick<SyncContext, "store" | "secrets"> &
    ({ readonly http: HttpClient } | { readonly connect: Connect }),
  accountId: string,
  query: string,
): Promise<Person[] | null> {
  const account = (await context.store.accounts()).find((a) => a.id === accountId);
  if (account?.provider !== "caldav") return [];
  const credentials = (await readSecret(context.secrets, accountId))?.credentials;
  if (!credentials) return [];
  try {
    const connect = "connect" in context ? context.connect : connectCalDav(context.http);
    const provider = await connect(account, credentials);
    return (await provider.people?.(query)) ?? [];
  } catch {
    return null;
  }
}
