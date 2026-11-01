// The built web app starts with no network (docs/plans/foundation.md#D124):
// on the image's own server, a first load installs the service worker, and
// with the network gone a reload shows the calendar with its data, from
// files the worker kept and the store on the device. The worker keeps
// neither CalDAV (/dav-proxy/) nor the deployment's preset (D123), and a
// newer version is offered quietly, then runs once the user reloads into it.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
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

test("with the network gone, a reload shows the calendar with its data; CalDAV and the preset are never kept", async ({
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

    // No network: the page, its scripts, the store's worker and SQLite's wasm
    // come from the worker, the items from the store on the device.
    await context.setOffline(true);
    const loaded = page.waitForResponse((answer) => new URL(answer.url()).pathname === "/");
    await page.reload();
    expect((await loaded).fromServiceWorker()).toBe(true);
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
    const answer = await proxied;
    expect([answer.fromServiceWorker(), answer.status()]).toEqual([true, 200]);
    await expect(planning(page)).toBeVisible();
    expect(violations).toEqual([]);
  } finally {
    await close(server);
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
  let { server, port } = await serve(first, radicale);
  try {
    await page.clock.setFixedTime(NOW);
    await page.goto(`http://127.0.0.1:${port}/`);
    await expect(page.getByRole("button", { name: /^Accounts/ })).toBeVisible();
    await activated(page);
    const [name] = await page.evaluate(() => caches.keys());
    const version = name!.slice("astrotime-".length);
    const worker = await readFile(join(second, "sw.js"), "utf8");
    expect(worker).toContain(version);
    await writeFile(join(second, "sw.js"), worker.replaceAll(version, "newer-version-00"));
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
    // The newer version runs, and the older's files are gone.
    expect(await page.evaluate(() => caches.keys())).toEqual(["astrotime-newer-version-00"]);
    await expect(notice).toHaveCount(0);

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
