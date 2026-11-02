// More motion (design D200): a star the user lights pops, and a task's
// details grow out of the press that opened them. Read from the elements'
// animations and styles, so nothing waits for them to run.
import { expect, test } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

test("a star lit by a press pops; one lit when the screen opened does not", async ({ page }) => {
  // Every CSS animation that starts, by its name and the star's name.
  await page.addInitScript(() => {
    const started: string[] = [];
    Object.assign(window, { started });
    addEventListener(
      "animationstart",
      (event) => {
        const star = (event.target as Element).closest("button")?.getAttribute("aria-label");
        started.push(`${event.animationName}: ${star ?? ""}`);
      },
      true,
    );
  });
  const started = () =>
    page.evaluate(() => (window as unknown as { started: string[] }).started.splice(0));
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const panel = page.getByRole("region", { name: "Tasks" });
  await panel.getByRole("tab", { name: /^Tasks/ }).click();
  await expect(
    panel.getByRole("button", { name: "Star: Return the library books" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect((await started()).filter((name) => name.startsWith("star-pop"))).toEqual([]);
  const star = panel.getByRole("button", { name: "Star: Send the report" });
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  const lit = await page.evaluate(
    () =>
      new Promise<string[]>((resolve) => {
        const list = (window as unknown as { started: string[] }).started;
        if (list.some((name) => name.startsWith("star-pop"))) return resolve(list.splice(0));
        addEventListener("animationstart", () => resolve(list.splice(0)), { once: true });
      }),
  );
  expect(lit.filter((name) => name.startsWith("star-pop"))).toEqual([
    "star-pop: Star: Send the report",
  ]);
  // Turned off, nothing pops: the next press's change shows no star-pop.
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "false");
  expect((await started()).filter((name) => name.startsWith("star-pop"))).toEqual([]);
});

test("a row's star that popped once, lit later from elsewhere, does not pop again", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const started: string[] = [];
    let ended = () => {};
    const end = new Promise<void>((resolve) => (ended = resolve));
    Object.assign(window, { started, end });
    addEventListener(
      "animationstart",
      (event) => {
        const star = (event.target as Element).closest("button")?.getAttribute("aria-label");
        started.push(`${event.animationName}: ${star ?? ""}`);
      },
      true,
    );
    // The star's pop's own end, not any other animation's on the page.
    addEventListener(
      "animationend",
      (event) => {
        if (event.animationName === "star-pop") ended();
      },
      true,
    );
  });
  const pops = () =>
    page.evaluate(() =>
      (window as unknown as { started: string[] }).started
        .splice(0)
        .filter((name) => name.startsWith("star-pop")),
    );
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const panel = page.getByRole("region", { name: "Tasks" });
  await panel.getByRole("tab", { name: /^Tasks/ }).click();
  const star = panel.getByRole("button", { name: "Star: Send the report" });
  // Lit by a press: it pops, and its pop ends.
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => (window as unknown as { end: Promise<void> }).end);
  expect(await pops()).toEqual(["star-pop: Star: Send the report"]);
  await expect(star).not.toHaveAttribute("data-pop");
  // Unlit by a press: no mark is left behind.
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await expect(star).not.toHaveAttribute("data-pop");
  // Lit from its details: the details' star pops, the row's does not.
  await panel.getByRole("button", { name: "Send the report", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Send the report" });
  await details.getByRole("button", { name: "Star", exact: true }).click();
  await expect(details.getByRole("button", { name: "Star", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(star).toHaveAttribute("aria-pressed", "true");
  expect(await pops()).not.toContain("star-pop: Star: Send the report");
});

test.describe("on a phone", () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test("a task's details grow out of where its row was tapped", async ({ page }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    const panel = page.getByRole("region", { name: "Tasks" });
    const row = panel.getByRole("listitem", { name: "Buy a gift" }).locator("> div");
    await row.click({ trial: true });
    const box = (await row.boundingBox())!;
    const at = { x: Math.round(box.x + box.width - 80), y: Math.round(box.y + box.height / 2) };
    await page.touchscreen.tap(at.x, at.y);
    const details = page.getByRole("dialog", { name: "Buy a gift" });
    await expect(details).toBeVisible();
    // The whole screen on a phone: its origin is the tap itself.
    const origin = await details.evaluate((popup) => popup.style.transformOrigin);
    const [x, y] = origin.split(" ").map((value) => parseFloat(value));
    expect(Math.abs(x! - at.x)).toBeLessThan(2);
    expect(Math.abs(y! - at.y)).toBeLessThan(2);
  });

  test("opened by a key, the details grow from their middle", async ({ page }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    const panel = page.getByRole("region", { name: "Tasks" });
    await panel.getByRole("button", { name: "Buy a gift", exact: true }).focus();
    await page.keyboard.press("Enter");
    const details = page.getByRole("dialog", { name: "Buy a gift" });
    await expect(details).toBeVisible();
    expect(await details.evaluate((popup) => popup.style.transformOrigin)).toBe("");
  });
});
