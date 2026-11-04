// A new Google calendar (docs/plans/providers.md#D275): Google's CalDAV
// makes none (`MKCALENDAR` is not among its methods), so the Calendar API's
// `calendars.insert` does, under the account's `calendar` scope; the
// calendar is then Google's CalDAV's like any other, at the address its
// listing names. Google keeps colours of its own: the calendar takes the
// one Google gives it.
import { Authorization, type HttpClient, type TokenSource } from "@astrotime/caldav";
import { send } from "@astrotime/caldav/provider";
import type { NewCalendar, RemoteCalendar } from "@astrotime/core/provider";

/** Google's CalDAV, where discovery of an account's calendar home starts. */
export const GOOGLE_CALDAV = "https://apidata.googleusercontent.com/caldav/v2/";
export const CALENDAR_API = "https://www.googleapis.com/calendar/v3/";

export class GoogleCalendars {
  private readonly http: HttpClient;
  private readonly authorization: Authorization;

  constructor(http: HttpClient, tokens: TokenSource) {
    this.http = http;
    this.authorization = new Authorization(tokens);
  }

  async makeCalendar(calendar: NewCalendar): Promise<RemoteCalendar> {
    const response = await send(
      this.http,
      this.authorization,
      {
        method: "POST",
        url: `${CALENDAR_API}calendars`,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ summary: calendar.name }),
      },
      [],
    );
    const made = JSON.parse(response.body || "{}") as { id?: unknown; summary?: unknown };
    if (typeof made.id !== "string" || made.id === "")
      throw new Error("Google made a calendar and named no id.");
    return {
      // A calendar's collection as Google documents it, its id percent-encoded
      // (`@` too) as `canonicalHref` spells a listed one (to be recorded, D275).
      url: `${GOOGLE_CALDAV}${encodeURIComponent(made.id)}/events/`,
      name: typeof made.summary === "string" ? made.summary : calendar.name,
      color: null,
      components: ["VEVENT"],
      rights: { create: true, edit: true, delete: true },
    };
  }
}
