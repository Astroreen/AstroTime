// AstroTime's own CalDAV server (docs/plans/server.md#D291) as other clients
// speak to it: the requests Thunderbird and DAVx⁵ send, their prefixes and
// property sets, written out here as they send them. The provider and the
// sync engine run against it with Radicale's tests (packages/sync/test).
import { fetchClient } from "@astrotime/caldav";
import { CalDavProvider } from "@astrotime/caldav/provider";
import { parseMultistatus, text } from "@astrotime/caldav/xml";
import { nodeDriver } from "@astrotime/storage/node";
import { beforeEach, describe, expect, test } from "vite-plus/test";

import { ServerDatabase, serverHandler } from "../src/index.ts";

const ORIGIN = "http://dav.test";
const HOME = "/dav/calendars/astro/";
const basic = (user: string, password: string) =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

let database: ServerDatabase;
let clock = 0;
let handler: ReturnType<typeof serverHandler>;

beforeEach(async () => {
  database = await ServerDatabase.open(nodeDriver());
  await database.addUser("astro", "secret");
  clock = Date.parse("2026-11-05T00:00:00Z");
  handler = serverHandler({ database, now: () => clock });
});

interface Sent {
  readonly body?: string;
  readonly headers?: Record<string, string>;
  /** `null`: no credentials. */
  readonly as?: readonly [string, string] | null;
  readonly address?: string;
}

async function send(method: string, path: string, sent: Sent = {}) {
  const as = sent.as === undefined ? (["astro", "secret"] as const) : sent.as;
  const response = await handler(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers: {
        ...(as ? { Authorization: basic(as[0], as[1]) } : {}),
        // As clients label their bodies (fetch would say text/plain).
        "Content-Type":
          method === "PUT" ? "text/calendar; charset=utf-8" : "application/xml; charset=utf-8",
        ...sent.headers,
      },
      ...(sent.body === undefined ? {} : { body: sent.body }),
    }),
    { address: sent.address ?? "192.0.2.1" },
  );
  const body = await response.text();
  return { status: response.status, headers: response.headers, body };
}

/** A multistatus as hrefs to their found props (and the response's own status). */
function statuses(body: string) {
  return parseMultistatus(body).responses.map((r) => ({
    href: r.href,
    status: r.status,
    props: r.props,
  }));
}

