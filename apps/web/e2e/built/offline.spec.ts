// The built web app starts with no network (docs/plans/foundation.md#D124):
// on the image's own server, a first load installs the service worker, and
// with the network gone a reload shows the calendar with its data, from
// files the worker kept and the store on the device. The worker keeps
// neither CalDAV (/dav-proxy/) nor the deployment's preset (D123), and a
// newer version is offered quietly, then runs once the user reloads into it.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, expect, type Page } from "@playwright/test";

import { createAppServer } from "../../../proxy/src/server.ts";
import { startRadicale, type CalDavServer } from "../../../../packages/sync/test/servers.ts";
import { NOW, WIDE } from "../support.ts";

const DIST = fileURLToPath(new URL("../../dist", import.meta.url));

/** The image's server on `root`, at `port` (any when 0), allowed to reach `radicale`. */
async function serve(root: string, radicale: CalDavServer, port = 0, preset = false) {
  const server = createAppServer({
    root,
    allow: [new URL(radicale.url).origin],
    ...(preset ? { preset: { server: radicale.url, username: radicale.username } } : {}),
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The app's server has no port.");
  return { server, port: address.port };
}

const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

/** Resolves once this page's service worker runs (installed, its files kept, activated). */
const activated = (page: Page) =>
  page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active!;
    if (worker.state === "activated") return;
    await new Promise<void>((resolve) =>
      worker.addEventListener("statechange", () => worker.state === "activated" && resolve()),
    );
  });

const test = base.extend<{ radicale: CalDavServer; violations: string[] }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
  violations: async ({ page }, use) => {
    const violations: string[] = [];
    await page.exposeFunction("reportViolation", (violation: string) => violations.push(violation));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        const report = (window as unknown as { reportViolation(text: string): void })
          .reportViolation;
        report(`${event.effectiveDirective} blocked ${event.blockedURI || "inline"}`);
      });
    });
    page.on("console", (message) => {
      if (message.text().includes("Content Security Policy")) violations.push(message.text());
    });
    await use(violations);
  },
});

test.use({ viewport: WIDE });

const planning = (page: Page) =>
  page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("listitem", { name: /^Planning with Radicale, / });

test("with the network gone, a reload shows the calendar with its data; CalDAV is never kept, the preset only apart from the page", async ({
  page,
  context,
  radicale,
  violations,
}) => {
  const work = await radicale.mkcalendar("work");
  const put = await fetch(`${work}planning.ics`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${btoa(`${radicale.username}:${radicale.password}`)}`,
      "Content-Type": "text/calendar",
    },
    body: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Another client//EN\r\nBEGIN:VEVENT\r\nUID:planning\r\nDTSTAMP:20261101T080000Z\r\nDTSTART;TZID=Europe/Vilnius:20261104T140000\r\nDTEND;TZID=Europe/Vilnius:20261104T150000\r\nSUMMARY:Planning with Radicale\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
  });
  expect(put.status).toBe(201);
  // A single-user deployment (D123): the preset's sign-in, the password alone.
  let { server, port } = await serve(DIST, radicale, 0, true);
  try {
    await page.clock.setFixedTime(NOW);
    await page.goto(`http://127.0.0.1:${port}/`);
    const signIn = page.getByRole("dialog", { name: /^Sign in to / });
    await signIn.getByLabel("Password").fill(radicale.password);
    await signIn.getByRole("button", { name: "Sign in" }).click();
    await expect(planning(page)).toBeVisible();
    await activated(page);

    // What the worker keeps: this version's files and its page, no CalDAV,
    // and the page without the preset, which only the server says.
    const kept = await page.evaluate(async () => {
      const [name] = await caches.keys();
      const cache = await caches.open(name!);
      const paths = (await cache.keys()).map((request) => new URL(request.url).pathname);
      const html = await (await cache.match("/"))!.text();
      return { name, paths, preset: html.includes('name="astrotime-') };
    });
    expect(kept.name).toMatch(/^astrotime-/);
    expect(kept.paths).toContain("/");
    expect(kept.paths.some((path) => path.endsWith(".wasm"))).toBe(true);
    expect(kept.paths.filter((path) => path.startsWith("/dav-proxy/"))).toEqual([]);
    expect(kept.preset).toBe(false);

    // A navigation to CalDAV's proxy is not the app's: the worker leaves it
    // to the network, which answers it; with none, it fails, never the app.
    const dav = `http://127.0.0.1:${port}/dav-proxy/${encodeURIComponent(new URL(radicale.url).origin)}/astro/`;
    expect((await page.goto(dav))?.fromServiceWorker()).toBe(false);
    await context.setOffline(true);
    await expect(page.goto(dav)).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
    await context.setOffline(false);
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(planning(page)).toBeVisible();

    // No network: the page, its scripts, the store's worker and SQLite's wasm
    // come from the worker, the items from the store on the device.
    await context.setOffline(true);
    const loaded = page.waitForResponse((answer) => new URL(answer.url()).pathname === "/");
    await page.reload();
    expect((await loaded).fromServiceWorker()).toBe(true);
    // The kept page comes with the preset the network's page had (kept apart):
    // a start with no network or a slow one signs in as the server's page does.
    await expect(page.locator('meta[name="astrotime-server"]')).toHaveCount(1);
    await expect(planning(page)).toBeVisible();
    // Said calmly: offline, no dot of trouble on the account button.
    const account = page.getByRole("region", { name: /^astro@/ });
    await expect(
      account.getByText("Offline: changes wait until the server can be reached"),
    ).toBeVisible();
    const button = page.getByRole("button", { name: /^Accounts/ });
    await expect(button).toHaveAccessibleName("Accounts");
    await expect(page.getByText("Accounts, something needs your attention")).toHaveCount(0);
    await expect(button.locator(".bg-danger")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await context.setOffline(false);

    // The network back, but the container down behind its reverse proxy,
    // which answers 502: the kept page all the same.
    await close(server);
    server = createServer((_request, answer) => answer.writeHead(502).end("Bad Gateway"));
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    const proxied = page.waitForResponse((answer) => new URL(answer.url()).pathname === "/");
    await page.reload();
    const served = await proxied;
    expect([served.fromServiceWorker(), served.status()]).toEqual([true, 200]);
    await expect(planning(page)).toBeVisible();

    // Lie-fi: the server takes the request and never answers. The worker
    // waits a bounded moment, then the kept page answers. The page sets the
    // bound to none first, so nothing here waits on time passing: the
    // reload's own load is the event.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const reply = new MessageChannel();
          reply.port1.addEventListener("message", () => resolve());
          reply.port1.start();
          navigator.serviceWorker.controller!.postMessage(
            { type: "astrotime-navigation-bound", ms: 0 },
            [reply.port2],
          );
        }),
    );
    await close(server);
    server = createServer(() => {});
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    const stalled = page.waitForResponse((answer) => new URL(answer.url()).pathname === "/");
    await page.reload();
    expect((await stalled).fromServiceWorker()).toBe(true);
    await expect(planning(page)).toBeVisible();
    expect(violations).toEqual([]);
  } finally {
    await close(server);
  }
});

