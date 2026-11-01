// The tasks screen on the demo data (design D52): its lists, completing and
// starring through the local store, the calendar following along.
import { expect, test, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const tasks = (page: Page) => page.getByRole("region", { name: "Tasks" });

test("the tasks panel beside the calendar: lists, counts, completing and starring", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tasks", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const panel = tasks(page);
  // A tab per list of tasks, with its undone tasks counted; Work holds only events.
  await expect(panel.getByRole("tab")).toHaveCount(2);
  await expect(panel.getByRole("tab", { name: "Personal, 2 undone tasks" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await panel.getByRole("tab", { name: "Tasks, 7 undone tasks" }).click();
  const list = panel.getByRole("list", { name: "Tasks" });
  const report = panel.getByRole("checkbox", { name: "Send the report" });
  await expect(list.getByRole("checkbox", { name: "Send the report" })).not.toBeChecked();
  // A subtask sits under its parent (RELATED-TO).
  await expect(
    list
      .getByRole("listitem", { name: "Write the proposal" })
      .getByRole("listitem", { name: "Collect the figures" }),
  ).toBeVisible();
  const chip = page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("listitem", { name: /Send the report, 3:00 PM$/ });
  await expect(chip).toHaveAccessibleName("Task: Send the report, 3:00 PM");

  // Completed: it moves to "Completed", the count drops, the calendar strikes it through.
  await report.click();
  await expect(panel.getByRole("tab", { name: "Tasks, 6 undone tasks" })).toBeVisible();
  await expect(list.getByRole("checkbox", { name: "Send the report" })).toHaveCount(0);
  await expect(chip).toHaveAccessibleName("Completed task: Send the report, 3:00 PM");
  await panel.getByRole("button", { name: "Completed (4)" }).click();
  const completed = panel.getByRole("list", { name: "Completed tasks" });
  await expect(completed.getByRole("checkbox", { name: "Send the report" })).toBeChecked();

  // Not completed again: back in the list.
  await completed.getByRole("checkbox", { name: "Send the report" }).click();
  await expect(list.getByRole("checkbox", { name: "Send the report" })).not.toBeChecked();
  await expect(panel.getByRole("button", { name: "Completed (3)" })).toBeVisible();
  await expect(panel.getByRole("tab", { name: "Tasks, 7 undone tasks" })).toBeVisible();
  await expect(chip).toHaveAccessibleName("Task: Send the report, 3:00 PM");

  // Starred, and sorted with the starred first.
  const star = panel.getByRole("button", { name: "Star: Write the proposal" });
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await panel.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("menuitemradio", { name: "Starred first" }).click();
  await expect(list.getByRole("checkbox").first()).toHaveAccessibleName("Return the library books");
  await expect(list.getByRole("checkbox").nth(1)).toHaveAccessibleName("Write the proposal");

  // What was written is in the store: a new load without the demo shows it.
  await page.goto("/");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(
    tasks(page).getByRole("button", { name: "Star: Write the proposal" }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("a series is completed one occurrence at a time, the earliest first", async ({ page }) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const panel = tasks(page);
  await panel.getByRole("tab", { name: /^Tasks/ }).click();
  const recycling = panel.getByRole("listitem", { name: "Take out the recycling" });
  await expect(recycling).toContainText("Sun, Oct 25");
  await recycling.getByRole("checkbox").click();
  await expect(recycling).toContainText("Sun, Nov 1");
  await expect(panel.getByRole("button", { name: "Completed (3)" })).toBeVisible();
  // Its latest occurrence before today is still undone: still counted on today.
  const strip = page.getByRole("list", { name: "All day" });
  await expect(strip.getByRole("button", { name: "3 undone tasks" })).toBeVisible();
  await recycling.getByRole("checkbox").click();
  await expect(recycling).toContainText("Sun, Nov 8");
  await expect(strip.getByRole("button", { name: "2 undone tasks" })).toBeVisible();
});

test("on a phone the tasks are a screen of their own; back returns to the calendar", async ({
  page,
}) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "day");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect(tasks(page).getByRole("heading", { name: "Tasks", level: 1 })).toBeVisible();
  // The calendar underneath is out of reach while the screen is open.
  await expect(page.getByRole("main")).toHaveCount(0);
  await tasks(page).getByRole("button", { name: "Back to the calendar" }).click();
  await expect(tasks(page)).toHaveCount(0);
  await expect(page.getByRole("main", { name: "November" })).toBeVisible();
});

test.describe("in Russian", () => {
  test.use({ locale: "ru-RU", viewport: PHONE });

  test("the lists and their counts speak Russian", async ({ page }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    const panel = page.getByRole("region", { name: "Задачи" });
    // Lists in their names' order: "Задачи" comes first in Russian.
    await expect(panel.getByRole("tab", { name: "Задачи, 7 невыполненных задач" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel.getByRole("tab", { name: "Личное, 2 невыполненные задачи" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Выполненные (3)" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Пометить: Отправить отчёт" })).toBeVisible();
  });
});

test.describe("the tab strip wider than the panel (design D135)", () => {
  test.use({ locale: "ru-RU", viewport: WIDE });

  test("fades out on the side that hides tabs, and the open list's tab is scrolled into view", async ({
    page,
  }) => {
    await openDemo(page, "week");
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    const panel = page.getByRole("region", { name: "Задачи" });
    const strip = panel.getByRole("tablist").locator("..");
    // "+ Создать список" goes past the 360 px panel: the end fades, the start does not.
    await expect(strip).toHaveCSS(
      "mask-image",
      /^linear-gradient\(to right, rgb\(0, 0, 0\),.*rgba\(0, 0, 0, 0\)\)$/,
    );
    await strip.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
    await expect(strip).toHaveCSS(
      "mask-image",
      /^linear-gradient\(to right, rgba\(0, 0, 0, 0\),.*, rgb\(0, 0, 0\)\)$/,
    );
    // Back at the start, the open list's tab comes into view when it is chosen.
    await strip.evaluate((element) => element.scrollTo({ left: 0 }));
    await panel.getByRole("tab", { name: /^Личное/ }).click();
    await expect(panel.getByRole("tab", { name: /^Личное/ })).toBeInViewport({ ratio: 1 });
  });
});
