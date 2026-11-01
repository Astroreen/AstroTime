// The drawer's settings (design D53): each applies at once and is kept.
import { expect, test, type Page } from "@playwright/test";

import { openDemo, WIDE } from "./support.ts";

const header = (page: Page, name: string) => page.getByRole("heading", { name });
const day = (page: Page, name: string) => page.getByRole("list", { name });

test("theme, week start, clock, hide completed and language apply at once and are kept", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  const body = page.locator("body");
  await expect(body).toHaveCSS("background-color", "rgb(27, 29, 35)");

  // The theme overrides the system's (D44, D58).
  await page.getByLabel("Theme").selectOption({ label: "Light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(body).toHaveCSS("background-color", "rgb(238, 240, 244)");

  // The week starts on Monday instead of the locale's Sunday (D45).
  await expect(header(page, "Sunday, November 1")).toBeVisible();
  await page.getByLabel("Start of the week").selectOption({ label: "Monday" });
  await expect(header(page, "Sunday, November 1")).toHaveCount(0);
  await expect(header(page, "Monday, November 2")).toBeVisible();
  await expect(header(page, "Sunday, November 8")).toBeVisible();

  // The clock: 24 hours instead of the locale's 12.
  const report = day(page, "Wednesday, November 4").getByRole("listitem", {
    name: /^Task: Send the report/,
  });
  await expect(report).toHaveAccessibleName("Task: Send the report, 3:00 PM");
  await page.getByLabel("Clock").selectOption({ label: "24-hour" });
  await expect(report).toHaveAccessibleName("Task: Send the report, 15:00");

  // Hide completed: completed tasks' chips go from every view; the undone chip stays (D51).
  const strip = page.getByRole("list", { name: "All day" });
  const desk = strip.getByRole("listitem", { name: "Completed task: Tidy the desk, All day" });
  await expect(desk).toBeVisible();
  await page.getByRole("switch", { name: "Hide completed tasks" }).click();
  await expect(desk).toHaveCount(0);
  await expect(strip.getByRole("button", { name: "3 undone tasks" })).toBeVisible();

  // The language: Russian, with the week start and clock still as chosen.
  await page.getByLabel("Language").selectOption({ label: "Русский" });
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await expect(page.getByRole("main", { name: "Ноябрь" })).toBeVisible();
  await expect(header(page, "понедельник, 2 ноября")).toBeVisible();

  // Kept on this device.
  await page.reload();
  await expect(page.getByLabel("Тема")).toHaveValue("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(header(page, "понедельник, 2 ноября")).toBeVisible();
  await expect(page.getByRole("switch", { name: "Скрывать выполненные задачи" })).toBeChecked();
  // The demo data is titled in the browser's language; the UI speaks the chosen one.
  await expect(
    day(page, "среда, 4 ноября").getByRole("listitem", { name: "Задача: Send the report, 15:00" }),
  ).toBeVisible();
});
