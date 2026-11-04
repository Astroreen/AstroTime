// A Nextcloud is known by its calendar home (foundation D231): whatever
// address Login Flow v2 or the user gave (a trailing slash, index.php, a
// page of its web app, `/.well-known/caldav` redirected to remote.php, an
// install under a path), discovery ends at the home Nextcloud names, and
// `keepsFiles` sees it there (design D237). The answers here are written by
// hand in the shapes Nextcloud gives; the real servers' own say the same in
// `packages/sync/test/servers.test.ts` (Radicale on every run, Nextcloud in
// the nightly job). Neither explains the owner's case (design D237's
// Deferred).
import { expect, test } from "vite-plus/test";

import { CalDavProvider, followRedirects, keepsFiles, type HttpClient } from "../src/index.ts";

const multistatus = (href: string, prop: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;

/**
 * A Nextcloud at `root` (`""`, or a path such as `/nextcloud`), as Apache
 * serves it: `/.well-known/caldav` redirects (relatively, or to `absolute`)
 * to its `remote.php/dav/`, which names the principal, which names the home.
 */
function nextcloud(root: string, { absolute = false } = {}): HttpClient {
  const dav = `${root}/remote.php/dav/`;
  const hop: HttpClient = async (request) => {
    const url = new URL(request.url);
    const answer = (status: number, body = "", location: string | null = null) => ({
      status,
      url: request.url,
      header: (name: string) => (name.toLowerCase() === "location" ? location : null),
      body,
    });
    if (url.pathname === "/.well-known/caldav")
      return answer(301, "", absolute ? `${url.origin}${dav}` : dav);
    if (url.pathname === dav)
      return answer(
        207,
        multistatus(
          dav,
          `<d:current-user-principal><d:href>${dav}principals/users/astro/</d:href></d:current-user-principal>`,
        ),
      );
    if (url.pathname === `${dav}principals/users/astro/`)
      return answer(
        207,
        multistatus(
          url.pathname,
          // Some name the home with the origin, some without.
          `<c:calendar-home-set><d:href>${absolute ? url.origin : ""}${dav}calendars/astro/</d:href></c:calendar-home-set>`,
        ),
      );
    return answer(404);
  };
  return followRedirects(hop);
}

const credentials = { username: "astro", password: "app-password" };

test("every address a Nextcloud is reached by ends at a home that keeps files", async () => {
  const cases: [string, string, HttpClient][] = [
    [
      "https://cloud.example",
      "https://cloud.example/remote.php/dav/calendars/astro/",
      nextcloud(""),
    ],
    [
      "https://cloud.example/",
      "https://cloud.example/remote.php/dav/calendars/astro/",
      nextcloud(""),
    ],
    [
      "https://cloud.example/index.php",
      "https://cloud.example/remote.php/dav/calendars/astro/",
      nextcloud("", { absolute: true }),
    ],
    [
      "https://cloud.example/index.php/apps/calendar/",
      "https://cloud.example/remote.php/dav/calendars/astro/",
      nextcloud(""),
    ],
    [
      "https://cloud.example/remote.php/dav",
      "https://cloud.example/remote.php/dav/calendars/astro/",
      nextcloud(""),
    ],
    [
      "https://example.org/nextcloud/",
      "https://example.org/nextcloud/remote.php/dav/calendars/astro/",
      nextcloud("/nextcloud"),
    ],
  ];
  for (const [server, home, http] of cases) {
    const { homeUrl } = await CalDavProvider.discover(http, server, credentials);
    expect([server, homeUrl]).toEqual([server, home]);
    expect([server, keepsFiles(homeUrl)]).toEqual([server, true]);
  }
});

test("a server that is no Nextcloud keeps no files", () => {
  expect(keepsFiles("https://dav.example/astro/")).toBe(false);
  expect(keepsFiles("https://dav.example/dav.php/calendars/astro/")).toBe(false);
});
