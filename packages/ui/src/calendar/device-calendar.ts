// A calendar or list made on this device, by the import and by "+ New
// list" (docs/plans/import.md#D269, docs/plans/design.md#D276); loaded with them.
import { ALL_RIGHTS, type NewCalendar } from "@astrotime/core";
import { calendarNameOf, CannotMakeCalendarError } from "@astrotime/core/new-calendar";
import { LOCAL_SERVER, type Calendar, type Component, type Store } from "@astrotime/storage";

/**
 * A new calendar on this device (import D269, design D276): on the account of provider `local`,
 * made (named `names.account`) when there is none, under an address of its
 * own, so it keeps its name and never steps aside as the first one does
 * (`Store.removeLocalCalendarIfUnused`, foundation D122). Here, with what
 * makes one (the import, "+ New list"), not in the store, which loads with
 * the app.
 */
export async function addDeviceCalendar(
  store: Store,
  names: {
    readonly account: string;
    readonly calendar: string;
    readonly color: string | null;
    readonly components: readonly Component[];
  },
  /** Called with the account's id when this call made it. */
  madeAccount: (id: string) => void,
): Promise<Calendar> {
  let local = (await store.accounts()).find((account) => account.provider === "local");
  if (!local) {
    local = await store.addAccount({
      provider: "local",
      name: names.account,
      serverUrl: LOCAL_SERVER,
      username: null,
    });
    madeAccount(local.id);
  }
  return store.saveCalendar({
    accountId: local.id,
    url: `${LOCAL_SERVER}${crypto.randomUUID()}/`,
    name: names.calendar,
    color: names.color,
    components: names.components,
    rights: ALL_RIGHTS,
  });
}

/**
 * A calendar or list asked for (`NewCalendar`) made on this device: its
 * name as a server's would be sent (`calendarNameOf`), the one path for
 * "+ New list" and `makeCalendarAt` alike.
 */
export function makeDeviceCalendar(
  store: Store,
  deviceAccount: string,
  calendar: NewCalendar,
): Promise<Calendar> {
  const name = calendarNameOf(calendar.name);
  if (name === null)
    return Promise.reject(new CannotMakeCalendarError("no-name", "A calendar needs a name."));
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
}
