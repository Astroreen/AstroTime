// A new calendar on a CalDAV server (docs/plans/providers.md#D275), loaded
// when one is made.
import { ALL_RIGHTS, type NewCalendar, type RemoteCalendar } from "@astrotime/core";
import { calendarNameOf, CannotMakeCalendarError } from "@astrotime/core/new-calendar";

import type { HttpRequest, HttpResponse } from "./http.ts";
import { canonicalHref } from "./provider.ts";
import { escape, NAMESPACES } from "./xml.ts";

/**
 * A new calendar in the home (`MKCALENDAR`, RFC 4791 §5.3.1) with its name,
 * colour and the one component it holds, at an address of the name's
 * letters and a few random ones. A 405 is the address taken, or the method
 * not allowed at all: an `Allow` that leaves `MKCALENDAR` out, or a second
 * 405 at a new random address (one taken twice by chance is 1 in 4·10⁹),
 * says the server makes no calendars (`unsupported`), as a 501 does. Given
 * as the listing will name it, with every right: the user's own.
 */
export async function mkcalendar(
  homeUrl: string,
  request: (request: HttpRequest, accept: readonly number[]) => Promise<HttpResponse>,
  calendar: NewCalendar,
): Promise<RemoteCalendar> {
  const name = calendarNameOf(calendar.name);
  if (name === null) throw new CannotMakeCalendarError("no-name", "A calendar needs a name.");
  const body = `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar ${NAMESPACES}><d:set><d:prop><d:displayname>${escape(name)}</d:displayname>${calendar.color ? `<ic:calendar-color>${escape(calendar.color)}</ic:calendar-color>` : ""}<c:supported-calendar-component-set><c:comp name="${calendar.component}"/></c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`;
  for (let attempt = 1; ; attempt++) {
    const url = canonicalHref(`${homeUrl}${segmentOf(name)}/`);
    const response = await request(
      {
        method: "MKCALENDAR",
        url,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
        body,
      },
      [405, 501],
    );
    if (response.status === 405 || response.status === 501) {
      const allow = response.header("allow");
      const allowed = allow === null || /(^|[\s,])MKCALENDAR($|[\s,])/i.test(allow);
      if (response.status === 405 && allowed && attempt === 1) continue;
      throw new CannotMakeCalendarError(
        "unsupported",
        `${homeUrl} makes no calendars (MKCALENDAR answered ${response.status}).`,
      );
    }
    return {
      url,
      name,
      color: calendar.color,
      components: [calendar.component],
      rights: ALL_RIGHTS,
    };
  }
}

/**
 * A new calendar's last path segment: the name's ASCII letters and digits
 * (`team-plans`), as Nextcloud's apps make one, and eight random hex
 * digits, so two of one name never meet and a Cyrillic one still reads.
 */
function segmentOf(name: string): string {
  const words = name
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  const random = Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return words ? `${words}-${random}` : random;
}
