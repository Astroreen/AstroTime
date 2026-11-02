// The built app under its Content Security Policy (docs/plans/foundation.md#D110),
// served by the web image's own server: the store opens (wasm in a worker, on
// OPFS), an account is added through /dav-proxy/, its event's details (with
// its place's map, D178, and an inline attachment saved, design D230) and
// edit dialog (with Location's search) open, and
// the browser reports not one violation. The
// production build has no demo data (D57), so the app starts on its
// first-run screen, which shows only once the store is open.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { test as base, expect } from "@playwright/test";

import { createAppServer } from "../../../proxy/src/server.ts";
import { startRadicale, type CalDavServer } from "../../../../packages/sync/test/servers.ts";
import { addAccount, openApp, WIDE } from "../support.ts";

const test = base.extend<{ radicale: CalDavServer; violations: string[] }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
  // The app on the image's server, which may proxy to this test's Radicale only.
  baseURL: async ({ radicale }, use) => {
    const server = createAppServer({
      root: fileURLToPath(new URL("../../dist", import.meta.url)),
      allow: [new URL(radicale.url).origin],
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("The app's server has no port.");
    await use(`http://127.0.0.1:${address.port}`);
    await new Promise((resolve) => server.close(resolve));
  },
  // Every violation the page or its workers report: as an event in the
  // page, and on the console, where a worker's go too.
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

/** A white tile: a 1×1 PNG. */
const TILE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

test("the built app opens its store, adds an account through the proxy, and breaks no rule of its policy", async ({
  page,
  radicale,
  violations,
}) => {
  const work = await radicale.mkcalendar("work");
  const response = await fetch(`${work}planning.ics`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${btoa(`${radicale.username}:${radicale.password}`)}`,
      "Content-Type": "text/calendar",
    },
    body: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Another client//EN\r\nBEGIN:VEVENT\r\nUID:planning\r\nDTSTAMP:20261101T080000Z\r\nDTSTART;TZID=Europe/Vilnius:20261104T140000\r\nDTEND;TZID=Europe/Vilnius:20261104T150000\r\nSUMMARY:Planning with Radicale\r\nDESCRIPTION:Notes: https://example.com/plan. Not a link: javascript:alert(1)\r\nLOCATION:Brandenburg Gate\\, Pariser Platz 1\\, Berlin\r\nGEO:52.51627;13.377703\r\nATTACH;ENCODING=BASE64;VALUE=BINARY;FMTTYPE=text/plain;FILENAME=agenda.txt:MS4gQnVkZ2V0Cg==\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
  });
  expect(response.status).toBe(201);

  // Every script and wasm the page or its workers fetch: a worker follows the
  // policy of its own script, not the page's (D110).
  const files: { path: string; policy: string }[] = [];
  page.on("response", (answer) => {
    const path = new URL(answer.url()).pathname;
    if (/\.(js|wasm)$/.test(path)) {
      files.push({ path, policy: answer.headers()["content-security-policy"] ?? "" });
    }
  });
  // Photon and the tiles, faked: the policy is the browser's to apply before
  // a request leaves, so a refused origin is a violation all the same.
  await page.route("https://photon.komoot.io/api/**", (route) =>
    route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: readFileSync(
        new URL("../../../../packages/ui/test/fixtures/photon-en.json", import.meta.url),
      ),
    }),
  );
  const tiles: string[] = [];
  await page.route("https://tile.openstreetmap.org/**", (route) => {
    tiles.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: TILE });
  });
  const loaded = page.waitForResponse((answer) => new URL(answer.url()).pathname === "/");
  await openApp(page);
  const policy = (await loaded).headers()["content-security-policy"] ?? "";
  expect(policy).toContain("default-src 'none'");
  // The store opened: SQLite's wasm in its worker, on OPFS.
  await expect(page.getByRole("button", { name: /^Accounts/ })).toBeVisible();

  // The worker's script and SQLite's wasm came with the policy, without a nonce.
  expect(files.some((file) => file.path.endsWith(".wasm"))).toBe(true);
  for (const file of files) {
    expect([file.path, file.policy.includes("default-src 'none'")]).toEqual([file.path, true]);
    expect([file.path, file.policy.includes("nonce-")]).toEqual([file.path, false]);
  }

  // The page's nonce, as the app reads it for Base UI, is the one its policy names,
  // and a <style> that carries it applies.
  const nonce = await page.evaluate(() => {
    const meta = document.querySelector<HTMLMetaElement>("meta[property=csp-nonce]");
    const style = document.createElement("style");
    style.nonce = meta?.nonce ?? "";
    style.textContent = "#root { outline-offset: 7px }";
    document.head.append(style);
    return {
      value: meta?.nonce,
      attribute: meta?.getAttribute("nonce"),
      applied: getComputedStyle(document.querySelector("#root")!).outlineOffset,
    };
  });
  expect(policy).toContain(`'nonce-${nonce.value}'`);
  // The browser hides it from the DOM's attribute, out of reach of selectors.
  expect([nonce.attribute, nonce.applied]).toEqual(["", "7px"]);

  // Signing in goes through /dav-proxy/ on the page's own origin.
  const dialog = await addAccount(page, "caldav");
  await dialog.getByRole("textbox", { name: "Server address" }).fill(radicale.url);
  await dialog.getByRole("textbox", { name: "User name" }).fill(radicale.username);
  await dialog.getByLabel("Password").fill(radicale.password);
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page
      .getByRole("list", { name: "Wednesday, November 4" })
      .getByRole("listitem", { name: /^Planning with Radicale, / }),
  ).toBeVisible();

  // The details show the description's web link as a link, and nothing else
  // as one; the edit dialog opens over them (foundation D9).
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Planning with Radicale, / })
    .click();
  const details = page.getByRole("dialog", { name: "Planning with Radicale" });
  const description = details.getByRole("definition").filter({ hasText: "Notes:" });
  await expect(description.getByRole("link")).toHaveCount(1);
  await expect(description.getByRole("link", { name: "https://example.com/plan" })).toHaveAttribute(
    "href",
    "https://example.com/plan",
  );
  await expect(details.getByText(/javascript:alert\(1\)/)).toBeVisible();
  // The place's map, its tiles from OpenStreetMap's server (img-src, D178).
  const map = details.getByRole("img", { name: "Map of Brandenburg Gate" });
  await expect(map).toBeVisible();
  await map
    .locator("img")
    .evaluateAll((all) =>
      Promise.all(
        (all as HTMLImageElement[]).map((img) =>
          img.complete ? null : new Promise((done) => img.addEventListener("load", done)),
        ),
      ),
    );
  expect(tiles.length).toBeGreaterThan(0);
  // An inline attachment saved: a download link of its bytes (a `blob:`
  // URL), clicked under the policy (design D230).
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    details.getByRole("button", { name: /^Save agenda\.txt / }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("agenda.txt");
  expect(readFileSync(await download.path(), "utf8")).toBe("1. Budget\n");
  await details.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  await expect(edit).toBeVisible();
  // Location's search reaches Photon from the page (connect-src, D178).
  await edit.getByRole("combobox", { name: "Location" }).fill("Brandenburger Tor");
  await expect(
    page.getByRole("listbox", { name: "Places" }).getByRole("option").first(),
  ).toBeVisible();

  expect(violations).toEqual([]);
});
