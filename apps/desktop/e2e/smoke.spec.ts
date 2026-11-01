// The desktop app's smoke test (docs/plans/desktop.md#D79): the window shows
// the UI from app://, under its policy, with no Node in the page; the store
// runs in its own utility process on a file in userData; a password account
// signs in to a real Radicale and its items show, and show again from the
// local store after a restart with the server gone.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { test as base, expect, type Page } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { keepPassword, launch, profile, putEvent, signInByPassword } from "./support.ts";

const test = base.extend<{ radicale: CalDavServer }>({
  // The test stops it itself once; stopping again is nothing.
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    const stop = server.stop;
    let stopped: Promise<void> | undefined;
    await use({ ...server, stop: () => (stopped ??= stop()) });
    await (stopped ??= stop());
  },
});

const wednesday = (page: Page) => page.getByRole("list", { name: "Wednesday, November 4" });

test("the app starts sandboxed on app://, keeps its store in a utility process, and shows a Radicale account's items from it", async ({
  radicale,
}) => {
  const work = await radicale.mkcalendar("work");
  await putEvent(
    radicale,
    work,
    "planning",
    "Planning with Radicale",
    "20261104T140000",
    "20261104T150000",
  );
  const userData = profile();
  const { app, page } = await launch(userData);

  // The store opened: the first-run screen shows only then.
  await expect(
    page.getByRole("heading", { name: "Your calendars and tasks, from your own server" }),
  ).toBeVisible();
  expect(page.url()).toBe("app://astrotime/");
  // node:sqlite in a utility process of its own, on a file in userData (D73).
  const processes = await app.evaluate(({ app: main }) =>
    main.getAppMetrics().map((metric) => `${metric.type} ${metric.name ?? ""}`),
  );
  expect(processes).toContain("Utility AstroTime store");
  expect(existsSync(join(userData, "astrotime.sqlite3"))).toBe(true);
  // The page has no Node and holds only the bridge (D71); its policy runs no
  // script and applies no style it did not bring.
  const inside = await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = "#root { outline-offset: 7px }";
    document.head.append(style);
    const script = document.createElement("script");
    script.textContent = "window.injected = true";
    document.head.append(script);
    return {
      node: [typeof require, typeof process],
      bridge: Object.keys((window as unknown as { astrotime: object }).astrotime).toSorted(),
      injected: "injected" in window,
      outlineOffset: getComputedStyle(document.querySelector("#root")!).outlineOffset,
    };
  });
  expect(inside).toEqual({
    node: ["undefined", "undefined"],
    bridge: [
      "connectStore",
      "http",
      "onSyncRequest",
      "openExternal",
      "reminders",
      "secrets",
      "shell",
    ],
    injected: false,
    outlineOffset: "0px",
  });

  // Signing in with a password: through the main process's net.request (D72).
  await signInByPassword(page, radicale);
  // No keyring here (`--password-store=basic`): the app asks first (D74).
  await keepPassword(page, "Keep until AstroTime quits");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    wednesday(page).getByRole("listitem", { name: /^Planning with Radicale, / }),
  ).toBeVisible();
  await app.close();

  // The server goes; the items stay in the store. The password was kept
  // until the app quit, so the account asks to sign in again.
  await radicale.stop();
  const again = await launch(userData);
  await expect(
    wednesday(again.page).getByRole("listitem", { name: /^Planning with Radicale, / }),
  ).toBeVisible();
  await again.app.close();
});