test("a page that answers by a redirect (a sign-on in front, a slash added) is never kept: the install fails, keeping nothing", async ({
  page,
  radicale,
}) => {
  // The app's server, behind a front that sends anything but a navigation to
  // `/` on to a login page, as a single sign-on proxy does to a worker's fetch.
  const app = createAppServer({ root: DIST, allow: [new URL(radicale.url).origin] });
  const front = createServer((request, answer) => {
    if (request.url === "/login") {
      answer.writeHead(200, { "Content-Type": "text/html" }).end("<!doctype html><p>Sign in");
    } else if (request.url === "/" && request.headers["sec-fetch-mode"] !== "navigate") {
      answer.writeHead(302, { Location: "/login" }).end();
    } else {
      app.emit("request", request, answer);
    }
  });
  await new Promise<void>((resolve) => front.listen(0, "127.0.0.1", resolve));
  const { port } = front.address() as AddressInfo;
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.getByRole("button", { name: /^Accounts/ })).toBeVisible();
    // The worker's end: activated, or redundant when its install failed.
    const outcome = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.register("/sw.js");
      const worker = registration.installing ?? registration.waiting ?? registration.active!;
      const done = () => worker.state === "activated" || worker.state === "redundant";
      if (!done())
        await new Promise<void>((resolve) =>
          worker.addEventListener("statechange", () => done() && resolve()),
        );
      return { state: worker.state, caches: await caches.keys() };
    });
    expect(outcome).toEqual({ state: "redundant", caches: [] });
  } finally {
    await close(front);
  }
});

