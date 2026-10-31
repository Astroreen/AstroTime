import { expect, test } from "vite-plus/test";

import { CalDavProvider, type HttpClient } from "../src/index.ts";

const home = "https://dav.example/cal/";
const multistatus = (body: string, token: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}<d:sync-token>${token}</d:sync-token></d:multistatus>`;
const changed = (name: string) =>
  `<d:response><d:href>/cal/${name}</d:href><d:propstat><d:prop><d:getetag>"${name}"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const ics = (uid: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:${uid}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;

test("a truncated sync-collection answer (507) is followed to the end with its new token (RFC 6578 §3.6)", async () => {
  const bodies: string[] = [];
  const http: HttpClient = async (request) => {
    bodies.push(request.body ?? "");
    const reply = (body: string) => ({ status: 207, url: request.url, header: () => null, body });
    if (request.body?.includes("calendar-multiget")) {
      const hrefs = [...request.body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => m[1]!);
      return reply(
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${hrefs
          .map(
            (h) =>
              `<d:response><d:href>${h}</d:href><d:propstat><d:prop><d:getetag>"e"</d:getetag><c:calendar-data>${ics(h.split("/").at(-1)!)}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          )
          .join("")}</d:multistatus>`,
      );
    }
    if (request.body?.includes("<d:sync-token>t1</d:sync-token>")) {
      return reply(
        multistatus(
          `${changed("a.ics")}<d:response><d:href>/cal/</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:response>`,
          "t2",
        ),
      );
    }
    return reply(multistatus(changed("b.ics"), "t3"));
  };
  const provider = new CalDavProvider(http, { username: "u", password: "p" }, home);
  const changes = await provider.changes(home, { syncToken: "t1", ctag: null }, new Map());
  expect(changes.syncToken).toBe("t3");
  expect(changes.changed.map((o) => o.href).toSorted()).toEqual([`${home}a.ics`, `${home}b.ics`]);
  expect(
    bodies
      .filter((b) => b.includes("sync-collection"))
      .map((b) => /<d:sync-token>(\w+)</.exec(b)?.[1]),
  ).toEqual(["t1", "t2"]);
});

test("an object the multiget leaves out is fetched on its own; one that cannot be read keeps no sync token", async () => {
  const served = new Map([["/cal/a.ics", ics("a")]]);
  let getFails = false;
  const http: HttpClient = async (request) => {
    const reply = (status: number, body: string, etag: string | null = '"e"') => ({
      status,
      url: request.url,
      header: (n: string) => (n === "etag" ? etag : null),
      body,
    });
    if (request.method === "GET") {
      if (getFails) return reply(500, "");
      const body = served.get(new URL(request.url).pathname);
      return body ? reply(200, body) : reply(404, "");
    }
    if (request.body?.includes("calendar-multiget"))
      return reply(207, `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`);
    return reply(207, multistatus(changed("a.ics") + changed("gone.ics"), "t9"));
  };
  const provider = new CalDavProvider(http, { username: "u", password: "p" }, home);
  const first = await provider.changes(home, { syncToken: "t1", ctag: null }, new Map());
  expect([first.changed.map((o) => o.href), first.removed, first.syncToken]).toEqual([
    [`${home}a.ics`],
    [`${home}gone.ics`],
    "t9",
  ]);
  getFails = true;
  const second = await provider.changes(home, { syncToken: "t1", ctag: null }, new Map());
  expect(second.syncToken).toBeNull();
});

test("going offline while fetching what the multiget left out stops the sync", async () => {
  const { OfflineError } = await import("@astrotime/core");
  const http: HttpClient = async (request) => {
    if (request.method === "GET") throw new OfflineError("offline");
    const reply = (body: string) => ({ status: 207, url: request.url, header: () => null, body });
    if (request.body?.includes("calendar-multiget"))
      return reply(`<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>`);
    return reply(multistatus(changed("a.ics"), "t2"));
  };
  const provider = new CalDavProvider(http, { username: "u", password: "p" }, home);
  await expect(provider.changes(home, { syncToken: "t1", ctag: null }, new Map())).rejects.toThrow(
    OfflineError,
  );
});

test("a 403 to sync-collection is an expired token only with RFC 6578's precondition", async () => {
  const answer = { body: "" };
  const http: HttpClient = async (request) => {
    if (request.method === "REPORT" && request.body?.includes("sync-collection"))
      return { status: 403, url: request.url, header: () => null, body: answer.body };
    return { status: 207, url: request.url, header: () => null, body: multistatus("", "t5") };
  };
  const provider = new CalDavProvider(http, { username: "u", password: "p" }, home);
  answer.body = `<?xml version="1.0"?><d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>`;
  expect(
    (await provider.changes(home, { syncToken: "old", ctag: null }, new Map())).changed,
  ).toEqual([]);
  answer.body = `<?xml version="1.0"?><d:error xmlns:d="DAV:"><d:need-privileges/></d:error>`;
  await expect(provider.changes(home, { syncToken: "old", ctag: null }, new Map())).rejects.toThrow(
    /403/,
  );
});
