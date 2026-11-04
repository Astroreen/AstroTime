// A calendar or list made where the user chose (docs/plans/design.md#D276,
// docs/plans/import.md#D277): on an account's server, now (providers D275),
// or on this device; and why one was not, in words a dialog says. Loaded
// with what makes one.
import type { NewCalendar } from "@astrotime/core";
import type { Account, Calendar, Store } from "@astrotime/storage";
import { makeCalendar, makesCalendars } from "@astrotime/sync/calendars";

import type { Platform } from "../platform.ts";
import { makeDeviceCalendar } from "./device-calendar.ts";
import { DEVICE, type Place } from "./place.ts";

export { whyNotMade, type NotMade } from "./place.ts";

/** The accounts a calendar can be made on, as places: each server account that makes them. */
export const placesOf = (accounts: readonly Account[]) => accounts.filter(makesCalendars);

/**
 * A new calendar or list at `place`: on the account's server, through the
 * sync (`makeCalendar`, which keeps it here once made), or on this device,
 * on its account named `deviceAccount` (made if there is none).
 */
export function makeCalendarAt(
  store: Store,
  platform: Pick<Platform, "http" | "secrets">,
  place: Place,
  calendar: NewCalendar,
  deviceAccount: string,
): Promise<Calendar> {
  // Either way the name is `calendarNameOf`'s: here, or in the sync's `makeCalendar`.
  if (place === DEVICE) return makeDeviceCalendar(store, deviceAccount, calendar);
  return makeCalendar({ store, secrets: platform.secrets, http: platform.http }, place, calendar);
}
