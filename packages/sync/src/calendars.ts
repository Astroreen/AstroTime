// Making a calendar or task list on an account's server
// (docs/plans/providers.md#D275), a subpath of its own
// (`@astrotime/sync/calendars`), loaded with the dialog that makes one.
import type { NewCalendar } from "@astrotime/core";

import type { HttpClient } from "@astrotime/caldav";
import type { Account, Calendar } from "@astrotime/storage";

import { afterSyncs, connectCalDav, type Connect, type SyncContext } from "./all.ts";
import { readSecret } from "./secret.ts";

/**
 * Whether calendars and task lists can be made on an account's server:
 * a CalDAV account's (its server may still refuse, which is said). The
 * calendar on this device is the store's own; a subscription makes none.
 */
export const makesCalendars = (account: Pick<Account, "provider">): boolean =>
  account.provider === "caldav";

/** No calendar can be made on this account: not on a server AstroTime makes them on, or signed out. */
export class CannotMakeCalendarError extends Error {
  override name = "CannotMakeCalendarError";
}

/**
 * Makes a calendar or task list on the account's server, now, and keeps it
 * here as the next sync will list it; the new calendar comes back. It
 * needs the server: offline, its `OfflineError` is thrown and nothing is
 * made (D275). Saved once no sync is listing, so none removes it.
 */
export async function makeCalendar(
  // The platform's HTTP, through which this opens the account's provider as
  // a sync does; or the provider's opening itself (a test's).
  context: Pick<SyncContext, "store" | "secrets" | "lock"> &
    ({ readonly http: HttpClient } | { readonly connect: Connect }),
  accountId: string,
  calendar: NewCalendar,
): Promise<Calendar> {
  const account = (await context.store.accounts()).find((a) => a.id === accountId);
  if (!account || !makesCalendars(account))
    throw new CannotMakeCalendarError("This account makes no calendars on a server.");
  const credentials = (await readSecret(context.secrets, accountId))?.credentials;
  if (!credentials) throw new CannotMakeCalendarError("No credentials are saved for this account.");
  const connect = "connect" in context ? context.connect : connectCalDav(context.http);
  const provider = await connect(account, credentials);
  if (!provider.makeCalendar)
    throw new CannotMakeCalendarError("This account's server makes no calendars.");
  const { state: _, ...made } = await provider.makeCalendar(calendar);
  return afterSyncs(context, () => context.store.saveCalendar({ accountId, ...made }));
}
