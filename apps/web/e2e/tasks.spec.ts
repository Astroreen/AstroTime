// The tasks screen on the demo data (design D52): its lists, completing and
// starring through the local store, the calendar following along.
import { expect, test, type Locator, type Page } from "@playwright/test";

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

  /** A real click on a tab's part that shows, `x` px in from its right edge: it scrolls nothing itself. */
  const clickShown = async (page: Page, tab: Locator, x = 12) => {
    const box = (await tab.boundingBox())!;
    await page.mouse.click(box.x + box.width - x, box.y + box.height / 2);
  };

  test("fades out on the side that hides tabs, and a tab chosen there is scrolled past the fade", async ({
    page,
  }) => {
    await openDemo(page, "week");
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    const panel = page.getByRole("region", { name: "Задачи" });
    const strip = panel.locator("[data-tab-strip]");
    const first = panel.getByRole("tab", { name: /^Задачи/ });
    const second = panel.getByRole("tab", { name: /^Личное/ });
    const fadesStart = /^linear-gradient\(to right, rgba\(0, 0, 0, 0\),.*, rgb\(0, 0, 0\)\)$/;
    const fadesEnd = /^linear-gradient\(to right, rgb\(0, 0, 0\),.*rgba\(0, 0, 0, 0\)\)$/;
    // "+ Создать список" goes past the 360 px panel: the end fades, the start does not.
    await expect(strip).toHaveCSS("mask-image", fadesEnd);

    // Scrolled to the end, the open first tab is under the start's fade.
    await second.click();
    await expect(second).toHaveAttribute("aria-selected", "true");
    await strip.evaluate((element) => element.scrollTo({ left: element.scrollWidth }));
    await expect(strip).toHaveCSS("mask-image", fadesStart);
    const under = await first.evaluate((tab) => {
      const room = tab.closest("[data-tab-strip]")!.getBoundingClientRect();
      return tab.getBoundingClientRect().left < room.left + 40;
    });
    expect(under).toBe(true);

    // Clicked there on its part that shows, it is scrolled back past the
    // fade: the strip at its start, which then fades no more.
    await clickShown(page, first);
    await expect(first).toHaveAttribute("aria-selected", "true");
    await expect(strip).toHaveCSS("mask-image", fadesEnd);
    const clear = await first.evaluate((tab) => {
      const room = tab.closest("[data-tab-strip]")!.getBoundingClientRect();
      const { left, right } = tab.getBoundingClientRect();
      return left >= room.left && right <= room.right - 40;
    });
    expect(clear).toBe(true);
  });

  test("a tab reached by the keyboard is scrolled clear of the fade", async ({ page }) => {
    await openDemo(page, "week");
    // Wider tabs, so the second one sits under the end's fade at the start.
    await page.addStyleTag({ content: "[data-tab-strip] [role=tab] { padding-inline: 60px; }" });
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    const panel = page.getByRole("region", { name: "Задачи" });
    const second = panel.getByRole("tab", { name: /^Личное/ });
    const edges = () =>
      second.evaluate((tab) => {
        const room = tab.closest("[data-tab-strip]")!.getBoundingClientRect();
        const { left, right } = tab.getBoundingClientRect();
        return { left: left - room.left, right: room.right - right };
      });
    expect((await edges()).right).toBeLessThan(40);
    // Tab to the open first tab, then the arrow to the second.
    await panel.getByRole("tab", { name: /^Задачи/ }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(second).toBeFocused();
    const { left, right } = await edges();
    expect(right).toBeGreaterThanOrEqual(40);
    expect(left).toBeGreaterThanOrEqual(40);
  });

  test("a mouse's press on a tab does not move the strip under the pointer before its click lands", async ({
    page,
  }) => {
    await openDemo(page, "week");
    await page.addStyleTag({ content: "[data-tab-strip] [role=tab] { padding-inline: 60px; }" });
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    const panel = page.getByRole("region", { name: "Задачи" });
    const strip = panel.locator("[data-tab-strip]");
    const second = panel.getByRole("tab", { name: /^Личное/ });
    // Pressed on its part under the end's fade, the second tab is focused by
    // the press, and the strip stays where it is until the click.
    const box = (await second.boundingBox())!;
    const room = (await strip.boundingBox())!;
    await page.mouse.move(room.x + room.width - 30, box.y + box.height / 2);
    await page.mouse.down();
    await expect(second).toBeFocused();
    expect(await strip.evaluate((element) => element.scrollLeft)).toBe(0);
    await page.mouse.up();
    // The click landed: the tab is chosen, and only now scrolled clear.
    await expect(second).toHaveAttribute("aria-selected", "true");
  });

  test("a resize brings the open tab back clear of the fade only if it was clear before", async ({
    page,
  }) => {
    await openDemo(page, "week");
    await page.getByRole("button", { name: "Задачи", exact: true }).click();
    const panel = page.getByRole("region", { name: "Задачи" });
    const strip = panel.locator("[data-tab-strip]");
    const second = panel.getByRole("tab", { name: /^Личное/ });
    const fromEnd = () =>
      second.evaluate((tab) => {
        const room = tab.closest("[data-tab-strip]")!.getBoundingClientRect();
        return room.right - tab.getBoundingClientRect().right;
      });
    // A style that resizes the tabs, applied once an observer of the test's
    // own has seen the tabs as they were; it resolves when that observer sees
    // them resized. The app's observer was made first, so it has run by then.
    const resized = (css: string) =>
      strip.evaluate(
        (element, rule) =>
          new Promise<void>((done) => {
            let seen = false;
            const observer = new ResizeObserver(() => {
              if (seen) {
                observer.disconnect();
                done();
                return;
              }
              seen = true;
              // Out of the observer's own loop, so the change is a new notification.
              requestAnimationFrame(() => {
                const style = document.createElement("style");
                style.textContent = rule;
                document.head.append(style);
              });
            });
            observer.observe(element.firstElementChild!);
          }),
        css,
      );
    const noStartFade = /^linear-gradient\(to right, rgb\(0, 0, 0\),/;
    // Chosen, the second tab is clear of the end's fade as the strip opens.
    await second.click();
    await expect(second).toHaveAttribute("aria-selected", "true");
    expect(await fromEnd()).toBeGreaterThanOrEqual(40);

    // The first tab grows (a count, a font): the open second, clear before, is brought clear again.
    await resized("[data-tab-strip] [role=tab]:first-child { padding-inline: 90px; }");
    expect(await fromEnd()).toBeGreaterThanOrEqual(40);
    expect(await strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

    // The user scrolls back to the start, the open tab under the end's fade:
    // a resize then leaves the strip where the user put it.
    await strip.evaluate((element) => element.scrollTo({ left: 0 }));
    await expect(strip).toHaveCSS("mask-image", noStartFade);
    expect(await fromEnd()).toBeLessThan(40);
    await resized("[data-tab-strip] [role=tab]:first-child { padding-inline: 110px; }");
    expect(await strip.evaluate((element) => element.scrollLeft)).toBe(0);
  });
});
