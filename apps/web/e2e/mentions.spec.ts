// Mentions in a description (docs/plans/design.md#D208) against a real
// Radicale: "@" asks the account's server for people with RFC 3744's
// principal search. Radicale finds nobody; Nextcloud's answer, recorded in
// its shape (packages/caldav/test/fixtures), is served for that one report
// to see a person offered and picked.
import { readFileSync } from "node:fs";

import { test as base, expect, type Page } from "@playwright/test";

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

const PEOPLE = readFileSync(
  new URL(
    "../../../packages/caldav/test/fixtures/nextcloud-principal-search-people.xml",
    import.meta.url,
  ),
  "utf8",
);

async function signedIn(page: Page, radicale: CalDavServer) {
  await radicale.mkcalendar("work");
  await openApp(page);
  const signIn = await addAccount(page, "caldav");
  await signIn.getByRole("textbox", { name: "Server address" }).fill(radicale.url);
  await signIn.getByRole("textbox", { name: "User name" }).fill(radicale.username);
  await signIn.getByLabel("Password").fill(radicale.password);
  await signIn.getByRole("button", { name: "Sign in" }).click();
  await expect(signIn).toHaveCount(0);
  const account = page.getByRole("region", { name: `astro@${new URL(radicale.url).host}` });
  await expect(account.getByText(/^Synced at /)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Create" }).click();
  return page.getByRole("dialog", { name: "New event" });
}

const isSearch = (method: string, body: string | null) =>
  method === "REPORT" && (body ?? "").includes("principal-property-search");

test("typing @ offers the server's people; a pick writes a mailto link (design D208)", async ({
  page,
  radicale,
}) => {
  const asked: string[] = [];
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!isSearch(request.method(), request.postData())) return route.fallback();
    asked.push(/<d:match>([^<]*)<\/d:match>/.exec(request.postData()!)![1]!);
    await route.fulfill({
      status: 207,
      contentType: "application/xml; charset=utf-8",
      body: PEOPLE,
    });
  });
  const dialog = await signedIn(page, radicale);
  const description = dialog.getByRole("textbox", { name: "Description" });
  await description.pressSequentially("Agenda by @ann");
  const people = dialog.getByRole("listbox", { name: "People" });
  // Nextcloud's users; its group and room are no one to mention.
  await expect(people.getByRole("option")).toHaveText([
    "Anna Berganna@example.com",
    "Annika Lindannika@example.com",
  ]);
  await description.press("ArrowDown");
  await expect(people.getByRole("option", { name: /Annika Lind/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await description.press("ArrowUp");
  await description.press("Enter");
  await expect(people).toHaveCount(0);
  await description.pressSequentially("and the slides.");
  await expect(description).toHaveValue(
    "Agenda by [@Anna Berg](mailto:anna@example.com) and the slides.",
  );
  // Asked once typing rested, not for every letter.
  expect(asked).toEqual(["ann"]);
  await dialog.getByRole("textbox", { name: "Title" }).fill("Planning");
  // Escape closes the list, not the dialog.
  await description.pressSequentially(" @an");
  await expect(people.getByRole("option")).toHaveCount(2);
  await description.press("Escape");
  await expect(people).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // Saved, the details show the mention as a chip; a tap shows the e-mail.
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Planning, / })
    .click();
  const details = page.getByRole("dialog", { name: "Planning" });
  const chip = details.getByRole("button", { name: "@Anna Berg" });
  await expect(chip).toHaveAttribute("aria-expanded", "false");
  await chip.click();
  await expect(chip).toHaveAttribute("aria-expanded", "true");
  await expect(details.getByRole("link", { name: "anna@example.com" })).toHaveAttribute(
    "href",
    "mailto:anna@example.com",
  );
});

test("Radicale finds nobody: no list, and the text is what was typed", async ({
  page,
  radicale,
}) => {
  const dialog = await signedIn(page, radicale);
  const description = dialog.getByRole("textbox", { name: "Description" });
  const searched = page.waitForResponse((response) =>
    isSearch(response.request().method(), response.request().postData()),
  );
  await description.pressSequentially("Ask @astro");
  expect((await searched).status()).toBe(207);
  await expect(dialog.getByRole("listbox", { name: "People" })).toHaveCount(0);
  await expect(description).toHaveValue("Ask @astro");
});
