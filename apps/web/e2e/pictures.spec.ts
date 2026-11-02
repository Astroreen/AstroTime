// The pictures (docs/plans/design.md#D215–D221): an item whose title has a
// subject's word is drawn over its picture in the Agenda and in its details,
// one with a place over its place's photo (Wikipedia faked); the others are
// as they were; Settings → Pictures turns them off.
import { readFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { openDemo } from "./support.ts";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

/** A photo: a 1×1 PNG. */
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

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

test.describe("a place's photo", () => {
  const fixture = (name: string) =>
    readFileSync(new URL(`../../../packages/ui/test/fixtures/${name}`, import.meta.url));

  /** Photon, Wikipedia and Wikimedia, faked; what Wikipedia was asked. */
  async function fakeServices(page: Page) {
    const asked: URL[] = [];
    await page.route("https://photon.komoot.io/api/**", (route) =>
      route.fulfill({ contentType: "application/json", body: fixture("photon-en.json") }),
    );
    await page.route("https://en.wikipedia.org/w/api.php**", (route) => {
      const url = new URL(route.request().url());
      asked.push(url);
      return route.fulfill({
        contentType: "application/json",
        body: fixture(
          url.searchParams.has("gsrsearch")
            ? "wikipedia-en-search.json"
            : "wikipedia-en-imageinfo.json",
        ),
      });
    });
    await page.route("https://thumb.wikimedia.org/**", (route) =>
      route.fulfill({ contentType: "image/png", body: PHOTO }),
    );
    return asked;
  }

  /** An event with no subject's word at a place picked from Location's search. */
  async function sightseeing(page: Page) {
    await page.getByRole("button", { name: "Create" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Sightseeing");
    await dialog.getByRole("combobox", { name: "Location" }).fill("Brandenburger");
    await page.getByRole("listbox", { name: "Places" }).getByRole("option").first().tap();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
  }

  test("an item with a place and no subject's word is drawn over its place's photo, credited in its details (D220, D221)", async ({
    page,
  }) => {
    const asked = await fakeServices(page);
    await openDemo(page, "agenda");
    await sightseeing(page);
    const card = page.getByRole("listitem", { name: /^Sightseeing/ });
    await expect(card.locator("img")).toHaveAttribute("src", /thumb\.wikimedia\.org/);
    expect(await loaded(card.locator("img"))).toBe(true);
    // The name and the point rounded to about 100 m, once.
    expect(asked.map((url) => url.searchParams.get("gsrsearch")).filter(Boolean)).toEqual([
      "brandenburger tor nearcoord:1km,52.517,13.381",
    ]);
    await card.getByRole("button").click();
    const details = page.getByRole("dialog", { name: "Sightseeing" });
    await expect(details.locator(".details-picture img")).toHaveAttribute("srcset", /500px/);
    await expect(
      details.getByRole("link", { name: "Thomas Wolf, www.foto-tw.de" }),
    ).toHaveAttribute(
      "href",
      "https://commons.wikimedia.org/wiki/File%3ABrandenburger_Tor_abends.jpg",
    );
    await expect(details.getByRole("link", { name: "CC BY-SA 3.0" })).toHaveAttribute(
      "href",
      "https://creativecommons.org/licenses/by-sa/3.0",
    );
    // Asked once, however many places show it.
    expect(asked.filter((url) => url.searchParams.has("gsrsearch"))).toHaveLength(1);
  });

  test("Settings → Pictures → Photos of places off: nothing is asked, the plain card (D221)", async ({
    page,
  }) => {
    const asked = await fakeServices(page);
    await openDemo(page, "agenda");
    await page.getByRole("button", { name: "Main menu" }).click();
    await page
      .getByRole("dialog", { name: "Main menu" })
      .getByRole("button", { name: "Settings" })
      .click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    const toggle = settings.getByRole("switch", { name: "Photos of places" });
    await expect(settings.getByText(/go to en\.wikipedia\.org for its photo/)).toBeVisible();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await settings.getByRole("button", { name: "Close settings" }).click();
    await sightseeing(page);
    const card = page.getByRole("listitem", { name: /^Sightseeing/ });
    await card.getByRole("button").click();
    await expect(page.getByRole("dialog", { name: "Sightseeing" })).toBeVisible();
    await expect(page.locator(".details-picture")).toHaveCount(0);
    await expect(card.locator("img")).toHaveCount(0);
    expect(asked).toEqual([]);
  });
});

test("a title edited to another subject draws the new picture, faded in once it comes (D216)", async ({
  page,
}) => {
  await openDemo(page, "agenda");
  const cinema = page.getByRole("listitem", { name: /^Cinema/ });
  await page.getByRole("button", { name: "Show earlier" }).click();
  await cinema.scrollIntoViewIfNeeded();
  await expect(cinema.locator("img")).toHaveAttribute("data-shown", "true");
  await cinema.getByRole("button").click();
  await page.getByRole("dialog", { name: "Cinema" }).getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  await edit.getByRole("textbox", { name: "Title" }).fill("Dinner");
  await edit.getByRole("button", { name: "Save" }).click();
  const dinner = page.getByRole("listitem", { name: /^Dinner/ });
  await expect(dinner.locator("img")).toHaveAttribute("src", /meal/);
  await expect(dinner.locator("img")).toHaveAttribute("data-shown", "true");
});
