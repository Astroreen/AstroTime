import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { throughProxy } from "@astrotime/caldav";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { compress } from "../src/compress.ts";
import {
  allowlist,
  contentSecurityPolicy,
  createAppServer,
  DAV_PROXY_PREFIX,
  negotiate,
  NONCE_PLACEHOLDER,
  publicHosts,
} from "../src/server.ts";

const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
};

let app: string;
let dav: string;
const servers: Server[] = [];

beforeAll(async () => {
  // A stand-in CalDAV server that echoes what reached it.
  const target = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      res.writeHead(207, {
        "Content-Type": "application/xml",
        ETag: '"7"',
        "Set-Cookie": "nc_session=secret",
      });
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          cookie: req.headers.cookie,
          body,
        }),
      );
    });
  });
  servers.push(target);
  dav = await listen(target);

  // A root whose own path holds "assets": only files under its assets/ are immutable.
  const root = join(mkdtempSync(join(tmpdir(), "astrotime-web-")), "assets", "web");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), "<!doctype html><title>AstroTime</title>");
  writeFileSync(join(root, "assets", "app-1a2b.js"), "console.log(1)");
  const server = createAppServer({ root, allow: [dav] });
  servers.push(server);
  app = await listen(server);
});

afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(resolve))));
});

describe("the web app's server", () => {
  test("serves the app, its hashed assets as immutable, and the app for unknown routes", async () => {
    const index = await fetch(`${app}/`);
    expect([
      index.status,
      index.headers.get("content-type"),
      index.headers.get("cache-control"),
    ]).toEqual([200, "text/html; charset=utf-8", "no-cache"]);
    const asset = await fetch(`${app}/assets/app-1a2b.js`);
    expect([asset.status, asset.headers.get("cache-control")]).toEqual([
      200,
      "public, max-age=31536000, immutable",
    ]);
    expect(await (await fetch(`${app}/week/2026-11-02`)).text()).toContain(
      "<title>AstroTime</title>",
    );
  });

  test("never serves a file outside the app's directory", async () => {
    const response = await fetch(`${app}/..%2f..%2f..%2fetc%2fpasswd`);
    expect(response.status).toBe(404);
  });

  test("only files under assets/ are immutable, however the path is spelled", async () => {
    const shell = await fetch(`${app}/assets/..%2findex.html`);
    expect([shell.status, shell.headers.get("cache-control")]).toEqual([200, "no-cache"]);
  });

  test("anything but GET and HEAD outside the proxy is a 405", async () => {
    expect((await fetch(`${app}/`, { method: "POST", body: "x" })).status).toBe(405);
  });

  test("proxied answers are never cached", async () => {
    const response = await fetch(
      `${app}${throughProxy(DAV_PROXY_PREFIX).to(`${dav}/remote.php/dav/`)}`,
      { method: "PROPFIND" },
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("a request announcing more than the cap is refused before it is read", async () => {
    const { request } = await import("node:http");
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(`${app}${throughProxy(DAV_PROXY_PREFIX).to(`${dav}/x.ics`)}`, {
        method: "PUT",
        headers: { "Content-Length": String(11 * 1024 * 1024) },
      });
      req.on("response", (res) => resolve(res.statusCode ?? 0));
      req.on("error", reject);
      // Nothing of the announced body is sent: the answer must come anyway.
      req.flushHeaders();
    });
    expect(status).toBe(413);
  });

  test("a missing asset is a 404, not the app; a bad escape is a 400", async () => {
    expect((await fetch(`${app}/assets/gone-0000.js`)).status).toBe(404);
    expect((await fetch(`${app}/favicon.ico`)).status).toBe(404);
    expect(await (await fetch(`${app}/day/2026.10.31`)).text()).toContain(
      "<title>AstroTime</title>",
    );
    expect((await fetch(`${app}/%E0%A4%A`)).status).toBe(400);
  });

  test("a request too large for CalDAV is refused", async () => {
    const response = await fetch(`${app}${throughProxy(DAV_PROXY_PREFIX).to(`${dav}/x.ics`)}`, {
      method: "PUT",
      body: "x".repeat(10 * 1024 * 1024 + 1),
    });
    expect(response.status).toBe(413);
  });

  test("passes CalDAV requests to an allowed server, with only CalDAV's headers both ways", async () => {
    const response = await fetch(
      `${app}${throughProxy(DAV_PROXY_PREFIX).to(`${dav}/remote.php/dav/`)}`,
      {
        method: "PROPFIND",
        headers: { Authorization: "Basic YTpi", Depth: "0", Cookie: "app=1" },
        body: "<propfind/>",
      },
    );
    expect(response.status).toBe(207);
    expect(response.headers.get("etag")).toBe('"7"');
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({
      method: "PROPFIND",
      url: "/remote.php/dav/",
      authorization: "Basic YTpi",
      body: "<propfind/>",
    });
  });

  test("the app's https page behind a TLS terminator may use the proxy (D40)", async () => {
    const response = await fetch(
      `${app}${throughProxy(DAV_PROXY_PREFIX).to(`${dav}/remote.php/dav/`)}`,
      {
        method: "PROPFIND",
        headers: { Origin: `https://${new URL(app).host}`, "Sec-Fetch-Site": "same-origin" },
      },
    );
    expect(response.status).toBe(207);
  });

  test("refuses servers off the allowlist", async () => {
    const response = await fetch(
      `${app}${throughProxy(DAV_PROXY_PREFIX).to("https://elsewhere.example/dav/")}`,
      { method: "PROPFIND" },
    );
    expect(response.status).toBe(403);
  });

  test("answers its health check", async () => {
    expect(await (await fetch(`${app}/healthz`)).text()).toBe("ok");
    expect(await (await fetch(`${app}/healthz?probe=1`)).text()).toBe("ok");
  });
});

test("the allowlist is required, and holds origins only", () => {
  expect(() => allowlist(undefined)).toThrow(/ASTROTIME_PROXY_ALLOW/);
  expect(() => allowlist("*")).toThrow(/not an origin/);
  expect(() => allowlist("https://cloud.example.com/remote.php")).toThrow(/not an origin/);
  expect(() => allowlist("cloud.example.com")).toThrow(/"cloud.example.com" is not an origin/);
  expect(allowlist(" https://cloud.example.com , http://10.0.0.2:8080")).toEqual([
    "https://cloud.example.com",
    "http://10.0.0.2:8080",
  ]);
});

test("an answer that breaks off midway is cut off, never ended as if whole", async () => {
  const broken = (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<multistatus>"));
          controller.error(new Error("upstream broke"));
        },
      }),
      { status: 207 },
    )) as unknown as typeof fetch;
  const root = mkdtempSync(join(tmpdir(), "astrotime-web-"));
  writeFileSync(join(root, "index.html"), "x");
  const server = createAppServer({ root, allow: ["https://dav.example"], fetch: broken });
  const base = await listen(server);
  // However far the answer got, reading it whole fails: it is never a complete 207.
  const read = fetch(`${base}${throughProxy(DAV_PROXY_PREFIX).to("https://dav.example/cal/")}`, {
    method: "PROPFIND",
  }).then((response) => response.text());
  await expect(read).rejects.toThrow();
  await new Promise((resolve) => server.close(resolve));
});

