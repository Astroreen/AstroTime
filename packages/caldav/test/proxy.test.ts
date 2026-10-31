import { expect, test } from "vite-plus/test";

import { fetchClient, proxyHandler, throughProxy } from "../src/index.ts";

const via = throughProxy("/dav-proxy/");

test("server URLs map into the proxy and back", () => {
  const url = "https://cloud.example.com/remote.php/dav/calendars/astro/personal/?x=1";
  expect(via.to(url)).toBe(
    "/dav-proxy/https%3A%2F%2Fcloud.example.com/remote.php/dav/calendars/astro/personal/?x=1",
  );
  expect(via.from(via.to(url))).toBe(url);
  expect(via.from(`http://app.localhost${via.to(url)}`)).toBe(url);
  // A URL outside the proxy is left alone.
  expect(via.from("https://cloud.example.com/x")).toBe("https://cloud.example.com/x");
});

function upstream(answer: (url: URL, init: RequestInit) => Response) {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: URL | string, init: RequestInit) => {
    seen.push({ url: String(input), init });
    return answer(new URL(String(input)), init);
  }) as typeof fetch;
  return { seen, fetchImpl };
}

test("only CalDAV's headers pass, both ways; cookies never", async () => {
  const { seen, fetchImpl } = upstream(
    () =>
      new Response("<multistatus/>", {
        status: 207,
        headers: {
          ETag: '"1"',
          "Set-Cookie": "s=1",
          DAV: "1, calendar-access",
          "X-Powered-By": "PHP",
        },
      }),
  );
  const handler = proxyHandler({
    prefix: "/dav-proxy/",
    allow: ["https://cloud.example.com"],
    fetch: fetchImpl,
  });
  const response = await handler(
    new Request(`http://app.localhost${via.to("https://cloud.example.com/remote.php/dav/")}`, {
      method: "PROPFIND",
      headers: {
        Authorization: "Basic YTpi",
        Depth: "1",
        Cookie: "app=1",
        Origin: "http://app.localhost",
        "If-Match": '"0"',
      },
      body: "<propfind/>",
    }),
  );
  const sent = new Headers(seen[0]?.init.headers);
  expect([...sent.keys()].toSorted()).toEqual([
    "authorization",
    "content-type",
    "depth",
    "if-match",
  ]);
  expect(seen[0]?.init).toMatchObject({
    method: "PROPFIND",
    body: "<propfind/>",
    redirect: "manual",
  });
  expect(response.status).toBe(207);
  expect([...response.headers.keys()].toSorted()).toEqual([
    "cache-control",
    "content-type",
    "dav",
    "etag",
  ]);
});

test("a redirect comes back mapped into the proxy", async () => {
  const { fetchImpl } = upstream(
    () => new Response(null, { status: 301, headers: { Location: "/remote.php/dav/" } }),
  );
  const handler = proxyHandler({
    prefix: "/dav-proxy/",
    allow: ["https://cloud.example.com"],
    fetch: fetchImpl,
  });
  const response = await handler(
    new Request(`http://app.localhost${via.to("https://cloud.example.com/.well-known/caldav")}`, {
      method: "PROPFIND",
    }),
  );
  expect([response.status, response.headers.get("location")]).toEqual([
    301,
    via.to("https://cloud.example.com/remote.php/dav/"),
  ]);
});

test("origins off the allowlist and non-HTTP targets are refused before anything leaves", async () => {
  const { seen, fetchImpl } = upstream(() => new Response("never"));
  const handler = proxyHandler({
    prefix: "/dav-proxy/",
    allow: ["https://cloud.example.com"],
    fetch: fetchImpl,
  });
  const elsewhere = await handler(
    new Request(`http://app.localhost${via.to("https://evil.example/")}`),
  );
  const file = await handler(
    new Request(`http://app.localhost/dav-proxy/${encodeURIComponent("file://")}/etc/passwd`),
  );
  expect([elsewhere.status, file.status]).toEqual([403, 400]);
  expect(seen).toEqual([]);
});

test("a malformed proxied URL is a 400 and an unreachable server a 502, never a crash", async () => {
  const failing = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const handler = proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: failing });
  const malformed = await handler(new Request("http://app.localhost/dav-proxy/%E0%A4%A/x"));
  const unreachable = await handler(
    new Request(`http://app.localhost${via.to("https://down.example/dav/")}`, {
      method: "PROPFIND",
    }),
  );
  expect([malformed.status, unreachable.status]).toEqual([400, 502]);
});

