import { expect, test } from "vite-plus/test";

import { CalDavProvider, canonicalHref, type HttpClient, type HttpRequest } from "../src/index.ts";

test("hrefs the server names on another origin never get the credentials", async () => {
  const requests: HttpRequest[] = [];
  const http: HttpClient = async (request) => {
    requests.push(request);
    const body = request.body?.includes("calendar-multiget")
      ? ""
      : `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>https://evil.example/steal.ics</d:href><d:propstat><d:prop><d:getetag>"1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response><d:response><d:href>/cal/ok.ics</d:href><d:propstat><d:prop><d:getetag>"2"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
    return { status: 207, url: request.url, header: () => null, body };
  };
  const provider = new CalDavProvider(
    http,
    { username: "u", password: "p" },
    "https://dav.example/cal/",
  );
  await provider.changes("https://dav.example/cal/", { syncToken: null, ctag: null }, new Map());
  expect(requests.every((r) => new URL(r.url).origin === "https://dav.example")).toBe(true);
  expect(requests.some((r) => r.body?.includes("evil.example"))).toBe(false);
  await expect(provider.fetch("https://evil.example/steal.ics")).rejects.toThrow(
    /credentials stay home/,
  );
});

test("hrefs spelled differently by the server are the same resource", async () => {
  expect(canonicalHref("https://dav.example/cal/a@b.ics")).toBe(
    canonicalHref("https://dav.example/cal/a%40b.ics"),
  );
  const http: HttpClient = async (request) => ({
    status: 207,
    url: request.url,
    header: () => null,
    body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/cal/a@b.ics</d:href><d:propstat><d:prop><d:getetag>"1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
  });
  const provider = new CalDavProvider(
    http,
    { username: "u", password: "p" },
    "https://dav.example/cal/",
  );
  const known = new Map([[canonicalHref("https://dav.example/cal/a%40b.ics"), '"1"']]);
  const changes = await provider.changes(
    "https://dav.example/cal/",
    { syncToken: null, ctag: null },
    known,
  );
  expect([changes.changed, changes.removed]).toEqual([[], []]);
});

test("discovery does not follow a principal or a home the server names on another origin", async () => {
  const requests: string[] = [];
  const http: HttpClient = async (request) => {
    requests.push(request.url);
    const href = request.url.includes("principal") ? "calendar-home-set" : "current-user-principal";
    const target = request.url.includes("principal")
      ? "https://evil.example/home/"
      : "https://dav.example/principal/";
    return {
      status: 207,
      url: request.url,
      header: () => null,
      body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/</d:href><d:propstat><d:prop><${href === "calendar-home-set" ? "c:" : "d:"}${href}><d:href>${target}</d:href></${href === "calendar-home-set" ? "c:" : "d:"}${href}></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
    };
  };
  await expect(
    CalDavProvider.discover(http, "https://dav.example/", { username: "u", password: "p" }),
  ).rejects.toThrow(/No CalDAV calendar home/);
  expect(requests.every((url) => new URL(url).origin === "https://dav.example")).toBe(true);
});

test("requests about an href use the server's own spelling of it", async () => {
  const bodies: string[] = [];
  const http: HttpClient = async (request) => {
    bodies.push(`${request.method} ${request.url} ${request.body ?? ""}`);
    if (request.body?.includes("calendar-multiget")) {
      return {
        status: 207,
        url: request.url,
        header: () => null,
        body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/cal/a@b.ics</d:href><d:propstat><d:prop><d:getetag>"2"</d:getetag><c:calendar-data>BEGIN:VCALENDAR&#13;
END:VCALENDAR</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
      };
    }
    return {
      status: 207,
      url: request.url,
      header: () => null,
      body: `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/cal/a@b.ics</d:href><d:propstat><d:prop><d:getetag>"2"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
    };
  };
  const provider = new CalDavProvider(
    http,
    { username: "u", password: "p" },
    "https://dav.example/cal/",
  );
  await provider.changes("https://dav.example/cal/", { syncToken: null, ctag: null }, new Map());
  const multiget = bodies.find((b) => b.includes("calendar-multiget"))!;
  expect(multiget).toContain("<d:href>/cal/a@b.ics</d:href>");
});

test("writes and deletions use the server's spelling too", async () => {
  const urls: string[] = [];
  const http: HttpClient = async (request) => {
    urls.push(`${request.method} ${request.url}`);
    const listing = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/cal/a@b.ics</d:href><d:propstat><d:prop><d:getetag>"1"</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
    return {
      status: request.method === "PROPFIND" ? 207 : 204,
      url: request.url,
      header: () => null,
      body: request.method === "PROPFIND" ? listing : "",
    };
  };
  const provider = new CalDavProvider(
    http,
    { username: "u", password: "p" },
    "https://dav.example/cal/",
  );
  const known = new Map([[canonicalHref("https://dav.example/cal/a@b.ics"), '"1"']]);
  await provider.changes("https://dav.example/cal/", { syncToken: null, ctag: null }, known);
  const href = canonicalHref("https://dav.example/cal/a@b.ics");
  await provider.update(href, "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", '"1"');
  await provider.remove(href, '"2"');
  expect(urls.filter((u) => !u.startsWith("PROPFIND"))).toEqual([
    "PUT https://dav.example/cal/a@b.ics",
    "DELETE https://dav.example/cal/a@b.ics",
  ]);
});
