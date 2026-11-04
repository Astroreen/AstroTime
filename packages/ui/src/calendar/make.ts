// A calendar or list made where the user chose (docs/plans/design.md#D276,
// docs/plans/import.md#D277): on an account's server, now (providers D275),
// or on this device; and why one was not, in words a dialog says. Loaded
// with what makes one.
import type { NewCalendar } from "@astrotime/core";
import { calendarNameOf, CannotMakeCalendarError } from "@astrotime/core/new-calendar";
import type { Account, Calendar, Store } from "@astrotime/storage";
import { makeCalendar, makesCalendars } from "@astrotime/sync/calendars";

import type { Platform } from "../platform.ts";
import { addDeviceCalendar } from "./device-calendar.ts";
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
  const name = calendarNameOf(calendar.name);
  if (name === null)
    return Promise.reject(new CannotMakeCalendarError("no-name", "A calendar needs a name."));
  if (place === DEVICE)
    return addDeviceCalendar(
      store,
      {
        account: deviceAccount,
        calendar: name,
        color: calendar.color,
        components: [calendar.component],
      },
      () => {},
    );
  return makeCalendar({ store, secrets: platform.secrets, http: platform.http }, place, {
    ...calendar,
    name,
  });
}
