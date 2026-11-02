// The pictures (docs/plans/design.md#D215–D217): an item whose title has a
// theme's word is drawn over its picture in the Agenda and in its details;
// the others are as they were; Settings → Pictures turns them off.
import { expect, test, type Locator } from "@playwright/test";

import { openDemo } from "./support.ts";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** Whether a picture arrived and was decoded. */
const loaded = (picture: Locator) =>
  picture.evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth > 0));

test("a lunch is drawn over its picture in the Agenda and its details; a stand-up is not (D215, D216)", async ({
  page,
}) => {
  await openDemo(page, "agenda");
  const lunch = page.getByRole("listitem", { name: /^Lunch with Marta/ });
  await lunch.scrollIntoViewIfNeeded();
  const picture = lunch.locator("img");
  await expect(picture).toHaveAttribute("src", /meal/);
  expect(await loaded(picture)).toBe(true);
  // Its height is the card's own, before the picture and after it (no shift).
  expect((await lunch.boundingBox())?.height).toBe(104);
  // An item with no theme's word is the plain card.
  const standUp = page.getByRole("listitem", { name: /^Stand-up/ }).first();
  await expect(standUp.locator("img")).toHaveCount(0);

  await lunch.getByRole("button").click();
  const details = page.getByRole("dialog", { name: "Lunch with Marta" });
  const header = details.locator(".details-picture img");
  await expect(header).toHaveAttribute("src", /meal/);
  expect(await loaded(header)).toBe(true);
  // The bar's buttons stay over it, and work.
  await details.getByRole("button", { name: "Close" }).click();
  await expect(details).toBeHidden();
});

test("with a large text the card grows and its title wraps, never clipped (D216)", async ({
  page,
}) => {
  await openDemo(page, "agenda");
  await page.addStyleTag({
    content: "html { font-size: 200%; } :root { --text-body: 28px; --text-note: 25px; }",
  });
  const lunch = page.getByRole("listitem", { name: /^Lunch with Marta/ });
  await lunch.scrollIntoViewIfNeeded();
  const fits = await lunch.evaluate((card) =>
    [...card.querySelectorAll<HTMLElement>(".picture-text > *")].every(
      (line) => line.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom,
    ),
  );
  expect(fits).toBe(true);
  expect((await lunch.boundingBox())!.height).toBeGreaterThan(104);
});

test("Settings → Pictures → Illustrations off: every card and the details are plain (D217)", async ({
  page,
}) => {
  await openDemo(page, "agenda");
  const lunch = page.getByRole("listitem", { name: /^Lunch with Marta/ });
  await expect(lunch.locator("img")).toHaveCount(1);

  // On a phone, Settings is the drawer's last row (D131).
  await page.getByRole("button", { name: "Main menu" }).click();
  await page
    .getByRole("dialog", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const toggle = settings.getByRole("switch", { name: "Illustrations by an item's title" });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await settings.getByRole("button", { name: "Close settings" }).click();

  await expect(lunch.locator("img")).toHaveCount(0);
  await lunch.getByRole("button").click();
  await expect(page.getByRole("dialog", { name: "Lunch with Marta" })).toBeVisible();
  await expect(page.locator(".details-picture")).toHaveCount(0);
});

test.describe("month banners", () => {
  for (const [zone, december] of [
    ["Europe/Vilnius", "month-12"],
    ["Australia/Sydney", "month-06"],
  ] as const) {
    test(`in ${zone}, December opens under ${december}'s banner (D218)`, async ({ browser }) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        timezoneId: zone,
      });
      const page = await context.newPage();
      await openDemo(page, "agenda");
      const heading = page.getByRole("heading", { name: "December", exact: true });
      await heading.scrollIntoViewIfNeeded();
      const banner = page.locator(".month-banner", { has: heading });
      await expect(banner.locator("img")).toHaveAttribute("src", new RegExp(december));
      expect(await loaded(banner.locator("img"))).toBe(true);
      expect((await banner.boundingBox())?.height).toBe(144);
      await context.close();
    });
  }
});