test("a page on another origin cannot use the proxy", async () => {
  const { seen, fetchImpl } = upstream(() => new Response("never"));
  const handler = proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: fetchImpl });
  const url = `http://app.localhost${via.to("https://cloud.example.com/remote.php/dav/")}`;
  const fromElsewhere = await handler(
    new Request(url, { method: "PROPFIND", headers: { Origin: "https://evil.example" } }),
  );
  const crossSite = await handler(
    new Request(url, { headers: { "Sec-Fetch-Site": "cross-site" } }),
  );
  expect([fromElsewhere.status, crossSite.status]).toEqual([403, 403]);
  expect(seen).toEqual([]);
  // The app's own page passes.
  const own = await handler(
    new Request(url, {
      method: "PROPFIND",
      headers: { Origin: "http://app.localhost", "Sec-Fetch-Site": "same-origin" },
    }),
  );
  expect(own.status).toBe(200);
});

test("a redirect to another server is refused, so the browser never carries the credentials there", async () => {
  const { fetchImpl } = upstream(
    () =>
      new Response(null, { status: 302, headers: { Location: "https://elsewhere.example/dav/" } }),
  );
  const handler = proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: fetchImpl });
  const response = await handler(
    new Request(`http://app.localhost${via.to("https://cloud.example.com/.well-known/caldav")}`, {
      method: "PROPFIND",
    }),
  );
  expect([response.status, response.headers.get("location")]).toEqual([502, null]);
});

test("behind a TLS terminator the app's https page still passes: the host is compared, not the scheme", async () => {
  const { fetchImpl } = upstream(() => new Response("ok"));
  const handler = proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: fetchImpl });
  const response = await handler(
    new Request(`http://astrotime.example${via.to("https://cloud.example.com/dav/")}`, {
      method: "PROPFIND",
      headers: { Origin: "https://astrotime.example", "Sec-Fetch-Site": "same-origin" },
    }),
  );
  expect(response.status).toBe(200);
});

test("an answer with a null-body status such as 205 passes without a body", async () => {
  const { fetchImpl } = upstream(() => new Response(null, { status: 205 }));
  const handler = proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: fetchImpl });
  const response = await handler(
    new Request(`http://app.localhost${via.to("https://cloud.example.com/x")}`, {
      method: "PUT",
      body: "x",
    }),
  );
  expect(response.status).toBe(205);
});

test("a malformed redirect is a 502, not a crash", async () => {
  const { fetchImpl } = upstream(
    () => new Response(null, { status: 301, headers: { Location: "http://[bad" } }),
  );
  const handler = proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: fetchImpl });
  const response = await handler(
    new Request(`http://app.localhost${via.to("https://cloud.example.com/x")}`),
  );
  expect(response.status).toBe(502);
});

test("a 401 passes without WWW-Authenticate, so the browser shows no dialog of its own", async () => {
  const { fetchImpl } = upstream(
    () =>
      new Response("", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="SabreDAV"' } }),
  );
  const handler = proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: fetchImpl });
  const response = await handler(
    new Request(`http://app.localhost${via.to("https://cloud.example.com/x")}`, {
      method: "PROPFIND",
    }),
  );
  expect([response.status, response.headers.get("www-authenticate")]).toEqual([401, null]);
});

test("a server the proxy cannot reach is offline for the client, not a 502 from the server", async () => {
  const { OfflineError } = await import("@astrotime/core");
  const failing = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const handler = proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: failing });
  const http = fetchClient({
    fetch: (async (input: URL | string, init: RequestInit) =>
      handler(new Request(new URL(String(input), "http://app.localhost"), init))) as typeof fetch,
    via,
  });
  await expect(
    http({ method: "PROPFIND", url: "https://down.example/dav/", headers: {} }),
  ).rejects.toThrow(OfflineError);
});

test("allowlist entries match however their origin is spelled", async () => {
  const { fetchImpl } = upstream(() => new Response("ok"));
  const handler = proxyHandler({
    prefix: "/dav-proxy/",
    allow: ["HTTPS://Cloud.Example.com:443/"],
    fetch: fetchImpl,
  });
  const response = await handler(
    new Request(`http://app.localhost${via.to("https://cloud.example.com/dav/")}`),
  );
  expect(response.status).toBe(200);
});