const event = (uid: string, extra = "") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Mozilla.org/NONSGML Mozilla Calendar V1.1//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nDTSTART:20261102T090000Z\r\nDTEND:20261102T100000Z\r\nSUMMARY:${uid}\r\n${extra}END:VEVENT\r\nEND:VCALENDAR\r\n`;
const task = (uid: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//bitfire web engineering//DAVx5//EN\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nSUMMARY:${uid}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;

describe("signing in (D282)", () => {
  test("a new user has a calendar and a task list; the password is kept as scrypt", async () => {
    expect((await database.user("astro"))!.password).toMatch(/^scrypt\$32768\$8\$1\$/);
    const listed = statuses(
      (await send("PROPFIND", HOME, { headers: { Depth: "1" } })).body,
    ).filter((r) => r.href !== HOME);
    expect(
      listed.map((r) => [
        r.href,
        text(r.props["displayname"]),
        r.props["supported-calendar-component-set"],
      ]),
    ).toEqual([
      [`${HOME}personal/`, "Personal", { comp: [{ "@_name": "VEVENT" }] }],
      [`${HOME}tasks/`, "Tasks", { comp: [{ "@_name": "VTODO" }] }],
    ]);
  });

  test("the well-known address leads to /dav/, OPTIONS needs no sign-in, anything else does", async () => {
    const wellKnown = await send("PROPFIND", "/.well-known/caldav", { as: null });
    expect([wellKnown.status, wellKnown.headers.get("location")]).toEqual([301, "/dav/"]);
    const options = await send("OPTIONS", HOME, { as: null });
    expect(options.status).toBe(200);
    expect(options.headers.get("dav")).toBe("1, 3, calendar-access, extended-mkcol");
    const anonymous = await send("PROPFIND", HOME, { as: null });
    expect([anonymous.status, anonymous.headers.get("www-authenticate")]).toEqual([
      401,
      'Basic realm="AstroTime", charset="UTF-8"',
    ]);
    expect((await send("PROPFIND", HOME, { as: ["astro", "wrong"] })).status).toBe(401);
    expect((await send("PROPFIND", HOME, { as: ["nobody", "secret"] })).status).toBe(401);
  });

  test("ten failed sign-ins from one address in a minute answer 429 until the minute is over", async () => {
    const from = { address: "198.51.100.7" };
    for (let i = 0; i < 10; i++)
      expect((await send("PROPFIND", HOME, { ...from, as: ["astro", `guess${i}`] })).status).toBe(
        401,
      );
    // Even the right password waits, and says how long.
    const limited = await send("PROPFIND", HOME, from);
    expect([limited.status, limited.headers.get("retry-after")]).toEqual([429, "60"]);
    clock += 45_000;
    expect((await send("PROPFIND", HOME, from)).headers.get("retry-after")).toBe("15");
    // Another address is not held with it.
    expect((await send("PROPFIND", HOME, { address: "198.51.100.8" })).status).toBe(207);
    clock += 15_000;
    expect((await send("PROPFIND", HOME, from)).status).toBe(207);
  });

  test("a changed password is asked for at once, though the old one was checked before", async () => {
    expect((await send("PROPFIND", HOME)).status).toBe(207);
    await database.setPassword("astro", "new secret");
    expect((await send("PROPFIND", HOME)).status).toBe(401);
    expect((await send("PROPFIND", HOME, { as: ["astro", "new secret"] })).status).toBe(207);
  });

  test("each user sees only their own calendars", async () => {
    await database.addUser("other", "password");
    const theirs = { as: ["other", "password"] as const };
    expect((await send("PROPFIND", HOME, theirs)).status).toBe(404);
    expect((await send("PROPFIND", "/dav/principals/astro/", theirs)).status).toBe(404);
    expect(
      (await send("PUT", `${HOME}personal/x.ics`, { ...theirs, body: event("x") })).status,
    ).toBe(404);
    expect((await send("PROPFIND", "/dav/calendars/other/", theirs)).status).toBe(207);
  });
});

describe("Thunderbird", () => {
  test("discovers the calendars, writes an event byte for byte and refuses a stale write", async () => {
    // Thunderbird's discovery: the principal through the well-known address.
    const root = await send("PROPFIND", "/dav/", {
      headers: { Depth: "0", "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:owner/><D:current-user-principal/><D:supported-report-set/></D:prop></D:propfind>`,
    });
    const [principal] = statuses(root.body);
    expect(text(principal!.props["current-user-principal"])).toBe("/dav/principals/astro/");

    const home = await send("PROPFIND", "/dav/principals/astro/", {
      headers: { Depth: "0" },
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><C:calendar-home-set/><C:calendar-user-address-set/><C:schedule-inbox-URL/><C:schedule-outbox-URL/><N:owner-displayname xmlns:N="http://nextcloud.com/ns"/></D:prop></D:propfind>`,
    });
    // What the server does not keep is a 404 propstat, in the namespace it was asked in.
    expect(home.body).toContain(
      '<d:propstat><d:prop><c:calendar-user-address-set/><c:schedule-inbox-URL/><c:schedule-outbox-URL/><x:owner-displayname xmlns:x="http://nextcloud.com/ns"/></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat>',
    );
    expect(text(statuses(home.body)[0]!.props["calendar-home-set"])).toBe(HOME);

    // The calendar's state, Depth 0, with CalendarServer's ctag.
    const calendar = `${HOME}personal/`;
    const state = async () =>
      statuses(
        (
          await send("PROPFIND", calendar, {
            headers: { Depth: "0" },
            body: `<?xml version="1.0" encoding="UTF-8"?>\n<D:propfind xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:resourcetype/><D:owner/><D:current-user-privilege-set/><D:supported-report-set/><C:supported-calendar-component-set/><CS:getctag/></D:prop></D:propfind>`,
          })
        ).body,
      )[0]!;
    const before = await state();
    expect(before.props["resourcetype"]).toEqual({ collection: "", calendar: "" });
    expect(before.props["current-user-privilege-set"]).toMatchObject({
      privilege: expect.arrayContaining([{ write: "" }, { "write-content": "" }]),
    });

    // An event with what AstroTime does not know: its X- properties and a folded line.
    const ics = event(
      "tb-1",
      "X-MOZ-GENERATION:1\r\nX-MOZ-LASTACK:20261101T080000Z\r\nDESCRIPTION:A line long enough to be folded by the client that wrote it, as Thu\r\n nderbird folds\r\n",
    );
    const created = await send("PUT", `${calendar}tb-1.ics`, {
      headers: { "Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*" },
      body: ics,
    });
    expect(created.status).toBe(201);
    const etag = created.headers.get("etag")!;
    expect(etag).toMatch(/^"[\w-]+"$/);
    expect(text((await state()).props["getctag"])).not.toBe(text(before.props["getctag"]));

    const got = await send("GET", `${calendar}tb-1.ics`);
    expect([got.body, got.headers.get("etag")]).toEqual([ics, etag]);

    // Its listing (ETags, Depth 1), then a multiget of what changed.
    const listing = statuses(
      (
        await send("PROPFIND", calendar, {
          headers: { Depth: "1" },
          body: `<?xml version="1.0" encoding="UTF-8"?>\n<D:propfind xmlns:D="DAV:"><D:prop><D:getcontenttype/><D:resourcetype/><D:getetag/></D:prop></D:propfind>`,
        })
      ).body,
    );
    expect(listing.map((r) => [r.href, text(r.props["getetag"])])).toEqual([
      [calendar, null],
      [`${calendar}tb-1.ics`, etag],
    ]);
    const multiget = await send("REPORT", calendar, {
      headers: { Depth: "1" },
      body: `<?xml version="1.0" encoding="UTF-8"?>\n<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:prop><D:getetag/><C:calendar-data/></D:prop><D:href>${calendar}tb-1.ics</D:href><D:href>${calendar}gone.ics</D:href></C:calendar-multiget>`,
    });
    const [found, gone] = statuses(multiget.body);
    // The data comes back as it was written, CRs and all.
    expect(text(found!.props["calendar-data"]) ?? "").toBe(ics.trim());
    expect((found!.props["calendar-data"] as string).endsWith("\r\n")).toBe(true);
    expect(gone).toMatchObject({ href: `${calendar}gone.ics`, status: 404 });

    // Another client changes it; Thunderbird's write with the old ETag is refused.
    const changed = await send("PUT", `${calendar}tb-1.ics`, {
      headers: { "If-Match": etag },
      body: ics.replace("SUMMARY:tb-1", "SUMMARY:changed"),
    });
    expect(changed.status).toBe(204);
    const stale = await send("PUT", `${calendar}tb-1.ics`, {
      headers: { "If-Match": etag },
      body: ics.replace("SUMMARY:tb-1", "SUMMARY:stale"),
    });
    expect(stale.status).toBe(412);
    expect(
      (await send("DELETE", `${calendar}tb-1.ics`, { headers: { "If-Match": etag } })).status,
    ).toBe(412);
    expect(
      (
        await send("DELETE", `${calendar}tb-1.ics`, {
          headers: { "If-Match": changed.headers.get("etag")! },
        })
      ).status,
    ).toBe(204);
    expect((await send("GET", `${calendar}tb-1.ics`)).status).toBe(404);
  });

  test("calendar-query finds events by their occurrences in a time range, tasks by component", async () => {
    const calendar = `${HOME}all/`;
    expect((await send("MKCALENDAR", calendar)).status).toBe(201);
    await send("PUT", `${calendar}once.ics`, { body: event("once") });
    // Weekly on Tuesdays from October 6: its occurrence on November 17 is in the range.
    await send("PUT", `${calendar}weekly.ics`, {
      body: event("weekly", "RRULE:FREQ=WEEKLY;COUNT=10\r\n").replace(
        /DTSTART:\S+\r\nDTEND:\S+/,
        "DTSTART:20261006T090000Z\r\nDTEND:20261006T100000Z",
      ),
    });
    await send("PUT", `${calendar}todo.ics`, { body: task("todo") });
    const query = async (filter: string) =>
      statuses(
        (
          await send("REPORT", calendar, {
            headers: { Depth: "1" },
            body: `<?xml version="1.0" encoding="UTF-8"?>\n<calendar-query xmlns="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:"><D:prop><D:getetag/></D:prop><filter><comp-filter name="VCALENDAR">${filter}</comp-filter></filter></calendar-query>`,
          })
        ).body,
      ).map((r) => r.href.slice(calendar.length));
    expect(
      await query(
        `<comp-filter name="VEVENT"><time-range start="20261117T000000Z" end="20261118T000000Z"/></comp-filter>`,
      ),
    ).toEqual(["weekly.ics"]);
    expect(
      await query(
        `<comp-filter name="VEVENT"><time-range start="20261102T093000Z" end="20261102T094500Z"/></comp-filter>`,
      ),
    ).toEqual(["once.ics"]);
    expect(await query(`<comp-filter name="VTODO"/>`)).toEqual(["todo.ics"]);
    expect(await query("")).toEqual(["once.ics", "todo.ics", "weekly.ics"]);
  });
});

describe("DAVx⁵", () => {
  test("finds the home, makes a calendar by extended MKCOL, and syncs it by sync-collection", async () => {
    const principal = statuses(
      (
        await send("PROPFIND", "/dav/", {
          headers: { Depth: "0" },
          body: `<?xml version='1.0' encoding='UTF-8' ?><propfind xmlns="DAV:"><prop><current-user-principal /></prop></propfind>`,
        })
      ).body,
    )[0]!;
    const home = statuses(
      (
        await send("PROPFIND", text(principal.props["current-user-principal"])!, {
          headers: { Depth: "0" },
          body: `<?xml version='1.0' encoding='UTF-8' ?><propfind xmlns="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav"><prop><CAL:calendar-home-set /><displayname /><CAL:calendar-user-address-set /></prop></propfind>`,
        })
      ).body,
    )[0]!;
    expect(text(home.props["calendar-home-set"])).toBe(HOME);

    // DAVx⁵ makes a calendar with RFC 5689's MKCOL.
    const calendar = `${HOME}davx5-cal/`;
    const made = await send("MKCOL", calendar, {
      body: `<?xml version='1.0' encoding='UTF-8' ?><mkcol xmlns="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav" xmlns:ICAL="http://apple.com/ns/ical/"><set><prop><resourcetype><collection /><CAL:calendar /></resourcetype><displayname>Работа</displayname><ICAL:calendar-color>#FF0000FF</ICAL:calendar-color><CAL:calendar-timezone>BEGIN:VCALENDAR…</CAL:calendar-timezone><CAL:supported-calendar-component-set><CAL:comp name="VEVENT" /><CAL:comp name="VJOURNAL" /></CAL:supported-calendar-component-set></prop></set></mkcol>`,
    });
    expect(made.status).toBe(201);
    expect((await send("MKCOL", calendar, { body: "" })).status).toBe(405);

    // Its listing of the home, with the properties it asks every collection for.
    const listed = statuses(
      (
        await send("PROPFIND", HOME, {
          headers: { Depth: "1" },
          body: `<?xml version='1.0' encoding='UTF-8' ?><propfind xmlns="DAV:" xmlns:CAL="urn:ietf:params:xml:ns:caldav" xmlns:ICAL="http://apple.com/ns/ical/" xmlns:CS="http://calendarserver.org/ns/"><prop><resourcetype /><displayname /><ICAL:calendar-color /><CAL:calendar-description /><CAL:calendar-timezone /><current-user-privilege-set /><CAL:supported-calendar-component-set /><CS:source /><supported-report-set /><sync-token /></prop></propfind>`,
        })
      ).body,
    ).find((r) => r.href === calendar)!;
    expect(text(listed.props["displayname"])).toBe("Работа");
    expect(text(listed.props["calendar-color"])).toBe("#FF0000FF");
    expect(listed.props["supported-calendar-component-set"]).toEqual({
      comp: [{ "@_name": "VEVENT" }],
    });
    expect(JSON.stringify(listed.props["supported-report-set"])).toContain("sync-collection");

    const sync = async (token: string) => {
      const answer = await send("REPORT", calendar, {
        headers: { Depth: "0" },
        body: `<?xml version='1.0' encoding='UTF-8' ?><sync-collection xmlns="DAV:"><sync-token>${token}</sync-token><sync-level>1</sync-level><prop><getetag /></prop></sync-collection>`,
      });
      return { status: answer.status, body: answer.body, parsed: parseMultistatus(answer.body) };
    };
    const first = await sync("");
    expect([first.parsed.responses, first.parsed.syncToken]).toEqual([
      [],
      text(listed.props["sync-token"]),
    ]);

    await send("PUT", `${calendar}a.ics`, { body: event("a") });
    await send("PUT", `${calendar}b.ics`, { body: event("b") });
    const second = await sync(first.parsed.syncToken!);
    expect(second.parsed.responses.map((r) => [r.href, r.status])).toEqual([
      [`${calendar}a.ics`, null],
      [`${calendar}b.ics`, null],
    ]);

    await send("DELETE", `${calendar}a.ics`);
    await send("PUT", `${calendar}b.ics`, { body: event("b", "LOCATION:Room 7\r\n") });
    const third = await sync(second.parsed.syncToken!);
    expect(third.parsed.responses.map((r) => [r.href, r.status])).toEqual([
      [`${calendar}a.ics`, 404],
      [`${calendar}b.ics`, null],
    ]);
    expect(third.parsed.syncToken).not.toBe(second.parsed.syncToken);
    expect((await sync(third.parsed.syncToken!)).parsed.responses).toEqual([]);

    // A token the calendar never gave, or another calendar's: RFC 6578's precondition.
    for (const token of [
      "urn:astrotime:sync:1:999",
      "http://elsewhere/sync/1",
      second.parsed.syncToken!.replace(/:(\d+):/, ":1:"),
    ]) {
      const refused = await sync(token);
      expect(refused.status).toBe(403);
      expect(refused.body).toContain("<d:valid-sync-token/>");
    }
  });

  test("a calendar keeps its name and colour from PROPPATCH; anything else refuses the whole update", async () => {
    const calendar = `${HOME}personal/`;
    const patch = (props: string) =>
      send("PROPPATCH", calendar, {
        body: `<?xml version='1.0' encoding='UTF-8' ?><propertyupdate xmlns="DAV:" xmlns:ICAL="http://apple.com/ns/ical/"><set><prop>${props}</prop></set></propertyupdate>`,
      });
    const name = async () =>
      statuses((await send("PROPFIND", calendar, { headers: { Depth: "0" } })).body)[0]!.props;
    const refused = await patch(
      `<displayname>Mine</displayname><ICAL:calendar-order>3</ICAL:calendar-order>`,
    );
    expect(refused.status).toBe(207);
    expect(refused.body).toContain("<ic:calendar-order/></d:prop><d:status>HTTP/1.1 403 Forbidden");
    expect(refused.body).toContain(
      "<d:displayname/></d:prop><d:status>HTTP/1.1 424 Failed Dependency",
    );
    expect(text((await name())["displayname"])).toBe("Personal");

    const taken = await patch(
      `<displayname>Mine</displayname><ICAL:calendar-color>#4f8fd6</ICAL:calendar-color>`,
    );
    expect(taken.body).toContain("HTTP/1.1 200 OK");
    expect(await name()).toMatchObject({ displayname: "Mine", "calendar-color": "#4f8fd6" });
  });
});

describe("writes the server refuses", () => {
  test("a second resource with one UID, a task in an events calendar, no calendar data, a taken name", async () => {
    const personal = `${HOME}personal/`;
    expect((await send("PUT", `${personal}one.ics`, { body: event("same") })).status).toBe(201);
    const twice = await send("PUT", `${personal}two.ics`, { body: event("same") });
    expect(twice.status).toBe(403);
    expect(twice.body).toContain(
      `<c:no-uid-conflict><d:href>${personal}one.ics</d:href></c:no-uid-conflict>`,
    );
    expect((await send("PUT", `${personal}todo.ics`, { body: task("todo") })).body).toContain(
      "supported-calendar-component",
    );
    expect((await send("PUT", `${personal}x.ics`, { body: "not iCalendar" })).body).toContain(
      "valid-calendar-data",
    );
    expect(
      (
        await send("PUT", `${personal}one.ics`, {
          headers: { "If-None-Match": "*" },
          body: event("same"),
        })
      ).status,
    ).toBe(412);
    expect((await send("PUT", `${HOME}missing/x.ics`, { body: event("x") })).status).toBe(409);
    expect((await send("MKCALENDAR", personal)).status).toBe(405);
  });
});

test("the provider falls back to a full listing when the server no longer knows its token (RFC 6578 §3.2)", async () => {
  const http = fetchClient({
    fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
      handler(new Request(input, init))) as typeof fetch,
  });
  const credentials = { username: "astro", password: "secret" };
  const { homeUrl } = await CalDavProvider.discover(http, `${ORIGIN}/dav/`, credentials);
  const provider = new CalDavProvider(http, credentials, homeUrl);
  await send("PUT", `${HOME}personal/kept.ics`, { body: event("kept") });
  const [personal] = await provider.calendars();
  const changes = await provider.changes(
    personal!.url,
    { syncToken: "urn:astrotime:sync:1:999", ctag: null },
    new Map([[`${ORIGIN}${HOME}personal/removed.ics`, '"old"']]),
  );
  expect(changes.changed.map((o) => [o.href, o.ics])).toEqual([
    // The provider reads calendar-data trimmed.
    [`${ORIGIN}${HOME}personal/kept.ics`, event("kept").trim()],
  ]);
  expect(changes.removed).toEqual([`${ORIGIN}${HOME}personal/removed.ics`]);
  expect(changes.syncToken).toBe(personal!.state!.syncToken);
});
