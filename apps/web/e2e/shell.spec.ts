// The app shell on a wide screen (design D227): the top bar's calendar |
// tasks switch shows one or the other, the tasks in the view's place.
import { expect, test, type Page } from "@playwright/test";

import { openDemo, WIDE } from "./support.ts";

test.use({ viewport: WIDE });

const switchTo = (page: Page) => page.getByRole("group", { name: "Calendar or tasks" });
const tasks = (page: Page) => page.getByRole("region", { name: "Tasks" });
const header = (page: Page, name: string) => page.getByRole("heading", { name });

test("the switch shows the calendar or the tasks; the period's controls and keys wait meanwhile", async ({
  page,
}) => {
  await openDemo(page, "week");
  const calendar = switchTo(page).getByRole("button", { name: "Calendar" });
  const tasksButton = switchTo(page).getByRole("button", { name: "Tasks" });
  await expect(calendar).toHaveAttribute("aria-pressed", "true");
  await expect(tasksButton).toHaveAttribute("aria-pressed", "false");
  await expect(header(page, "Wednesday, November 4")).toBeVisible();

  await tasksButton.click();
  await expect(tasksButton).toHaveAttribute("aria-pressed", "true");
  await expect(calendar).toHaveAttribute("aria-pressed", "false");
  await expect(tasks(page).getByRole("checkbox").first()).toBeVisible();
  // The calendar is not drawn, nor what moves it.
  await expect(page.getByRole("main")).toBeHidden();
  await expect(page.getByRole("button", { name: /^Today, / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Next week" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "November, choose a date" })).toHaveCount(0);
  // A step's keys move nothing unseen: back on the calendar, the same week.
  await page.keyboard.press("n");
  await page.keyboard.press("j");
  await calendar.click();
  await expect(tasks(page)).toHaveCount(0);
  await expect(header(page, "Wednesday, November 4")).toBeVisible();
  // On the calendar they step, as ever.
  await page.keyboard.press("n");
  await expect(header(page, "Sunday, November 8")).toBeVisible();
});

test("a view's key or a view picked in the sidebar brings the calendar back", async ({ page }) => {
  await openDemo(page, "week");
  const calendar = switchTo(page).getByRole("button", { name: "Calendar" });
  await switchTo(page).getByRole("button", { name: "Tasks" }).click();
  await expect(tasks(page)).toBeVisible();
  await page.keyboard.press("d");
  await expect(tasks(page)).toHaveCount(0);
  await expect(calendar).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("main")).toBeVisible();

  await switchTo(page).getByRole("button", { name: "Tasks" }).click();
  await expect(tasks(page)).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Week" })
    .click();
  await expect(tasks(page)).toHaveCount(0);
  await expect(header(page, "Wednesday, November 4")).toBeVisible();
  await expect(calendar).toHaveAttribute("aria-pressed", "true");
});
