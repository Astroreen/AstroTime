// The item the edit dialog makes, drawn in the views behind it as its form
// says now (design D155). Behind a modal dialog the views are hidden from
// the accessibility tree, so the draft is found by its mark, `data-draft`.
import { expect, test, type Page } from "@playwright/test";

import { choose, openDemo, PHONE, WIDE } from "./support.ts";

const draft = (page: Page) => page.locator("main [data-draft]");
const inDay = (page: Page, day: string) =>
  page.locator(`main [role=list][aria-label="${day}"] [data-draft]`);

test.describe("on a wide screen", () => {
  test.use({ viewport: WIDE });

  test("a new event is drawn where its form puts it, follows the form, and goes with the dialog", async ({
    page,
  }) => {
    await openDemo(page, "week");
    await expect(page.getByRole("list", { name: "Wednesday, November 4" })).toBeVisible();
    await page.getByRole("button", { name: "Create" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await expect(dialog).toBeVisible();
    // From the next half hour on the day shown, untitled.
    await expect(inDay(page, "Wednesday, November 4")).toHaveAttribute(
      "aria-label",
      "(No title), 11:00 AM – 12:00 PM",
    );
    await dialog.getByRole("textbox", { name: "Title" }).fill("Planning with Olga");
    await choose(dialog.getByLabel("Start time"), "4:00 PM");
    await expect(inDay(page, "Wednesday, November 4")).toHaveAttribute(
      "aria-label",
      "Planning with Olga, 4:00 – 5:00 PM",
    );
    // All day: in the strip.
    await dialog.getByRole("switch", { name: "All day" }).click();
    await expect(
      page.locator('main [role=list][aria-label="All day"] [data-draft]'),
    ).toHaveAttribute("aria-label", "Planning with Olga, All day");
    // The dialog stands aside of it, so both show.
    const drawn = (await draft(page).boundingBox())!;
    const box = (await dialog.boundingBox())!;
    expect(box.x + box.width <= drawn.x || drawn.x + drawn.width <= box.x).toBe(true);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(draft(page)).toHaveCount(0);
  });

  test("an edited event is drawn at its new place instead of its old one, until the dialog goes", async ({
    page,
  }) => {
    await openDemo(page, "week");
    const wednesday = page.getByRole("list", { name: "Wednesday, November 4" });
    await wednesday.getByRole("button", { name: "Lunch with Marta, 1:00 – 2:00 PM" }).click();
    await page
      .getByRole("dialog", { name: "Lunch with Marta" })
      .getByRole("button", { name: "Edit" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Edit event" });
    await choose(dialog.getByLabel("Start time"), "4:30 PM");
    await expect(inDay(page, "Wednesday, November 4")).toHaveAttribute(
      "aria-label",
      "Lunch with Marta, 4:30 – 5:30 PM",
    );
    // Its old place is empty: one Lunch with Marta in the day.
    await expect(page.locator('main [role=listitem][aria-label^="Lunch with Marta"]')).toHaveCount(
      1,
    );
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(draft(page)).toHaveCount(0);
    await expect(
      page.locator('main [role=listitem][aria-label="Lunch with Marta, 1:00 – 2:00 PM"]'),
    ).toBeVisible();
  });

  test("a task made from the form is drawn as a task, in the Month too", async ({ page }) => {
    await openDemo(page, "month");
    await expect(page.locator('[data-view="month"]')).toBeVisible();
    await page.getByRole("button", { name: "Create" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("radio", { name: "Task" }).click();
    await page
      .getByRole("dialog", { name: "New task" })
      .getByRole("textbox", { name: "Title" })
      .fill("Call the bank");
    // On a day with room for it: today's tile is full, its chips past "+N".
    await page
      .getByRole("dialog", { name: "New task" })
      .getByLabel("Start date")
      .fill("2026-11-10");
    await expect(draft(page)).toHaveAttribute("aria-label", /^Task: Call the bank, /);
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE });

  test("the draft is drawn behind the full-screen dialog too", async ({ page }) => {
    await openDemo(page, "day");
    await expect(page.getByRole("list", { name: "Wednesday, November 4" })).toBeVisible();
    await page.getByRole("button", { name: "Create" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("textbox", { name: "Title" }).fill("Dentist");
    await expect(inDay(page, "Wednesday, November 4")).toHaveAttribute(
      "aria-label",
      "Dentist, 11:00 AM – 12:00 PM",
    );
  });
});
