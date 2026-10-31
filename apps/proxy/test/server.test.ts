import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { throughProxy } from "@astrotime/caldav";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";

import { allowlist, createAppServer, DAV_PROXY_PREFIX } from "../src/server.ts";

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
