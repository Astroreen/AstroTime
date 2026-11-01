// Editing against a real Radicale (docs/plans/foundation.md#pr-6--editing,
// D91): an event made with "+" is a pending change in the local store that
// the UI's sync uploads, shortly after the change, to the server, where
// another client reads it. Radicale is the one the sync package's
// integration tests start, ready when it says so.
import { test as base, expect } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { openApp, WIDE } from "./support.ts";

const test = base.extend<{ radicale: CalDavServer }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
});

test.use({ viewport: WIDE });

test("an event created here reaches the server", async ({ page, radicale }) => {
  const work = await radicale.mkcalendar("work");
  await openApp(page);
  await page.getByRole("button", { name: "Another CalDAV server" }).click();
  const signIn = page.getByRole("dialog", { name: "Add an account" });
  await signIn.getByRole("textbox", { name: "Server address" }).fill(radicale.url);
  await signIn.getByRole("textbox", { name: "User name" }).fill(radicale.username);
  await signIn.getByLabel("Password").fill(radicale.password);
  await signIn.getByRole("button", { name: "Sign in" }).click();
  await expect(signIn).toHaveCount(0);

  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Made in AstroTime");
  await dialog.getByLabel("Start time").fill("16:00");
  // The upload is the event to wait for: the sync after a local change (D91).
  const uploaded = page.waitForResponse((response) => response.request().method() === "PUT");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(
    page
      .getByRole("list", { name: "Wednesday, November 4" })
      .getByRole("listitem", { name: "Made in AstroTime, 4:00 – 5:00 PM" }),
  ).toBeVisible();
  const response = await uploaded;
  expect(response.status()).toBe(201);
  const uid = /\r\nUID:([^\r]+)\r\n/.exec(response.request().postData() ?? "")?.[1];
  expect(uid).toBeTruthy();

  // As another client reads it.
  const stored = await fetch(`${work}${uid}.ics`, {
    headers: { Authorization: `Basic ${btoa(`${radicale.username}:${radicale.password}`)}` },
  });
  expect(stored.status).toBe(200);
  const ics = await stored.text();
  expect(ics).toContain("SUMMARY:Made in AstroTime");
  expect(ics).toContain("DTSTART;TZID=Europe/Vilnius:20261104T160000");
  expect(ics).toContain("PRODID:-//AstroTime//AstroTime//EN");
});
