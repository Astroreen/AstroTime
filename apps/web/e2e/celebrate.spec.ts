// A burst of shapes when the user completes a task (design D198): what is
// thrown is read from the calls to `Element.animate` on the burst's layer,
// logged as the page makes them, so nothing here waits for it to run or end.
import { expect, test, type Page } from "@playwright/test";

import { openDemo, WIDE } from "./support.ts";

/** Where each shape thrown since the last look started: its middle, and whether its layer is hidden from a screen reader. */
async function logBursts(page: Page) {
  await page.addInitScript(() => {
    const thrown: { x: number; y: number; hidden: boolean }[] = [];
    // Settles with the first shape thrown: the burst throws all of them in one go.
    let thrownOnce = () => {};
    const burst = new Promise<void>((resolve) => (thrownOnce = resolve));
    // The middle of the checkbox or button pressed, as it is at the press:
    // what the app measures there, before anything moves.
    const pressed: { x: number; y: number }[] = [];
    addEventListener(
      "click",
      (event) => {
        const target = (event.target as Element).closest('[role="checkbox"], button');
        if (!target) return;
        const { left, top, width, height } = target.getBoundingClientRect();
        pressed.push({ x: left + width / 2, y: top + height / 2 });
      },
      true,
    );
    Object.assign(window, { thrown, burst, pressed });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const layer = this.parentElement;
      if (layer?.hasAttribute("data-celebration")) {
        const { left, top, width, height } = (this as HTMLElement).style;
        thrown.push({
          x: parseFloat(left) + parseFloat(width) / 2,
          y: parseFloat(top) + parseFloat(height) / 2,
          hidden: layer.getAttribute("aria-hidden") === "true",
        });
        thrownOnce();
      }
      return animate.call(this, frames, options);
    };
  });
  return () =>
    page.evaluate(() =>
      (window as unknown as { thrown: { x: number; y: number; hidden: boolean }[] }).thrown.splice(
        0,
      ),
    );
}

/** Where the last press was, as the page measured it at the press. */
const pressedAt = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { pressed: { x: number; y: number }[] }).pressed.at(-1)!,
  );

/** The burst's code arrived: it is loaded with the first completion (D145). */
const loaded = (page: Page) =>
  page.evaluate(() =>
    performance.getEntriesByType("resource").some((entry) => entry.name.includes("celebrate")),
  );

async function openTasks(page: Page) {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const panel = page.getByRole("region", { name: "Tasks" });
  await panel.getByRole("tab", { name: /^Tasks/ }).click();
  return panel;
}

test("completing a task from its checkbox throws a burst from it; not completing it again does not", async ({
  page,
}) => {
  const thrown = await logBursts(page);
  const panel = await openTasks(page);
  expect(await loaded(page)).toBe(false);
  const box = panel.getByRole("checkbox", { name: "Send the report" });
  await box.click();
  await page.evaluate(() => (window as unknown as { burst: Promise<void> }).burst);
  const from = await pressedAt(page);
  const shapes = await thrown();
  // Every shape starts at the checkbox's middle, on a layer a screen reader does not see.
  expect(shapes.length).toBe(18);
  for (const { x, y, hidden } of shapes) {
    expect(Math.abs(x - from.x)).toBeLessThan(1);
    expect(Math.abs(y - from.y)).toBeLessThan(1);
    expect(hidden).toBe(true);
  }

  await panel.getByRole("button", { name: /^Completed/ }).click();
  await panel
    .getByRole("list", { name: "Completed tasks" })
    .getByRole("checkbox", { name: "Send the report" })
    .click();
  await expect(
    panel
      .getByRole("list", { name: "Tasks", exact: true })
      .getByRole("checkbox", { name: "Send the report" }),
  ).not.toBeChecked();
  expect(await thrown()).toEqual([]);
});

test("a shape that lands before the others is gone, not back at the start while they fly", async ({
  page,
}) => {
  await logBursts(page);
  const panel = await openTasks(page);
  await panel.getByRole("checkbox", { name: "Send the report" }).click();
  await page.evaluate(() => (window as unknown as { burst: Promise<void> }).burst);
  const left = await page.evaluate(async () => {
    const pieces = [...document.querySelectorAll<HTMLElement>("[data-celebration] > span")];
    // The others held mid-flight; the first run to its end.
    for (const piece of pieces.slice(1)) for (const flight of piece.getAnimations()) flight.pause();
    const [first] = pieces[0]!.getAnimations();
    first!.finish();
    await first!.finished;
    // Its removal follows its end in a microtask.
    await Promise.resolve();
    return {
      landed: pieces[0]!.isConnected,
      flying: pieces.slice(1).filter((piece) => piece.isConnected).length,
    };
  });
  expect(left).toEqual({ landed: false, flying: 17 });
});

test("a burst whose code comes late starts where the press was, though the row has moved on", async ({
  page,
}) => {
  const thrown = await logBursts(page);
  // The burst's code held back until the row has left.
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/celebrate/, async (route) => {
    await held;
    await route.continue();
  });
  const panel = await openTasks(page);
  const box = panel.getByRole("checkbox", { name: "Send the report" });
  await box.click();
  const from = await pressedAt(page);
  await expect(panel.getByRole("button", { name: "Completed (4)" })).toBeVisible();
  await expect(box).toHaveCount(0);
  // Its row gone from the motion layer too: nothing is left where it was pressed.
  await expect(page.locator("[data-motion-layer] [data-task]")).toHaveCount(0);
  release();
  await page.evaluate(() => (window as unknown as { burst: Promise<void> }).burst);
  const shapes = await thrown();
  expect(shapes.length).toBe(18);
  for (const { x, y } of shapes) {
    expect(Math.abs(x - from.x)).toBeLessThan(1);
    expect(Math.abs(y - from.y)).toBeLessThan(1);
  }
});

test("Mark completed in a task's details throws a burst from the button", async ({ page }) => {
  const thrown = await logBursts(page);
  await openTasks(page);
  await page
    .getByRole("region", { name: "Tasks" })
    .getByRole("button", { name: "Send the report", exact: true })
    .click();
  const details = page.getByRole("dialog", { name: "Send the report" });
  await details.getByRole("button", { name: "Mark completed" }).click();
  await expect(details.getByRole("button", { name: "Mark not completed" })).toBeVisible();
  await page.evaluate(() => (window as unknown as { burst: Promise<void> }).burst);
  expect((await thrown()).length).toBe(18);
  await details.getByRole("button", { name: "Mark not completed" }).click();
  await expect(details.getByRole("button", { name: "Mark completed" })).toBeVisible();
  expect(await thrown()).toEqual([]);
});

test("turned off in Settings, completing a task throws nothing, and its code is not loaded", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("astrotime.settings", JSON.stringify({ celebrate: false })),
  );
  const thrown = await logBursts(page);
  const panel = await openTasks(page);
  await panel.getByRole("checkbox", { name: "Send the report" }).click();
  await expect(panel.getByRole("button", { name: "Completed (4)" })).toBeVisible();
  expect(await thrown()).toEqual([]);
  expect(await loaded(page)).toBe(false);
});

test("asked for less motion, completing a task throws nothing", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const thrown = await logBursts(page);
  const panel = await openTasks(page);
  await panel.getByRole("checkbox", { name: "Send the report" }).click();
  await expect(panel.getByRole("button", { name: "Completed (4)" })).toBeVisible();
  expect(await thrown()).toEqual([]);
  expect(await loaded(page)).toBe(false);
});
