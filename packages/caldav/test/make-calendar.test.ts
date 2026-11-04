// A calendar made on a CalDAV server (docs/plans/providers.md#D275): one
// MKCALENDAR (RFC 4791 §5.3.1) in the calendar home, with the name, colour
// and the one component asked, at an address of the name's letters and a
// few random ones; one taken is tried again elsewhere. Against real servers:
// packages/sync/test/servers.test.ts.
import { expect, test } from "vite-plus/test";

import { CalDavProvider, HttpError, type HttpClient, type HttpRequest } from "../src/index.ts";

const HOME = "https://dav.example/calendars/astro/";

/** A server answering each request with the next status (and its `Allow`, if given); 201 after. */
function server(statuses: (number | { status: number; allow: string })[] = []) {
  const asked: HttpRequest[] = [];
  const http: HttpClient = async (request) => {
    asked.push(request);
    const next = statuses.shift() ?? 201;
    const { status, allow } = typeof next === "number" ? { status: next, allow: null } : next;
    return {
      status,
      url: request.url,
      header: (name: string) => (name.toLowerCase() === "allow" ? allow : null),
      body: "",
    };
  };
  return { asked, provider: new CalDavProvider(http, { username: "u", password: "p" }, HOME) };
}

test("one MKCALENDAR in the home: the name, the colour, the one component; given as listed, every right", async () => {
  const { asked, provider } = server();
  const made = await provider.makeCalendar({
    name: "Team <plans> & more",
    color: "#4f8fd6",
    component: "VTODO",
  });
  expect(asked).toHaveLength(1);
  const [request] = asked;
  expect(request!.method).toBe("MKCALENDAR");
  expect(request!.url).toMatch(
    /^https:\/\/dav\.example\/calendars\/astro\/team-plans-more-[0-9a-f]{8}\/$/,
  );
  expect(request!.body).toContain("<d:displayname>Team &lt;plans&gt; &amp; more</d:displayname>");
  expect(request!.body).toContain("<ic:calendar-color>#4f8fd6</ic:calendar-color>");
  expect(request!.body).toContain(
    '<c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>',
  );
  expect(made).toEqual({
    url: request!.url,
    name: "Team <plans> & more",
    color: "#4f8fd6",
    components: ["VTODO"],
    rights: { create: true, edit: true, delete: true },
  });
});

test("a name of no Latin letters gets an address of random ones; a control character goes; no colour, none sent", async () => {
  const { asked, provider } = server();
  const made = await provider.makeCalendar({
    name: "Работа\u0007",
    color: null,
    component: "VEVENT",
  });
  expect(asked[0]!.url).toMatch(/^https:\/\/dav\.example\/calendars\/astro\/[0-9a-f]{8}\/$/);
  expect(asked[0]!.body).toContain("<d:displayname>Работа</d:displayname>");
  expect(asked[0]!.body).not.toContain("calendar-color");
  expect(made.name).toBe("Работа");
});

test("an address taken (405) is tried once more elsewhere; a refusal is the error", async () => {
  const taken = server([{ status: 405, allow: "OPTIONS, GET, PROPFIND, MKCALENDAR, DELETE" }, 201]);
  const made = await taken.provider.makeCalendar({
    name: "Work",
    color: null,
    component: "VEVENT",
  });
  expect(taken.asked).toHaveLength(2);
  expect(taken.asked[0]!.url).not.toBe(taken.asked[1]!.url);
  expect(made.url).toBe(taken.asked[1]!.url);
  // Not allowed to make one (Nextcloud's shared account, a read-only home).
  const refused = server([403]);
  await expect(
    refused.provider.makeCalendar({ name: "W", color: null, component: "VEVENT" }),
  ).rejects.toThrow(HttpError);
});

test("a server that makes no calendars says so at once: an Allow without MKCALENDAR, a 501, or 405 twice", async () => {
  const unsupported = expect.objectContaining({
    name: "CannotMakeCalendarError",
    reason: "unsupported",
  });
  const ask = { name: "W", color: null, component: "VEVENT" } as const;
  // Google's CalDAV names what it allows, MKCALENDAR not among them.
  const google = server([{ status: 405, allow: "OPTIONS, GET, PUT, DELETE, PROPFIND, REPORT" }]);
  await expect(google.provider.makeCalendar(ask)).rejects.toEqual(unsupported);
  expect(google.asked).toHaveLength(1);
  const notImplemented = server([501]);
  await expect(notImplemented.provider.makeCalendar(ask)).rejects.toEqual(unsupported);
  expect(notImplemented.asked).toHaveLength(1);
  // No `Allow`: one more try at a new random address tells taken from unsupported.
  const silent = server([405, 405]);
  await expect(silent.provider.makeCalendar(ask)).rejects.toEqual(unsupported);
  expect(silent.asked).toHaveLength(2);
});

test("a name that is nothing once trimmed is refused before any request", async () => {
  const { asked, provider } = server();
  for (const name of ["", "  ", "\u0000\u0007", "\uFFFE"])
    await expect(provider.makeCalendar({ name, color: null, component: "VTODO" })).rejects.toEqual(
      expect.objectContaining({ reason: "no-name" }),
    );
  expect(asked).toEqual([]);
  // A lone surrogate and a noncharacter go; the rest stays, trimmed.
  await provider.makeCalendar({ name: " A\uD800b\uFFFF ", color: null, component: "VTODO" });
  expect(asked[0]!.body).toContain("<d:displayname>Ab</d:displayname>");
});
