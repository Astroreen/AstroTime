// Completing a task moves it (design D197): what animates is read from the
// calls to `Element.animate`, logged as the page makes them, so nothing here
// waits for an animation to run or end.
import { expect, test, type Page } from "@playwright/test";

import { openDemo, WIDE } from "./support.ts";

interface Call {
  /** The row's task, `card:<name>`, `background`, `count` or `other`; `ghost` for a row that left. */
  readonly where: string;
  readonly frames: Keyframe[];
  readonly delay: number;
}

/** Logs every `animate` call: on what, its keyframes and its delay. */
async function logAnimations(page: Page) {
  await page.addInitScript(() => {
    const calls: unknown[] = [];
    Object.assign(window, { animations: calls });
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (this: Element, frames, options) {
      const element = this as HTMLElement;
      const where = element.dataset["task"]
        ? `${element.closest("[data-motion-layer]") ? "ghost" : "row"}:${element.textContent}`
        : element.dataset["card"]
          ? `card:${element.dataset["card"]}`
          : element.hasAttribute("data-card-background")
            ? "background"
            : element.hasAttribute("data-completed-count")
              ? "count"
              : "other";
      const delay = typeof options === "object" ? (options.delay ?? 0) : 0;
      calls.push({ where, frames, delay });
      return animate.call(this, frames, options);
    };
  });
  /** The calls since the last look. */
  return () =>
    page.evaluate(() => (window as unknown as { animations: Call[] }).animations.splice(0));
}

/** The y a translate keyframe starts from. */
const fromY = (call: Call | undefined) => {
  const match = /translate(?:Y)?\((?:[-\d.]+px, )?([-\d.]+)px\)/.exec(
    String(call?.frames[0]?.["transform"]),
  );
  return match ? Number(match[1]) : Number.NaN;
};

async function openTasks(page: Page) {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const panel = page.getByRole("region", { name: "Tasks" });
  await panel.getByRole("tab", { name: /^Tasks/ }).click();
  // The motion's code is in: the screen moves once it came (D145).
  await expect(panel.locator("[data-moves]")).toHaveCount(1);
  return panel;
}

test("a task completed slides toward the folded Completed, the rows below close up after its tick, the count ticks over", async ({
  page,
}) => {
  const taken = await logAnimations(page);
  const panel = await openTasks(page);
  await taken();
  await panel.getByRole("checkbox", { name: "Send the report" }).click();
  await expect(panel.getByRole("button", { name: "Completed (4)" })).toBeVisible();
  const calls = await taken();
  const at = (where: string) => calls.find((call) => call.where.startsWith(where));

  // It left the list: drawn on where it was, it fades out going down to the count.
  const ghost = at("ghost:Send the report");
  expect(ghost?.frames.at(-1)?.["opacity"]).toBe(0);
  expect(fromY({ ...ghost!, frames: [ghost!.frames.at(-1)!] })).toBeGreaterThan(0);
  // The rows below came up by a row: each slides from where it was, after the tick (160 ms).
  for (const title of ["Take out the recycling", "Water the plants", "Write the proposal"]) {
    const row = at(`row:${title}`);
    expect(fromY(row)).toBeGreaterThan(40);
    expect(row?.delay).toBe(160);
  }
  // The rows above did not move; the card's background shrinks from its old height.
  expect(at("row:Reply to Olga")).toBeUndefined();
  expect(String(at("background")?.frames[0]?.["transform"])).toMatch(/^scaleY\(1\.\d+\)$/);
  expect(at("count")).toBeDefined();
  // Only transforms and opacity move (design D154).
  for (const call of calls) {
    for (const frame of call.frames) {
      expect(
        Object.keys(frame).filter((key) => !["transform", "opacity", "offset"].includes(key)),
      ).toEqual([]);
    }
  }
});

