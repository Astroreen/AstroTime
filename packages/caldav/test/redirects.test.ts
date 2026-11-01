// The redirect rule the native shells share over a one-hop client
// (docs/plans/desktop.md#D72, docs/plans/android.md#D62): the URL that
// answered, methods and bodies as fetch keeps them, and Authorization only
// for the request's own origin.
import { expect, test } from "vite-plus/test";

import { followRedirects, type HttpClient, type HttpRequest } from "../src/index.ts";

/** A server whose paths `/to/<status>/<url>` redirect there; every other path answers 200. */
function server() {
  const seen: HttpRequest[] = [];
  const hop: HttpClient = async (request) => {
    seen.push(request);
    const redirect = /^\/to\/(\d{3})\/(.+)$/.exec(new URL(request.url).pathname);
    const location = redirect ? decodeURIComponent(redirect[2]!) : null;
    return {
      status: redirect ? Number(redirect[1]) : 200,
      url: request.url,
      header: (name) => (name.toLowerCase() === "location" ? location : null),
      body: redirect ? "" : "answered",
    };
  };
  return { http: followRedirects(hop), seen };
}

const to = (status: number, url: string, from = "https://dav.example") =>
  `${from}/to/${status}/${encodeURIComponent(url)}`;

const request = (method: string, url: string): HttpRequest => ({
  method,
  url,
  headers: { Authorization: "Basic dTpw", "Content-Type": "application/xml", Depth: "1" },
  body: "<propfind/>",
});

test("the answer is the last hop's, with the URL that answered", async () => {
  const { http, seen } = server();
  const response = await http(
    request("PROPFIND", to(301, "/remote.php/dav/", "https://dav.example")),
  );
  expect([response.status, response.url, response.body]).toEqual([
    200,
    "https://dav.example/remote.php/dav/",
    "answered",
  ]);
  expect(seen.map((r) => r.url)).toEqual([
    to(301, "/remote.php/dav/"),
    "https://dav.example/remote.php/dav/",
  ]);
});

test("307 and 308 keep the method and body; 301 and 302 change only a POST; 303 anything but GET and HEAD", async () => {
  const cases: [number, string, string, boolean][] = [
    [307, "PROPFIND", "PROPFIND", true],
    [308, "REPORT", "REPORT", true],
    [301, "PROPFIND", "PROPFIND", true],
    [302, "REPORT", "REPORT", true],
    [301, "POST", "GET", false],
    [302, "POST", "GET", false],
    [303, "PROPFIND", "GET", false],
    [303, "HEAD", "HEAD", true],
  ];
  for (const [status, method, then, body] of cases) {
    const { http, seen } = server();
    await http(request(method, to(status, "https://dav.example/home/")));
    const last = seen.at(-1)!;
    expect([status, method, last.method, last.body !== undefined]).toEqual([
      status,
      method,
      then,
      body,
    ]);
    // A body dropped takes the headers that describe it along.
    expect([status, method, "Content-Type" in last.headers]).toEqual([status, method, body]);
    expect(last.headers["Depth"]).toBe("1");
  }
});

test("Authorization goes only to the request's origin: another host, scheme or port drops it for good", async () => {
  for (const elsewhere of [
    "https://other.example/home/",
    "http://dav.example/home/",
    "https://dav.example:8443/home/",
  ]) {
    const { http, seen } = server();
    // Away, and back to the request's origin: once dropped, it stays dropped.
    const response = await http(
      request("PROPFIND", to(307, to(307, "https://dav.example/home/", new URL(elsewhere).origin))),
    );
    expect(response.url).toBe("https://dav.example/home/");
    expect(seen.map((r) => [new URL(r.url).origin, "Authorization" in r.headers])).toEqual([
      ["https://dav.example", true],
      [new URL(elsewhere).origin, false],
      ["https://dav.example", false],
    ]);
  }
  // Within the origin it stays.
  const { http, seen } = server();
  await http(request("PROPFIND", to(308, "/elsewhere/on/the/same/server/")));
  expect(seen.every((r) => r.headers["Authorization"] === "Basic dTpw")).toBe(true);
});

test("ten redirects are followed; the eleventh is returned as it came", async () => {
  let url = "https://dav.example/home/";
  for (let i = 0; i < 10; i++) url = to(302, url);
  const followed = server();
  expect((await followed.http(request("PROPFIND", url))).status).toBe(200);
  expect(followed.seen).toHaveLength(11);

  const { http, seen } = server();
  const response = await http(request("PROPFIND", to(302, url)));
  expect([response.status, seen.length]).toEqual([302, 11]);
});

test("a redirect without a usable Location, or to another scheme than http(s), is the answer", async () => {
  const { http } = server();
  expect((await http(request("GET", to(302, "ftp://dav.example/")))).status).toBe(302);
  const noLocation: HttpClient = followRedirects(async (r) => ({
    status: 301,
    url: r.url,
    header: () => null,
    body: "",
  }));
  expect((await noLocation(request("GET", "https://dav.example/"))).status).toBe(301);
});
