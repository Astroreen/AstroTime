// A dialog loaded with its first opening (docs/plans/foundation.md#D145), on
// the image's own server: when its code does not arrive the app says so in
// its place, and "Try again" brings the dialog once it can. The service
// worker, which keeps every file of the version (D124), is kept out, so the
// network is all there is.
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { test as base, expect } from "@playwright/test";

import { createAppServer } from "../../../proxy/src/server.ts";
import { openApp, WIDE } from "../support.ts";

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  baseURL: async ({}, use) => {
    const server = createAppServer({
      root: fileURLToPath(new URL("../../dist", import.meta.url)),
      allow: [],
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await new Promise((resolve) => server.close(resolve));
  },
});

test.use({ viewport: WIDE, serviceWorkers: "block" });

test("the edit dialog's code that did not arrive is asked for again", async ({ page }) => {
  // The edit dialog's chunk fails, under any URL it is asked for, until the
  // test lets it through.
  const editor = /\/assets\/item-editor-[\w-]+\.js/;
  await page.route(editor, (route) => route.abort("internetdisconnected"));
  await openApp(page);
  await page.getByRole("button", { name: "Create" }).first().click();
  const failed = page.getByRole("alertdialog", { name: /Could not load this part of AstroTime/ });
  await expect(failed).toBeVisible();
  await page.unroute(editor);
  await failed.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("dialog", { name: "New event" })).toBeVisible();
  await expect(failed).toHaveCount(0);
});
