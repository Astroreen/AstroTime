// Quick create (design D296) on the demo data with the clock frozen: an
// event and a task made through it on a phone and a wide screen, Enter
// saves, Escape closes, and the sheet dragged up (or the popover's expand
// icon) becomes the edit dialog with what was filled carried over.
import { expect, test, type Page } from "@playwright/test";

import { choose, openDemo, PHONE, quickCreate, WIDE } from "./support.ts";

const day = (page: Page, name: string) => page.getByRole("list", { name });

for (const [size, viewport] of [
  ["phone", PHONE],
  ["wide", WIDE],
] as const) {
  test.describe(`on a ${size}`, () => {
    test.use({ viewport, ...(size === "phone" ? { hasTouch: true } : {}) });

    test("makes an event, Enter saving it", async ({ page }) => {
      await openDemo(page, size === "phone" ? "day" : "week");
      await page.getByRole("button", { name: "Create" }).first().click();
      const quick = quickCreate(page);
      // Google's prefill, as the editor's: today from the next half hour, an hour long.
      await expect(quick.getByLabel("Start date")).toHaveValue("2026-11-04");
      await expect(quick.getByLabel("Start time")).toHaveText("11:00 AM");
      await expect(quick.getByLabel("End time")).toHaveText("12:00 PM");
      await expect(quick.getByRole("radio", { name: "Event" })).toBeChecked();
      // No "More options": the sheet's handle, or the popover's icon, expands it.
      await expect(quick.getByRole("button", { name: "More options" })).toHaveCount(0);
      const title = quick.getByRole("textbox", { name: "Title" });
      await expect(title).toBeFocused();
      await title.fill("Haircut");
      // The item is drawn behind it as it is filled (design D155).
      await expect(page.locator("main [data-draft]").first()).toHaveAttribute(
        "aria-label",
        /^Haircut, /,
      );
      await title.press("Enter");
      await expect(quick).toHaveCount(0);
      await expect(
        day(page, "Wednesday, November 4").getByRole("listitem", {
          name: "Haircut, 11:00 AM – 12:00 PM",
        }),
      ).toBeVisible();
    });

    test("makes a task in its list", async ({ page }) => {
      await openDemo(page, size === "phone" ? "day" : "week");
      await page.getByRole("button", { name: "Create" }).first().click();
      const quick = quickCreate(page);
      await quick.getByRole("radio", { name: "Task" }).click();
      // A task has a time, no end, and goes in a list.
      await expect(quick.getByLabel("End time")).toHaveCount(0);
      await choose(quick.getByRole("combobox", { name: "List" }), "Tasks");
      await quick.getByRole("textbox", { name: "Title" }).fill("Call the plumber");
      await quick.getByRole("button", { name: "Save" }).click();
      await expect(quick).toHaveCount(0);
      await expect(
        day(page, "Wednesday, November 4").getByRole("listitem", {
          name: /^Task: Call the plumber, /,
        }),
      ).toBeVisible();
    });

    test("Escape closes it and saves nothing", async ({ page }) => {
      await openDemo(page, size === "phone" ? "day" : "week");
      await page.getByRole("button", { name: "Create" }).first().click();
      const quick = quickCreate(page);
      await quick.getByRole("textbox", { name: "Title" }).fill("Not this one");
      await page.keyboard.press("Escape");
      await expect(quick).toHaveCount(0);
      await expect(page.getByRole("listitem", { name: /^Not this one, / })).toHaveCount(0);
      await expect(page.locator("main [data-draft]")).toHaveCount(0);
    });
  });
}

