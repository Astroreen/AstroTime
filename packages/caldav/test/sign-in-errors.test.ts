// What signing in can run into, as errors the app can word for the user
// (docs/plans/foundation.md#D92): the proxy's own refusals (D20, D39), an
// unreachable server, an address that is no CalDAV server; and what Login
// Flow v2 waits through.
import { AuthError, OfflineError, ServerBusyError } from "@astrotime/core";
import { expect, test, vi } from "vite-plus/test";

import {
  CalDavProvider,
  CertificateError,
  fetchClient,
  NoCalendarHomeError,
  proxyHandler,
  ProxyRefusedError,
  startLoginFlow,
  throughProxy,
  type HttpClient,
} from "../src/index.ts";

const via = throughProxy("/dav-proxy/");
const credentials = { username: "u", password: "p" };

/** The web app's HTTP client in front of a proxy whose upstream answers with `answer`. */
function proxied(allow: readonly string[] | "*", answer: (url: URL) => Response): HttpClient {
  const handler = proxyHandler({
    prefix: "/dav-proxy/",
    allow,
    fetch: (async (input: URL | string) => answer(new URL(String(input)))) as typeof fetch,
  });
  return fetchClient({
    fetch: (async (input: URL | string, init: RequestInit) =>
      handler(new Request(new URL(String(input), "http://app.localhost"), init))) as typeof fetch,
    via,
  });
}

test("a server off the proxy's allowlist is refused as such, not as a wrong address", async () => {
  const http = proxied(["https://cloud.example.com"], () => new Response("never"));
  const refusal = CalDavProvider.discover(http, "https://other.example/", credentials);
  await expect(refusal).rejects.toThrow(ProxyRefusedError);
  await expect(refusal).rejects.toMatchObject({ reason: "not-allowed", location: null });
});

test("a server redirecting to another one names it, so the user signs in there (D39)", async () => {
  const http = proxied("*", (url) =>
    url.pathname === "/.well-known/caldav"
      ? new Response(null, { status: 301, headers: { Location: "https://dav.example.net/" } })
      : new Response("Not found", { status: 404 }),
  );
  await expect(
    CalDavProvider.discover(http, "https://example.com/", credentials),
  ).rejects.toMatchObject({
    name: "ProxyRefusedError",
    reason: "other-server",
    location: "https://dav.example.net",
  });
});

test("a server that cannot be reached is offline, and discovery stops at once", async () => {
  const requests: string[] = [];
  const http: HttpClient = async (request) => {
    requests.push(request.url);
    throw new OfflineError("offline");
  };
  await expect(
    CalDavProvider.discover(http, "https://cloud.example.com/", credentials),
  ).rejects.toThrow(OfflineError);
  expect(requests).toHaveLength(1);
});

test("a refused certificate is said as such, and discovery stops at once (android D62)", async () => {
  const requests: string[] = [];
  const http: HttpClient = async (request) => {
    requests.push(request.url);
    throw new CertificateError("refused");
  };
  await expect(
    CalDavProvider.discover(http, "https://cloud.example.com/", credentials),
  ).rejects.toThrow(CertificateError);
  expect(requests).toHaveLength(1);
});

test("an address that answers but is no CalDAV server, and a wrong password, are told apart", async () => {
  const page = proxied("*", () => new Response("<html>Hello</html>", { status: 200 }));
  await expect(CalDavProvider.discover(page, "https://example.com/", credentials)).rejects.toThrow(
    NoCalendarHomeError,
  );
  const refusing = proxied("*", () => new Response("", { status: 401 }));
  await expect(
    CalDavProvider.discover(refusing, "https://example.com/", credentials),
  ).rejects.toThrow(AuthError);
});

test("Login Flow v2 waits through a rate limit or a busy server while the user approves", async () => {
  const answers = [429, 503, 200];
  const http: HttpClient = async (request) => {
    const start = request.url.endsWith("/index.php/login/v2");
    const status = start ? 200 : answers.shift()!;
    const body = start
      ? {
          poll: { token: "t", endpoint: "https://cloud.example.com/login/v2/poll" },
          login: "https://cloud.example.com/login/v2/flow/x",
        }
      : { server: "https://cloud.example.com", loginName: "astro", appPassword: "app" };
    return { status, url: request.url, header: () => null, body: JSON.stringify(body) };
  };
  const flow = await startLoginFlow(http, "https://cloud.example.com");
  // Said as a busy server, which the sign-in waits out (foundation D130).
  await expect(flow.poll()).rejects.toThrow(ServerBusyError);
  await expect(flow.poll()).rejects.toThrow(ServerBusyError);
  expect(await flow.poll()).toMatchObject({ username: "astro", password: "app" });
});

test("Login Flow v2 gives up on a server that keeps failing, and says so", async () => {
  const http: HttpClient = async (request) => {
    const start = request.url.endsWith("/index.php/login/v2");
    const body = start
      ? {
          poll: { token: "t", endpoint: "https://cloud.example.com/login/v2/poll" },
          login: "https://cloud.example.com/login/v2/flow/x",
        }
      : {};
    return {
      status: start ? 200 : 502,
      url: request.url,
      header: () => null,
      body: JSON.stringify(body),
    };
  };
  const flow = await startLoginFlow(http, "https://cloud.example.com");
  for (let i = 0; i < 4; i++) expect(await flow.poll()).toBeNull();
  await expect(flow.poll()).rejects.toThrow(/keeps answering 502/);
});

test("a server that stalls is offline past the ceiling, its answer trickling or not at all (D91)", async () => {
  vi.useFakeTimers();
  try {
    const CEILING = 5 * 60_000;
    // Neither fetch ends until it is aborted, as a server that never answers.
    const silent = fetchClient({
      timeoutMs: CEILING,
      fetch: ((_input: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason)),
        )) as typeof fetch,
    });
    const trickling = fetchClient({
      timeoutMs: CEILING,
      fetch: (async (_input: unknown, init: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("<multistatus"));
              init.signal!.addEventListener("abort", () => controller.error(init.signal!.reason));
            },
          }),
        )) as typeof fetch,
    });
    const request = { method: "PROPFIND", url: "https://dav.example/", headers: {} };
    const answers = [silent(request), trickling(request)];
    for (const answer of answers) answer.catch(() => {});
    await vi.advanceTimersByTimeAsync(CEILING - 1);
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    for (const answer of answers) {
      await expect(answer).rejects.toThrow(OfflineError);
      await expect(answer).rejects.toThrow("in time");
    }
    // An answer in time leaves no timer behind.
    const quick = fetchClient({
      timeoutMs: CEILING,
      fetch: (async () => new Response("ok")) as typeof fetch,
    });
    expect((await quick(request)).body).toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("a 503 that says how long to wait is waited out, never counted toward giving up (foundation D130)", async () => {
  const http: HttpClient = async (request) => {
    const start = request.url.endsWith("/index.php/login/v2");
    const body = start
      ? {
          poll: { token: "t", endpoint: "https://cloud.example.com/login/v2/poll" },
          login: "https://cloud.example.com/login/v2/flow/x",
        }
      : {};
    return {
      status: start ? 200 : 503,
      url: request.url,
      header: (name: string) => (name === "retry-after" ? "10" : null),
      body: JSON.stringify(body),
    };
  };
  const flow = await startLoginFlow(http, "https://cloud.example.com");
  for (let i = 0; i < 10; i++) await expect(flow.poll()).rejects.toThrow(ServerBusyError);
});