test("a newer version is offered quietly; the tab whose user asks reloads into it, the others offer it and wait", async ({
  page,
  context,
  radicale,
  violations,
}) => {
  // Two versions of the app: the build, and a copy whose worker differs.
  const roots = await mkdtemp(join(tmpdir(), "astrotime-versions-"));
  const [first, second] = [join(roots, "first"), join(roots, "second")];
  await cp(DIST, first, { recursive: true });
  await cp(DIST, second, { recursive: true });
  // A file only the older version has, as a lazily loaded chunk would be.
  await writeFile(join(first, "assets", "lazy-old.js"), "export const old = true;\n");
  const firstWorker = await readFile(join(first, "sw.js"), "utf8");
  expect(firstWorker).toContain('["/",');
  await writeFile(
    join(first, "sw.js"),
    firstWorker.replace('["/",', '["/","/assets/lazy-old.js",'),
  );
  let { server, port } = await serve(first, radicale);
  try {
    await page.clock.setFixedTime(NOW);
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.getByRole("button", { name: /^Accounts/ })).toBeVisible();
    await activated(page);
    const name = (await page.evaluate(() => caches.keys())).find(
      (cache) => cache !== "astrotime-versions",
    );
    const version = name!.slice("astrotime-".length);
    const worker = await readFile(join(second, "sw.js"), "utf8");
    expect(worker).toContain(version);
    await writeFile(join(second, "sw.js"), worker.replaceAll(version, "newer-version-00"));
    // The newer page says so, to tell which version's page a load gets.
    const page2 = await readFile(join(second, "index.html"), "utf8");
    await writeFile(
      join(second, "index.html"),
      page2.replace("<title>AstroTime</title>", "<title>AstroTime</title><!-- the newer page -->"),
    );
    // The page this worker runs; the first install offers nothing.
    await page.reload();
    await expect(page.getByRole("button", { name: /^Accounts/ })).toBeVisible();
    await expect(page.getByText("A new version of AstroTime is ready.")).toHaveCount(0);

    // A second tab, with a mark that a reload would lose.
    const other = await context.newPage();
    await other.goto(`http://127.0.0.1:${port}/`);
    await expect(other.getByRole("button", { name: /^Accounts/ })).toBeVisible();
    await other.evaluate(() => Object.assign(globalThis, { notReloaded: true }));

    // The server now has the newer version; the page looks for it.
    await close(server);
    ({ server } = await serve(second, radicale, port));
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    const notice = page
      .getByRole("status")
      .filter({ hasText: "A new version of AstroTime is ready." });
    await expect(notice).toBeVisible();
    // The PR's evidence, when asked for (as the screenshot specs take theirs).
    const shots = process.env["ASTROTIME_SCREENSHOTS"];
    if (shots) await page.screenshot({ path: join(shots, "update-ready-dark-en-wide.png") });
    const reloaded = page.waitForEvent("load");
    await notice.getByRole("button", { name: "Reload" }).click();
    await reloaded;
    await expect(page.getByRole("button", { name: /^Accounts/ })).toBeVisible();
    // The newer version runs; the older's files stay, for the tab it still runs.
    expect((await page.evaluate(() => caches.keys())).toSorted()).toEqual([
      `astrotime-${version}`,
      "astrotime-newer-version-00",
      "astrotime-versions",
    ]);
    await expect(notice).toHaveCount(0);
    // The tab on the older page asks for a file only its version has, which
    // the server no longer has: it comes from the older version's cache. A
    // tab on the newer page is not given it, and a file neither version has
    // is the network's 404, for either.
    // Past the browser's own HTTP cache, where the install's fetch left the
    // older file (immutable, as every hashed file is): only the worker answers.
    const get = (tab: Page, path: string) =>
      tab.evaluate(async (url) => {
        const answer = await fetch(url, { cache: "no-store" });
        return [answer.status, answer.ok ? await answer.text() : ""];
      }, path);
    expect(await get(other, "/assets/lazy-old.js")).toEqual([200, "export const old = true;\n"]);
    expect(await get(page, "/assets/lazy-old.js")).toEqual([404, ""]);
    expect(await get(other, "/assets/nowhere.js")).toEqual([404, ""]);
    // With no network the page comes from the newer version's cache, never
    // the older's, which still holds its own.
    await context.setOffline(true);
    await page.reload();
    expect(await page.content()).toContain("<!-- the newer page -->");
    await context.setOffline(false);

    // The other tab did not reload by itself: it offers the version that now
    // runs it, and loads it when its user asks.
    const offered = other
      .getByRole("status")
      .filter({ hasText: "A new version of AstroTime is ready." });
    await expect(offered).toBeVisible();
    expect(await other.evaluate(() => "notReloaded" in globalThis)).toBe(true);
    const otherReloaded = other.waitForEvent("load");
    await offered.getByRole("button", { name: "Reload" }).click();
    await otherReloaded;
    await expect(other.getByRole("button", { name: /^Accounts/ })).toBeVisible();
    expect(await other.evaluate(() => "notReloaded" in globalThis)).toBe(false);
    expect(violations).toEqual([]);
  } finally {
    await close(server);
    await rm(roots, { recursive: true, force: true });
  }
});

test("the app can be installed: its manifest and icons", async ({ page, radicale }) => {
  const { server, port } = await serve(DIST, radicale);
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    const href = await page.locator('link[rel="manifest"]').getAttribute("href");
    const answer = await page.request.get(`http://127.0.0.1:${port}${href}`);
    expect(answer.headers()["content-type"]).toBe("application/manifest+json");
    const manifest = (await answer.json()) as {
      name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; type: string; purpose?: string }[];
    };
    expect([manifest.name, manifest.start_url, manifest.display]).toEqual([
      "AstroTime",
      "/",
      "standalone",
    ]);
    const sizes = manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose ?? "any"}`);
    expect(sizes).toEqual(
      expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable"]),
    );
    for (const icon of manifest.icons) {
      const image = await page.request.get(`http://127.0.0.1:${port}${icon.src}`);
      expect([icon.src, image.status(), image.headers()["content-type"]]).toEqual([
        icon.src,
        200,
        icon.type,
      ]);
    }
  } finally {
    await close(server);
  }
});
