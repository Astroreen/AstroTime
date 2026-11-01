// Search (design D53): titles in the local store, case- and
// diacritics-insensitive; a result jumps to its day or opens its task.
import { expect, test } from "@playwright/test";

import { openDemo, PHONE } from "./support.ts";

test.use({ viewport: PHONE });

test("a title found jumps the calendar to its day and marks the item", async ({ page }) => {
  await openDemo(page, "day");
  await page.getByRole("button", { name: "Search" }).click();
  const field = page.getByRole("searchbox", { name: "Search" });
  await expect(field).toBeFocused();
  await field.fill("DENTIST");
  const results = page.getByRole("list", { name: "Search results" });
  await results.getByRole("button", { name: "Dentist, Tomorrow, 3:00 – 4:00 PM" }).click();
  await expect(field).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Thursday, November 5" })).toBeVisible();
  const dentist = page
    .getByRole("list", { name: "Thursday, November 5" })
    .getByRole("listitem", { name: /^Dentist, / });
  await expect(dentist).toBeInViewport();
  await expect(dentist).toHaveAttribute("data-found", "true");
});

test("an undated task found opens on the tasks screen", async ({ page }) => {
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("searchbox", { name: "Search" }).fill("library");
  await page
    .getByRole("list", { name: "Search results" })
    .getByRole("button", { name: "Return the library books, No date" })
    .click();
  const panel = page.getByRole("region", { name: "Tasks" });
  await expect(panel.getByRole("tab", { name: /^Tasks/ })).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByRole("listitem", { name: "Return the library books" })).toHaveAttribute(
    "data-found",
    "true",
  );
});

test.describe("in Russian", () => {
  test.use({ locale: "ru-RU" });

  test("finds a Russian title whatever its case and its ё", async ({ page }) => {
    await openDemo(page, "week");
    await page.getByRole("button", { name: "Поиск" }).click();
    await page.getByRole("searchbox", { name: "Поиск" }).fill("ОТЧЕТ");
    await page
      .getByRole("list", { name: "Результаты поиска" })
      .getByRole("button", { name: "Отправить отчёт, Сегодня, 15:00" })
      .click();
    await expect(
      page
        .getByRole("list", { name: "среда, 4 ноября" })
        .getByRole("listitem", { name: "Задача: Отправить отчёт, 15:00" }),
    ).toHaveAttribute("data-found", "true");
  });

  test("nothing found says so", async ({ page }) => {
    await openDemo(page, "week");
    await page.getByRole("button", { name: "Поиск" }).click();
    await page.getByRole("searchbox", { name: "Поиск" }).fill("несуществующее");
    await expect(page.getByText("Ничего не найдено")).toBeVisible();
  });
});
