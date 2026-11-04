// Making a calendar or task list on an account's server
// (docs/plans/providers.md#D275), a subpath of its own
// (`@astrotime/sync/calendars`), loaded with the dialog that makes one.
import type { NewCalendar } from "@astrotime/core";
import { calendarNameOf, CannotMakeCalendarError } from "@astrotime/core/new-calendar";

import type { HttpClient } from "@astrotime/caldav";
import type { Account, Calendar } from "@astrotime/storage";

import { connectCalDav, type Connect, type SyncContext } from "./all.ts";
import { readSecret } from "./secret.ts";

/**
 * Whether calendars and task lists can be made on an account's server:
 * a CalDAV account's (its server may still refuse, which is said). The
 * calendar on this device is the store's own; a subscription makes none.
 */
export const makesCalendars = (account: Pick<Account, "provider">): boolean =>
  account.provider === "caldav";

export { CannotMakeCalendarError } from "@astrotime/core/new-calendar";

/**
 * Makes a calendar or task list on the account's server, now, and keeps it
 * here as the next sync will list it; the new calendar comes back. It
 * needs the server: offline, its `OfflineError` is thrown and nothing is
 * made (D275). A sync whose listing came before it leaves it be: it
 * removes only calendars it had kept before it listed. A name that is
 * nothing once trimmed, an account on no such server, or one signed out:
 * `CannotMakeCalendarError`, before anything is sent.
 */
export async function makeCalendar(
  // The platform's HTTP, through which this opens the account's provider as
  // a sync does; or the provider's opening itself (a test's).
  context: Pick<SyncContext, "store" | "secrets"> &
    ({ readonly http: HttpClient } | { readonly connect: Connect }),
  accountId: string,
  calendar: NewCalendar,
): Promise<Calendar> {
  const name = calendarNameOf(calendar.name);
  if (name === null) throw new CannotMakeCalendarError("no-name", "A calendar needs a name.");
  const account = (await context.store.accounts()).find((a) => a.id === accountId);
  if (!account || !makesCalendars(account))
    throw new CannotMakeCalendarError("no-server", "This account makes no calendars on a server.");
  const credentials = (await readSecret(context.secrets, accountId))?.credentials;
  if (!credentials)
    throw new CannotMakeCalendarError("signed-out", "No credentials are saved for this account.");
  const connect = "connect" in context ? context.connect : connectCalDav(context.http);
  const provider = await connect(account, credentials);
  // A provider without the method makes none; one with it says so itself
  // when its server, or part, makes none (`unsupported`).
  if (!provider.makeCalendar)
    throw new CannotMakeCalendarError("unsupported", "This account's server makes no calendars.");
  const { state: _, ...made } = await provider.makeCalendar({ ...calendar, name });
  return context.store.saveCalendar({ accountId, ...made });
}