test("a row leaving is out of reach: no press, no focus, nothing for a screen reader", async ({
  page,
}) => {
  const panel = await openTasks(page);
  await panel.getByRole("checkbox", { name: "Send the report" }).click();
  await expect(panel.getByRole("button", { name: "Completed (4)" })).toBeVisible();
  // Held mid-way while it leaves.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.pause();
  });
  const layer = page.locator("[data-motion-layer]");
  await expect(layer.locator("[data-task]")).toHaveCount(1);
  await expect(layer).toHaveAttribute("inert", "");
  await expect(layer).toHaveAttribute("aria-hidden", "true");
  // Its checkbox and title take no focus, from a script or the keyboard.
  const focused = await layer.evaluate((element) =>
    [...element.querySelectorAll<HTMLElement>('[role="checkbox"], button')].map((control) => {
      control.focus();
      return document.activeElement === control;
    }),
  );
  expect(focused.length).toBeGreaterThan(0);
  expect(focused.every((took) => !took)).toBe(true);
  await expect(panel.getByRole("checkbox", { name: "Send the report" })).toHaveCount(0);
});

test("two tasks completed quickly: each leaves once, the first still leaving through the second's change", async ({
  page,
}) => {
  const taken = await logAnimations(page);
  const panel = await openTasks(page);
  await panel.getByRole("checkbox", { name: "Send the report" }).click();
  await expect(panel.getByRole("button", { name: "Completed (4)" })).toBeVisible();
  // Held mid-way: the first is still leaving when the second change comes.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.pause();
  });
  const first = await taken();
  expect(first.filter((call) => call.where.startsWith("ghost:")).length).toBe(1);
  await panel.getByRole("checkbox", { name: "Reply to Olga" }).click({ force: true });
  await expect(panel.getByRole("button", { name: "Completed (5)" })).toBeVisible();
  const calls = await taken();
  // Only the second leaves now; the first is neither measured nor moved again.
  expect(
    calls
      .filter((call) => /^(ghost|row):Send the report/.test(call.where))
      .map((call) => call.where),
  ).toEqual([]);
  expect(calls.filter((call) => call.where.startsWith("ghost:")).length).toBe(1);
  // The first is still on the layer, its leaving not cancelled by the second change.
  const send = page
    .locator("[data-motion-layer] [data-task]")
    .filter({ hasText: "Send the report" });
  await expect(send).toHaveCount(1);
  expect(
    await send.evaluate((element) =>
      element.getAnimations().map((animation) => animation.playState),
    ),
  ).toEqual(["paused"]);
});

test("with Completed open, a task completed moves down into it, and back up when not completed", async ({
  page,
}) => {
  const taken = await logAnimations(page);
  const panel = await openTasks(page);
  await panel.getByRole("button", { name: /^Completed/ }).click();
  await taken();
  await panel.getByRole("checkbox", { name: "Send the report" }).click();
  const completed = panel.getByRole("list", { name: "Completed tasks" });
  await expect(completed.getByRole("checkbox", { name: "Send the report" })).toBeChecked();
  let calls = await taken();
  // The same row, now in Completed, slides down from where it was: its move
  // less the card's, which slides up by the row the list lost.
  const card = calls.find((call) => call.where === "card:completed");
  const row = calls.find((call) => call.where.startsWith("row:Send the report"));
  expect(fromY(card)).toBeGreaterThan(40);
  expect(fromY(row) + fromY(card)).toBeLessThan(0);
  expect(calls.some((call) => call.where.startsWith("ghost:"))).toBe(false);

  // Its move run to its end, so the next starts from where it landed.
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
  await completed.getByRole("checkbox", { name: "Send the report" }).click();
  await expect(
    panel
      .getByRole("list", { name: "Tasks", exact: true })
      .getByRole("checkbox", { name: "Send the report" }),
  ).not.toBeChecked();
  calls = await taken();
  const back = calls.find((call) => call.where.startsWith("row:Send the report"));
  expect(fromY(back)).toBeGreaterThan(40);
});

test.describe("asked for less motion", () => {
  test("a task completed changes in place, and the motion's code is never loaded", async ({
    page,
  }) => {
    const taken = await logAnimations(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize(WIDE);
    await openDemo(page, "week");
    await page.getByRole("button", { name: "Tasks", exact: true }).click();
    const panel = page.getByRole("region", { name: "Tasks" });
    await panel.getByRole("tab", { name: /^Tasks/ }).click();
    await taken();
    await panel.getByRole("checkbox", { name: "Send the report" }).click();
    await expect(panel.getByRole("button", { name: "Completed (4)" })).toBeVisible();
    expect((await taken()).filter((call) => call.where !== "other")).toEqual([]);
    await expect(panel.locator("[data-moves]")).toHaveCount(0);
  });
});
