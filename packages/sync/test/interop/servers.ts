// The interop run's servers (docs/plans/providers.md#D248): the containers
// of compose.yaml beside this file, started by .github/workflows/interop.yml
// (or `docker compose up -d` here), one chosen by `ASTROTIME_INTEROP`.
// Their calendars are made where discovery finds each one's calendar home,
// so nothing here knows a server's paths.
import { Authorization, fetchClient, type Credentials } from "@astrotime/caldav";
import { CalDavProvider, send } from "@astrotime/caldav/provider";

import type { CalDavServer } from "../servers.ts";

/** Each server of compose.yaml: where it listens, as a user would type it. */
const INTEROP: Record<string, { name: string; url: string; username?: string }> = {
  "baikal-digest": { name: "Baïkal (Digest)", url: "http://127.0.0.1:5601/dav.php/" },
  "baikal-basic": { name: "Baïkal (Basic)", url: "http://127.0.0.1:5602/dav.php/" },
  xandikos: { name: "Xandikos", url: "http://127.0.0.1:5603/" },
  // Its `.well-known/caldav` answers 405: discovery goes on from the address.
  davical: { name: "DAViCal", url: "http://127.0.0.1:5604/caldav.php/", username: "admin" },
  davis: { name: "Davis", url: "http://127.0.0.1:5605/dav/" },
  // Its root, as a user types it (`.well-known/caldav` leads on); the
  // workflow's wait asks `/dav/cal/` itself, which answers once it is up.
  stalwart: { name: "Stalwart", url: "http://127.0.0.1:5606/" },
  // Its test server's users; any password is taken.
  cyrus: { name: "Cyrus IMAP", url: "http://127.0.0.1:5607/", username: "user1" },
};

/** The server `ASTROTIME_INTEROP` names, or `null` outside the interop run. */
export function interopServer(): CalDavServer | null {
  const key = process.env["ASTROTIME_INTEROP"];
  if (!key) return null;
  const server = INTEROP[key];
  if (!server) throw new Error(`ASTROTIME_INTEROP: no server ${key} in compose.yaml.`);
  const { name, url } = server;
  const credentials: Credentials = { username: server.username ?? "astro", password: "secret" };
  const http = fetchClient();
  const authorization = new Authorization(credentials);
  let home: string | null = null;
  // What the tests make is deleted at the end: the container outlives a run by hand.
  const created: string[] = [];
  const request = (method: string, at: string, body?: string) =>
    send(
      http,
      authorization,
      {
        method,
        url: at,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
        ...(body === undefined ? {} : { body }),
      },
      [404],
    );
  return {
    name,
    url,
    ...credentials,
    async mkcalendar(calendar, components = ["VEVENT", "VTODO"]) {
      home ??= (await CalDavProvider.discover(http, url, credentials)).homeUrl;
      const calendarUrl = new URL(`${calendar}/`, home).href;
      await request(
        "MKCALENDAR",
        calendarUrl,
        `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>${calendar}</d:displayname><ic:calendar-color>#0082c9ff</ic:calendar-color><c:supported-calendar-component-set>${components.map((c) => `<c:comp name="${c}"/>`).join("")}</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`,
      );
      created.push(calendarUrl);
      return calendarUrl;
    },
    async deleteCalendar(calendarUrl) {
      await request("DELETE", calendarUrl);
    },
    async stop() {
      for (const calendarUrl of created.splice(0)) await request("DELETE", calendarUrl);
    },
  };
}
