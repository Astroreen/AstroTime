// People for a mention (docs/plans/design.md#D208), a subpath of its own
// (`@astrotime/sync/people`), so the web app loads it with the edit dialog.
import type { Person } from "@astrotime/core";

import type { SyncContext } from "./all.ts";
import { readSecret } from "./secret.ts";

/**
 * People the server of an account knows by name or e-mail, for a mention in
 * a description (docs/plans/design.md#D208): asked of its provider with its
 * credentials, now. Nobody for an account that is not on a server, has no
 * credentials, or whose provider has no people; nobody when the server
 * cannot be asked (offline, refused), since a mention can also be typed.
 */
export async function peopleOf(
  context: Pick<SyncContext, "store" | "secrets" | "connect">,
  accountId: string,
  query: string,
): Promise<Person[]> {
  const account = (await context.store.accounts()).find((a) => a.id === accountId);
  if (account?.provider !== "caldav") return [];
  const credentials = (await readSecret(context.secrets, accountId))?.credentials;
  if (!credentials) return [];
  try {
    const provider = await context.connect(account, credentials);
    return (await provider.people?.(query)) ?? [];
  } catch {
    return [];
  }
}
