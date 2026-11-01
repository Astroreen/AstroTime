// Editing against a real Radicale (docs/plans/foundation.md#pr-6--editing,
// D91): an event made with "+" is a pending change in the local store that
// the UI's sync uploads, shortly after the change, to the server, where
// another client reads it; dragged to another day and time (design D111),
// it is uploaded again. Radicale is the one the sync package's integration
// tests start, ready when it says so.
import { test as base, expect } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { addAccount, openApp, WIDE } from "./support.ts";

const test = base.extend<{ radicale: CalDavServer }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
});

test.use({ viewport: WIDE });

test("an event created here reaches the server, and again once dragged", async ({
  page,
  radicale,
}) => {
  const work = await radicale.mkcalendar("work");
  await openApp(page);
  // The calendar on this device first, so its stepping aside below is seen, not assumed.
  await expect(page.getByRole("region", { name: "On this device" })).toBeVisible();
  const signIn = await addAccount(page, "caldav");
  await signIn.getByRole("textbox", { name: "Server address" }).fill(radicale.url);
  await signIn.getByRole("textbox", { name: "User name" }).fill(radicale.username);
  await signIn.getByLabel("Password").fill(radicale.password);
  await signIn.getByRole("button", { name: "Sign in" }).click();
  await expect(signIn).toHaveCount(0);
  // The first sync brought the server's calendar, so the unused calendar on
  // this device stepped aside (D122): a new event goes to the server's.
  await expect(page.getByRole("region", { name: "On this device" })).toHaveCount(0);

  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Made in AstroTime");
  await dialog.getByLabel("Start time").selectOption("16:00");
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

  // Dragged from Wednesday's 4:00 PM to Thursday's 5:00 PM, it is uploaded again.
  const made = page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("listitem", { name: "Made in AstroTime, 4:00 – 5:00 PM" });
  const from = (await made.boundingBox())!;
  const thursday = (await page.getByRole("list", { name: "Thursday, November 5" }).boundingBox())!;
  const moved = page.waitForResponse((answer) => answer.request().method() === "PUT");
  await page.mouse.move(from.x + from.width / 2, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(thursday.x + thursday.width / 2, thursday.y + 17.1 * 56, { steps: 8 });
  await page.mouse.up();
  await expect(
    page
      .getByRole("list", { name: "Thursday, November 5" })
      .getByRole("listitem", { name: "Made in AstroTime, 5:00 – 6:00 PM" }),
  ).toBeVisible();
  const update = await moved;
  expect(update.ok()).toBe(true);
  expect(update.request().headers()["if-match"]).toBeTruthy();
  const again = await fetch(`${work}${uid}.ics`, {
    headers: { Authorization: `Basic ${btoa(`${radicale.username}:${radicale.password}`)}` },
  });
  const changed = await again.text();
  expect(changed).toContain("DTSTART;TZID=Europe/Vilnius:20261105T170000");
  expect(changed).toContain("DTEND;TZID=Europe/Vilnius:20261105T180000");
  expect(changed).toContain("SUMMARY:Made in AstroTime");
});

test("a change the server dropped is told in the accounts dialog and in Settings alike (design D137)", async ({
  page,
  radicale,
}) => {
  const work = await radicale.mkcalendar("work");
  await openApp(page);
  const signIn = await addAccount(page, "caldav");
  await signIn.getByRole("textbox", { name: "Server address" }).fill(radicale.url);
  await signIn.getByRole("textbox", { name: "User name" }).fill(radicale.username);
  await signIn.getByLabel("Password").fill(radicale.password);
  await signIn.getByRole("button", { name: "Sign in" }).click();
  await expect(signIn).toHaveCount(0);
  await expect(page.getByRole("region", { name: "On this device" })).toHaveCount(0);
  // The first sync has ended, its calendars written: an item made before it
  // could name a calendar the sync was replacing (seen on CI).
  await expect(
    page.getByRole("navigation", { name: "Main menu" }).getByText(/^Synced at /),
  ).toBeVisible();

  // Made here and uploaded.
  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Gone elsewhere");
  await dialog.getByLabel("Start time").selectOption("16:00");
  const uploaded = page.waitForResponse((response) => response.request().method() === "PUT");
  await dialog.getByRole("button", { name: "Save" }).click();
  const response = await uploaded;
  expect(response.status()).toBe(201);
  const uid = /\r\nUID:([^\r]+)\r\n/.exec(response.request().postData() ?? "")?.[1];

  // Changed here while the server cannot be reached (its uploads refused),
  // and meanwhile deleted by another client: the next sync drops the change.
  await page.route("**/dav-proxy/**", (route) =>
    route.request().method() === "PUT" ? route.abort() : route.continue(),
  );
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: "Gone elsewhere, 4:00 – 5:00 PM" })
    .click();
  await page
    .getByRole("dialog", { name: "Gone elsewhere" })
    .getByRole("button", { name: "Edit" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  await edit.getByRole("textbox", { name: "Title" }).fill("Renamed here");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toHaveCount(0);
  const deleted = await fetch(`${work}${uid}.ics`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${btoa(`${radicale.username}:${radicale.password}`)}` },
  });
  expect(deleted.status).toBeLessThan(300);
  await page.unroute("**/dav-proxy/**");

  // The accounts dialog tells it on the account's row…
  const dropped = "1 change was dropped: the server deleted its item";
  await page.getByRole("button", { name: /^Accounts/ }).click();
  const accounts = page.getByRole("dialog", { name: "Accounts" });
  await accounts.getByRole("button", { name: "Sync now" }).click();
  await expect(accounts.getByText(dropped)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(accounts).toHaveCount(0);
  // …and Settings, on the same row.
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Settings" })
      .getByRole("region", { name: "Accounts" })
      .getByText(dropped),
  ).toBeVisible();
});
