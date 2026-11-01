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
          "Retry-After": "120",
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
        "OCS-APIRequest": "true",
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
    "ocs-apirequest",
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
    "retry-after",
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

test("a redirect from http to https on the same host, and a 201's Location, pass mapped", async () => {
  const answer = (status: number, location: string) => {
    const { fetchImpl } = upstream(
      () => new Response(null, { status, headers: { Location: location } }),
    );
    return proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: fetchImpl })(
      new Request(`http://app.localhost${via.to("http://cloud.example.com/.well-known/caldav")}`, {
        method: "PROPFIND",
      }),
    );
  };
  const upgrade = await answer(301, "https://cloud.example.com/remote.php/dav/");
  expect([upgrade.status, upgrade.headers.get("location")]).toEqual([
    301,
    via.to("https://cloud.example.com/remote.php/dav/"),
  ]);
  const created = await answer(201, "https://files.example.net/new.ics");
  expect([created.status, created.headers.get("location")]).toEqual([
    201,
    via.to("https://files.example.net/new.ics"),
  ]);
  // Another port is another server.
  expect((await answer(301, "https://cloud.example.com:8443/dav/")).status).toBe(502);
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

test("the answer is streamed through, and the client going away aborts the request to the server", async () => {
  let signal: AbortSignal | undefined;
  const fetchImpl = (async (_input: URL | string, init: RequestInit) => {
    signal = init.signal ?? undefined;
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("<multistatus>"));
      },
    });
    return new Response(body, { status: 207 });
  }) as typeof fetch;
  const handler = proxyHandler({ prefix: "/dav-proxy/", allow: "*", fetch: fetchImpl });
  const client = new AbortController();
  const response = await handler(
    new Request(`http://app.localhost${via.to("https://cloud.example.com/cal/")}`, {
      method: "PROPFIND",
      signal: client.signal,
    }),
  );
  // The first chunk arrives while the upstream answer is still open: streamed, not buffered.
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe("<multistatus>");
  client.abort();
  expect(signal?.aborted).toBe(true);
});
