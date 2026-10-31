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