test.describe("on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true });

  test("the sheet dragged up becomes the edit dialog, everything filled carried over", async ({
    page,
  }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Create" }).click();
    const quick = quickCreate(page);
    await quick.getByRole("textbox", { name: "Title" }).fill("Swimming");
    await choose(quick.getByLabel("Start time"), "5:00 PM");
    await quick.getByRole("combobox", { name: "Location" }).fill("City pool");
    await choose(quick.getByRole("combobox", { name: "Calendar" }), "Work");
    // A sheet from the bottom over the view.
    const sheet = (await quick.boundingBox())!;
    expect(Math.round(sheet.y + sheet.height)).toBe(PHONE.height);
    expect(Math.round(sheet.width)).toBe(PHONE.width);

    // The handle dragged up by a finger's pointer.
    const handle = (await quick.getByRole("button", { name: "Expand" }).boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 30);
    await page.mouse.move(x, y - 120);
    await page.mouse.up();

    await expect(quick).toHaveCount(0);
    const editor = page.getByRole("dialog", { name: "New event" });
    await expect(editor.getByRole("textbox", { name: "Title" })).toHaveValue("Swimming");
    await expect(editor.getByLabel("Start date")).toHaveValue("2026-11-04");
    await expect(editor.getByLabel("Start time")).toHaveText("5:00 PM");
    await expect(editor.getByLabel("End time")).toHaveText("6:00 PM");
    await expect(editor.getByRole("combobox", { name: "Location" })).toHaveValue("City pool");
    await expect(editor.getByRole("combobox", { name: "Calendar" })).toHaveText("Work");
    // What only the editor has is there now.
    await expect(editor.getByRole("switch", { name: "All day" })).toBeVisible();
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toHaveCount(0);
    await expect(
      day(page, "Wednesday, November 4").getByRole("listitem", {
        name: /^Swimming, 5:00 – 6:00 PM/,
      }),
    ).toBeVisible();
  });

  test("the handle is a button: Enter on it expands; a tap beside a titled one keeps it", async ({
    page,
  }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Create" }).click();
    const quick = quickCreate(page);
    await quick.getByRole("textbox", { name: "Title" }).fill("Keep me");
    // The dimmed view above the sheet: nothing typed is lost to a stray tap.
    await page.mouse.click(PHONE.width / 2, 40);
    await expect(quick).toBeVisible();
    await quick.getByRole("button", { name: "Expand" }).focus();
    await page.keyboard.press("Enter");
    await expect(quick).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "New event" }).getByRole("textbox", { name: "Title" }),
    ).toHaveValue("Keep me");
  });

  test("a short drag springs back; dragged down it closes", async ({ page }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Create" }).click();
    const quick = quickCreate(page);
    await expect(page.locator("[data-starting-style]")).toHaveCount(0);
    const rest = await quick.evaluate((sheet) => getComputedStyle(sheet).translate);
    const handle = (await quick.getByRole("button", { name: "Expand" }).boundingBox())!;
    const x = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 20);
    await page.mouse.up();
    await expect(page.getByRole("dialog", { name: "New event" })).toHaveCount(0);
    // Back where it rests, not expanded.
    await expect(quick).toHaveCSS("translate", rest);
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 60);
    await page.mouse.move(x, y + 200);
    await page.mouse.up();
    await expect(quick).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});

test.describe("on a wide screen", () => {
  test.use({ viewport: WIDE });

  test("a slot opens a popover beside its draft, and its corner's icon expands it", async ({
    page,
  }) => {
    await openDemo(page, "week");
    const thursday = day(page, "Thursday, November 5");
    const box = (await thursday.boundingBox())!;
    // 2:15 PM in a 56-pixel hour: the half hour from 2:00.
    await thursday.click({ position: { x: box.width - 10, y: 14.25 * 56 } });
    const quick = quickCreate(page);
    await expect(quick.getByLabel("Start time")).toHaveText("2:00 PM");
    await quick.getByRole("textbox", { name: "Title" }).fill("Review");
    // Beside its draft, not over it.
    const draft = (await page.locator("main [data-draft]").first().boundingBox())!;
    const popover = (await quick.boundingBox())!;
    expect(popover.x >= draft.x + draft.width || popover.x + popover.width <= draft.x).toBe(true);
    expect(popover.width).toBeLessThan(WIDE.width / 2);

    await quick.getByRole("button", { name: "Expand" }).click();
    await expect(quick).toHaveCount(0);
    const editor = page.getByRole("dialog", { name: "New event" });
    await expect(editor.getByRole("textbox", { name: "Title" })).toHaveValue("Review");
    await expect(editor.getByLabel("Start date")).toHaveValue("2026-11-05");
    await expect(editor.getByLabel("Start time")).toHaveText("2:00 PM");
    await expect(editor.getByRole("combobox", { name: "Calendar" })).toHaveText("Personal");
  });
});
