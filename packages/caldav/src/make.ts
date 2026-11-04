// A new calendar on a CalDAV server (docs/plans/providers.md#D275), loaded
// when one is made.
import { ALL_RIGHTS, type NewCalendar, type RemoteCalendar } from "@astrotime/core";

import type { HttpRequest, HttpResponse } from "./http.ts";
import { canonicalHref } from "./provider.ts";
import { escape, NAMESPACES } from "./xml.ts";

/** How many addresses a new calendar tries before a taken one is the error. */
const MAKE_TRIES = 3;

/**
 * A new calendar in the home (`MKCALENDAR`, RFC 4791 §5.3.1) with its name,
 * colour and the one component it holds, at an address of the name's
 * letters and a few random ones; one taken (405) is tried again elsewhere.
 * Given as the listing will name it, with every right: the user's own.
 */
export async function mkcalendar(
  homeUrl: string,
  request: (request: HttpRequest, accept: readonly number[]) => Promise<HttpResponse>,
  calendar: NewCalendar,
): Promise<RemoteCalendar> {
  const name = withoutControls(calendar.name);
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
      attempt < MAKE_TRIES ? [405] : [],
    );
    if (response.status === 405) continue;
    return {
      url,
      name,
      color: calendar.color,
      components: [calendar.component],
      rights: ALL_RIGHTS,
    };
  }
}

/** A name with no control character, which XML 1.0 cannot carry. */
const withoutControls = (name: string) =>
  [...name].filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f).join("");

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
