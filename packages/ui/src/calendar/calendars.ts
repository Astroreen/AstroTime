// The store's calendars as the UI shows them: the calendar on this device
// (and its account) named in the language spoken now, not in the one spoken
// when it was made (docs/plans/foundation.md#D122). Every read of calendars
// for the UI goes through here.
import type { Calendar, Store } from "@astrotime/storage";

/** The calendars, the one on this device named `localName`. */
export async function shownCalendars(store: Store, localName: string): Promise<Calendar[]> {
  const local = new Set(
    (await store.accounts())
      .filter((account) => account.provider === "local")
      .map((account) => account.id),
  );
  // Rows read afresh for this call alone, so named in place.
  const calendars = await store.calendars();
  for (const calendar of calendars) if (local.has(calendar.accountId)) calendar.name = localName;
  return calendars;
}