test("a request the proxy refuses is answered without its body being read", async () => {
  const root = mkdtempSync(join(tmpdir(), "astrotime-web-"));
  writeFileSync(join(root, "index.html"), "x");
  const server = createAppServer({ root, allow: ["https://dav.example"] });
  const base = await listen(server);
  const { request } = await import("node:http");
  // A body that never ends: only an answer that does not wait for it can come.
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      `${base}${throughProxy(DAV_PROXY_PREFIX).to("https://unlisted.example/x.ics")}`,
      { method: "PUT" },
    );
    req.on("response", (res) => resolve(res.statusCode ?? 0));
    req.on("error", reject);
    req.write("partial");
  });
  expect(status).toBe(403);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test("a chunked request without a length is cut off at the cap", async () => {
  const root = mkdtempSync(join(tmpdir(), "astrotime-web-"));
  writeFileSync(join(root, "index.html"), "x");
  const reached: number[] = [];
  const upstream = (async (_input: unknown, init: RequestInit) => {
    await new Response(init.body as BodyInit).arrayBuffer();
    reached.push(1);
    return new Response("never");
  }) as unknown as typeof fetch;
  const server = createAppServer({ root, allow: ["https://dav.example"], fetch: upstream });
  const base = await listen(server);
  const { request } = await import("node:http");
  const status = await new Promise<number>((resolve, reject) => {
    const req = request(
      `${base}${throughProxy(DAV_PROXY_PREFIX).to("https://dav.example/x.ics")}`,
      { method: "PUT" },
    );
    req.on("response", (res) => resolve(res.statusCode ?? 0));
    req.on("error", reject);
    const chunk = Buffer.alloc(1024 * 1024, 120);
    for (let i = 0; i < 11; i++) req.write(chunk);
    req.end();
  });
  expect(status).toBe(413);
  expect(reached).toEqual([]);
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

/** A GET or HEAD with headers fetch would not send as given (Host, Accept-Encoding). */
const raw = async (
  base: string,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
) => {
  const { request } = await import("node:http");
  return new Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }>(
    (resolve, reject) => {
      const req = request(`${base}${path}`, { method, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      });
      req.on("error", reject);
      req.end();
    },
  );
};

describe("static files (D80)", () => {
  let base: string;
  let root: string;
  let server: Server;
  const script = `console.log(${JSON.stringify("calendar ".repeat(200))})`;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "astrotime-web-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(
      join(root, "index.html"),
      `<!doctype html><title>AstroTime</title>${"<p>".repeat(100)}`,
    );
    writeFileSync(join(root, "assets", "app-1a2b.js"), script);
    writeFileSync(join(root, "assets", "tiny-0000.js"), "1");
    writeFileSync(join(root, "assets", "logo-1a2b.png"), Buffer.alloc(2000));
    // Compressible, larger when compressed (kept as it is), not compressible,
    // and the page, filled afresh on every answer (D110).
    expect(await compress(root)).toBe(2);
    server = createAppServer({ root, allow: ["https://dav.example"] });
    base = await listen(server);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("sends brotli first, then gzip, and the file as it is to a client that asks for neither", async () => {
    const { gunzipSync, brotliDecompressSync } = await import("node:zlib");
    const br = await raw(base, "/assets/app-1a2b.js", { "Accept-Encoding": "gzip, deflate, br" });
    expect([br.headers["content-encoding"], br.headers["vary"]]).toEqual(["br", "Accept-Encoding"]);
    expect(brotliDecompressSync(br.body).toString()).toBe(script);
    expect(Number(br.headers["content-length"])).toBe(br.body.length);
    const gzip = await raw(base, "/assets/app-1a2b.js", { "Accept-Encoding": "gzip" });
    expect(gzip.headers["content-encoding"]).toBe("gzip");
    expect(gunzipSync(gzip.body).toString()).toBe(script);
    const plain = await raw(base, "/assets/app-1a2b.js");
    expect([plain.headers["content-encoding"], plain.headers["vary"]]).toEqual([
      undefined,
      "Accept-Encoding",
    ]);
    expect(plain.body.toString()).toBe(script);
    // Every variant is the same file, so it carries the asset's own type.
    expect(br.headers["content-type"]).toBe("text/javascript; charset=utf-8");
  });

  test("honours q-values: br;q=0 is never sent br", async () => {
    const answer = await raw(base, "/assets/app-1a2b.js", { "Accept-Encoding": "br;q=0, gzip" });
    expect(answer.headers["content-encoding"]).toBe("gzip");
    const neither = await raw(base, "/assets/app-1a2b.js", {
      "Accept-Encoding": "br;q=0, gzip;q=0",
    });
    expect(neither.headers["content-encoding"]).toBeUndefined();
  });

  test("a file with nothing smaller to send goes as it is", async () => {
    for (const path of ["/assets/tiny-0000.js", "/assets/logo-1a2b.png"]) {
      const answer = await raw(base, path, { "Accept-Encoding": "br, gzip" });
      expect([answer.status, answer.headers["content-encoding"]]).toEqual([200, undefined]);
    }
  });

  test("answers If-None-Match with 304, per encoding", async () => {
    const first = await raw(base, "/assets/app-1a2b.js", { "Accept-Encoding": "br" });
    const etag = String(first.headers["etag"]);
    expect(etag).toMatch(/^"[\w-]{22}"$/);
    const again = await raw(base, "/assets/app-1a2b.js", {
      "Accept-Encoding": "br",
      "If-None-Match": `"other", W/${etag}`,
    });
    expect([again.status, again.body.length, again.headers["etag"]]).toEqual([304, 0, etag]);
    expect(again.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    // The gzip variant is another representation, with its own ETag.
    const gzip = await raw(base, "/assets/app-1a2b.js", {
      "Accept-Encoding": "gzip",
      "If-None-Match": etag,
    });
    expect(gzip.status).toBe(200);
    expect(gzip.headers["etag"]).not.toBe(etag);
  });

  test("a precompressed copy is not a route of its own", async () => {
    for (const path of ["/assets/app-1a2b.js.br", "/assets/app-1a2b.js.gz", "/index.html.br"]) {
      expect([path, (await raw(base, path)).status]).toEqual([path, 404]);
    }
  });

  test("a file that changes gets a new ETag, and the old one no longer matches", async () => {
    const first = await raw(base, "/assets/tiny-0000.js");
    const etag = String(first.headers["etag"]);
    writeFileSync(join(root, "assets", "tiny-0000.js"), "22");
    const changed = await raw(base, "/assets/tiny-0000.js", { "If-None-Match": etag });
    expect(changed.status).toBe(200);
    expect(changed.body.toString()).toBe("22");
    expect(changed.headers["etag"]).not.toBe(etag);
    const again = await raw(base, "/assets/tiny-0000.js", {
      "If-None-Match": String(changed.headers["etag"]),
    });
    expect(again.status).toBe(304);
  });

  test("the app's page is fetched afresh on every route: never immutable, compressed or 304", async () => {
    const page = await raw(base, "/", { "Accept-Encoding": "br" });
    expect([
      page.status,
      page.headers["cache-control"],
      page.headers["content-encoding"],
      page.headers["etag"],
    ]).toEqual([200, "no-cache", undefined, undefined]);
    const route = await raw(base, "/week/2026-11-02", {
      "Accept-Encoding": "br",
      "If-None-Match": "*",
    });
    expect([route.status, route.headers["cache-control"]]).toEqual([200, "no-cache"]);
  });

  test("HEAD answers the headers of GET, without a body", async () => {
    const get = await raw(base, "/assets/app-1a2b.js", { "Accept-Encoding": "gzip" });
    const head = await raw(base, "/assets/app-1a2b.js", { "Accept-Encoding": "gzip" }, "HEAD");
    expect(head.status).toBe(200);
    expect(head.body.length).toBe(0);
    for (const name of [
      "content-length",
      "content-encoding",
      "etag",
      "cache-control",
      "content-type",
    ]) {
      expect(head.headers[name]).toBe(get.headers[name]);
    }
    expect((await raw(base, "/assets/gone-0000.js", {}, "HEAD")).status).toBe(404);
  });
});

describe("the Content Security Policy (D110)", () => {
  let base: string;
  // The page as Vite builds it with `html.cspNonce` (apps/web/vite.config.ts).
  const html = `<!doctype html><meta property="csp-nonce" nonce="${NONCE_PLACEHOLDER}"><script type="module" src="/assets/app-1a2b.js" nonce="${NONCE_PLACEHOLDER}"></script>`;

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), "astrotime-web-"));
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "index.html"), html);
    // A copy an older image's build left: the page never goes compressed.
    writeFileSync(join(root, "index.html.br"), "stale");
    writeFileSync(join(root, "assets", "app-1a2b.js"), "console.log(1)");
    const server = createAppServer({ root, allow: [dav] });
    servers.push(server);
    base = await listen(server);
  });

  const nonceOf = (policy: unknown) => /'nonce-([^']+)'/.exec(String(policy))?.[1];

  test("the page, on every route, names a fresh nonce, the one in its tags", async () => {
    const nonces: string[] = [];
    for (const path of ["/", "/index.html", "/week/2026-11-02", "/day/2026-11-04?x=1"]) {
      const page = await raw(base, path, { "Accept-Encoding": "br, gzip" });
      const nonce = nonceOf(page.headers["content-security-policy"]);
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(page.body.toString()).toBe(html.replaceAll(NONCE_PLACEHOLDER, nonce!));
      expect(page.headers["content-security-policy"]).toBe(contentSecurityPolicy(nonce));
      expect(Number(page.headers["content-length"])).toBe(page.body.length);
      nonces.push(nonce!);
    }
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  test("the policy loads only the app's own scripts, styles, workers and connections", () => {
    expect(contentSecurityPolicy("n0nce").split("; ")).toEqual([
      "default-src 'none'",
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'nonce-n0nce'",
      "connect-src 'self'",
      "worker-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]);
    expect(contentSecurityPolicy()).toContain("style-src 'self';");
  });

  test("the page carries the other security headers", async () => {
    const page = await raw(base, "/");
    expect([
      page.headers["referrer-policy"],
      page.headers["cross-origin-opener-policy"],
      page.headers["x-content-type-options"],
      page.headers["permissions-policy"],
    ]).toEqual(["same-origin", "same-origin", "nosniff", expect.stringContaining("camera=()")]);
  });

  test("HEAD answers the page's headers, without a body", async () => {
    const head = await raw(base, "/", {}, "HEAD");
    expect([head.status, head.body.length, Number(head.headers["content-length"])]).toEqual([
      200,
      0,
      Buffer.byteLength(html.replaceAll(NONCE_PLACEHOLDER, "x".repeat(24))),
    ]);
    expect(nonceOf(head.headers["content-security-policy"])).toBeDefined();
  });

  test("a file carries the policy without a nonce, for a worker's sake, and stays cached", async () => {
    const asset = await raw(base, "/assets/app-1a2b.js");
    expect([asset.headers["content-security-policy"], asset.headers["cache-control"]]).toEqual([
      contentSecurityPolicy(),
      "public, max-age=31536000, immutable",
    ]);
    const again = await raw(base, "/assets/app-1a2b.js", {
      "If-None-Match": String(asset.headers["etag"]),
    });
    expect([again.status, again.headers["content-security-policy"]]).toEqual([
      304,
      contentSecurityPolicy(),
    ]);
  });

  test("proxied answers still pass, and a page among them runs nothing", async () => {
    const answer = await fetch(`${base}${throughProxy(DAV_PROXY_PREFIX).to(`${dav}/dav/`)}`, {
      method: "PROPFIND",
    });
    expect([answer.status, (await answer.json()).method]).toEqual([207, "PROPFIND"]);
    expect(answer.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
  });

  test("the health check carries no policy", async () => {
    const health = await fetch(`${base}/healthz`);
    expect([health.status, health.headers.get("content-security-policy")]).toEqual([200, null]);
  });
});

test("Accept-Encoding: the highest q wins, ties go to brotli, nothing asked is identity", () => {
  const both = ["br", "gzip"] as const;
  expect(negotiate(undefined, both)).toBe("identity");
  expect(negotiate("", both)).toBe("identity");
  expect(negotiate("gzip, br", both)).toBe("br");
  expect(negotiate("gzip;q=1, br;q=0.5", both)).toBe("gzip");
  expect(negotiate("BR;Q=0.1", both)).toBe("br");
  expect(negotiate("*", both)).toBe("br");
  expect(negotiate("*;q=0, gzip", both)).toBe("gzip");
  expect(negotiate("br", ["gzip"])).toBe("identity");
  expect(negotiate("identity;q=0, br;q=0", both)).toBe("identity");
});

describe("the Host allowlist (D81)", () => {
  let base: string;
  let server: Server;

  beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), "astrotime-web-"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>AstroTime</title>");
    const hosts = publicHosts("Calendar.example.com, cal.example.com:8443, [::1]");
    server = createAppServer({ root, allow: ["https://dav.example"], ...(hosts ? { hosts } : {}) });
    base = await listen(server);
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("a listed host passes, on any port unless the entry names one", async () => {
    for (const host of [
      "calendar.example.com",
      "CALENDAR.example.com:8080",
      "cal.example.com:8443",
      "[::1]:8080",
    ]) {
      expect([host, (await raw(base, "/", { Host: host })).status]).toEqual([host, 200]);
    }
  });

  test("any other host is refused with 421, the app and the proxy alike", async () => {
    for (const host of [
      "evil.example",
      "cal.example.com",
      "cal.example.com:9000",
      "calendar.example.com.evil.example",
      "127.0.0.1",
    ]) {
      expect([host, (await raw(base, "/", { Host: host })).status]).toEqual([host, 421]);
    }
    const proxied = await raw(base, throughProxy(DAV_PROXY_PREFIX).to("https://dav.example/cal/"), {
      Host: "evil.example",
    });
    expect(proxied.status).toBe(421);
  });

  test("an HTTP/1.0 request, which may have no Host, is refused with 421", async () => {
    const { connect } = await import("node:net");
    const { port } = new URL(base);
    const socket = connect(Number(port), "127.0.0.1");
    socket.end("GET / HTTP/1.0\r\n\r\n");
    let answer = "";
    for await (const chunk of socket) answer += String(chunk);
    expect(answer.split("\r\n")[0]).toBe("HTTP/1.1 421 Misdirected Request");
  });

  test("the health check answers whatever the host", async () => {
    for (const host of ["localhost:8080", "127.0.0.1:8080", "10.1.2.3:8080", "evil.example"]) {
      const answer = await raw(base, "/healthz", { Host: host });
      expect([host, answer.status, answer.body.toString()]).toEqual([host, 200, "ok"]);
    }
  });
});

test("ASTROTIME_PUBLIC_HOST lists host names, each with an optional port", () => {
  expect(() => publicHosts("calendar.example.com:443")).toThrow(/list it as calendar.example.com/);
  expect(() => publicHosts("calendar.example.com:80")).toThrow(/default port/);
  expect(publicHosts(undefined)).toBeUndefined();
  expect(publicHosts(" , ")).toBeUndefined();
  expect(publicHosts(" Calendar.example.com , cal.example.com:8443, [::1]:8080")).toEqual([
    { hostname: "calendar.example.com", port: null },
    { hostname: "cal.example.com", port: "8443" },
    { hostname: "[::1]", port: "8080" },
  ]);
  for (const wrong of [
    "*",
    "https://calendar.example.com",
    "calendar.example.com/",
    "::1",
    "a.example:0",
    "a.example:99999",
  ]) {
    expect(() => publicHosts(wrong)).toThrow(/ASTROTIME_PUBLIC_HOST: .* is not a host name/);
  }
});

test("compressing again drops a copy that no longer pays off", async () => {
  const root = mkdtempSync(join(tmpdir(), "astrotime-web-"));
  writeFileSync(join(root, "app.js"), "calendar ".repeat(200));
  expect(await compress(root)).toBe(2);
  writeFileSync(join(root, "app.js"), "1");
  expect(await compress(root)).toBe(0);
  expect(readdirSync(root)).toEqual(["app.js"]);
});
