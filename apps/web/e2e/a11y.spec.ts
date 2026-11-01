// The accessibility audit (design D119): axe-core on every view in both
// themes, on a phone and a wide screen, and on every dialog and screen the
// app opens, from the demo data with the clock frozen. Any violation of
// WCAG 2.0, 2.1 or 2.2 at level A or AA fails it; a rule is switched off only
// in `DISABLED`, with its reason.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

/** Rules switched off everywhere, each with why: none so far. */
const DISABLED: Record<string, string> = {};

/**
 * Elements a rule is not run on, each with why (design D119), where the
 * page matches `media`. axe checks every other rule on them, and this rule
 * on everything else. Each matches nothing taller than `tallest`, so it
 * cannot hide a larger element that comes to fail.
 */
const EXEMPT: {
  rule: string;
  selector: string;
  media: string;
  tallest: number;
  reason: string;
}[] = [
  {
    rule: "target-size",
    // The Month's items, its "+N" and its undone chip: the button of each
    // one-line chip, 16 px high, a row every 17 px, as dense as the
    // reference (design D86). Its day's number and the week's pill are
    // checked. On a touch screen the chips are no buttons: a tap opens the
    // day, the target (design D86), and nothing is exempt.
    selector: '[data-view="month"] [role="listitem"] > button',
    media: "(pointer: fine)",
    tallest: 16,
    reason:
      "an accepted gap, not conformance (design D119): Google's density, for a mouse; on a touch screen the day is the target",
  },
];

/**
 * Runs axe on the page as it is once its transitions have ended (a dialog
 * fading in is audited open, not half transparent) and fails on any
 * violation, listed with the elements it found.
 */
async function audit(page: Page, what: string): Promise<void> {
  // Base UI marks a popup entering or leaving; then its transitions run out.
  await expect(page.locator("[data-starting-style], [data-ending-style]")).toHaveCount(0);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
        // One cancelled meanwhile (a popup unmounted) rejects: it is over all the same.
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const exempt = [];
  for (const exemption of EXEMPT) {
    if (await page.evaluate((media) => matchMedia(media).matches, exemption.media)) {
      exempt.push(exemption);
    }
  }
  for (const { selector, tallest } of exempt) {
    const heights = await page
      .locator(selector)
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    expect
      .soft(
        heights.filter((height) => height > tallest + 0.5),
        `${what}: exempt only chips`,
      )
      .toEqual([]);
  }
  const exempted = [...new Set(exempt.map(({ rule }) => rule))];
  const results = await new AxeBuilder({ page })
    .withTags(TAGS)
    .disableRules([...Object.keys(DISABLED), ...exempted])
    .analyze();
  const found = [...results.violations];
  for (const rule of exempted) {
    let builder = new AxeBuilder({ page }).withRules([rule]);
    for (const { selector } of exempt.filter((exemption) => exemption.rule === rule)) {
      builder = builder.exclude(selector);
    }
    found.push(...(await builder.analyze()).violations);
  }
  const violations = found.map((violation) => ({
    rule: violation.id,
    help: violation.help,
    nodes: violation.nodes.map((node) => `${node.target.join(" ")}: ${node.failureSummary}`),
  }));
  expect.soft(violations, what).toEqual([]);
}

const today = (page: Page) => page.getByRole("list", { name: /Wednesday, November 4|4 ноября/ });

/** Switches the view by its key (design D88) and waits for it to be drawn. */
async function show(page: Page, view: "day" | "3days" | "week" | "month" | "agenda") {
  const key = { day: "d", "3days": "x", week: "w", month: "m", agenda: "a" }[view];
  await page.locator("body").press(key);
  await expect(today(page).getByRole("listitem").first()).toBeVisible();
}

for (const colorScheme of ["dark", "light"] as const) {
  // A phone is a touch screen (a coarse pointer); a wide screen has a mouse.
  for (const [size, viewport, hasTouch] of [
    ["phone", PHONE, true],
    ["wide", WIDE, false],
  ] as const) {
    test(`every view, ${colorScheme}, ${size}`, async ({ browser }) => {
      const context = await browser.newContext({
        colorScheme,
        viewport,
        hasTouch,
        locale: "en-US",
        timezoneId: "Europe/Vilnius",
      });
      const page = await context.newPage();
      await openDemo(page, "day");
      expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(hasTouch);
      await expect(today(page).getByRole("listitem").first()).toBeVisible();
      for (const view of ["day", "3days", "week", "month", "agenda"] as const) {
        await show(page, view);
        await audit(page, `${view}, ${colorScheme}, ${size}`);
      }
      await context.close();
    });
  }
}

test.describe("the screens and dialogs", () => {
  for (const colorScheme of ["dark", "light"] as const) {
    test.describe(colorScheme, () => {
      test.use({ colorScheme });

      test("the drawer, the month picker, the strip expanded, the undone tasks on a phone", async ({
        page,
      }) => {
        await page.setViewportSize(PHONE);
        await openDemo(page, "day");
        await expect(today(page).getByRole("listitem").first()).toBeVisible();
        await page.getByRole("button", { name: "Main menu" }).click();
        await expect(page.getByRole("dialog", { name: "Main menu" })).toBeVisible();
        await audit(page, "the drawer");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);

        await page.getByRole("button", { name: /^November, / }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await audit(page, "the month picker");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toHaveCount(0);

        const expand = page.getByRole("button", { name: /all-day/ });
        await expand.click();
        await audit(page, "the all-day strip expanded");
        // Folded again, so the popover covers no chip of the strip.
        await expand.click();
        await page.getByRole("button", { name: /undone/ }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await audit(page, "the undone tasks");
      });

      test("the tasks screen on a phone, its panel and the settings on a wide screen", async ({
        page,
      }) => {
        await page.setViewportSize(PHONE);
        await openDemo(page, "day");
        await page.getByRole("button", { name: "Tasks", exact: true }).click();
        const screen = page.getByRole("region", { name: "Tasks" });
        await screen.getByRole("tab", { name: /^Tasks/ }).click();
        await expect(screen.getByRole("checkbox").first()).toBeVisible();
        await screen
          .getByRole("button", { name: /^Completed/ })
          .first()
          .click();
        await expect(screen.getByRole("checkbox", { checked: true }).first()).toBeVisible();
        await audit(page, "the tasks screen");

        await page.setViewportSize(WIDE);
        await expect(page.getByLabel("Theme")).toBeVisible();
        await audit(page, "the tasks panel and the settings");
      });

      test("search with results", async ({ page }) => {
        await page.setViewportSize(PHONE);
        await openDemo(page, "day");
        await page.getByRole("button", { name: "Search" }).click();
        await page.getByRole("searchbox", { name: "Search" }).fill("e");
        await expect(
          page.getByRole("list", { name: "Search results" }).getByRole("button").first(),
        ).toBeVisible();
        await audit(page, "search with results");
      });

      test("the details, the edit dialog and the scope dialog", async ({ page }) => {
        await page.setViewportSize(WIDE);
        await openDemo(page, "week");
        await page
          .getByRole("list", { name: "Thursday, November 5" })
          .getByRole("button", { name: /^Stand-up, / })
          .click();
        const details = page.getByRole("dialog", { name: "Stand-up" });
        await expect(details).toBeVisible();
        await audit(page, "the details");
        await details.getByRole("button", { name: "Edit" }).click();
        const edit = page.getByRole("dialog", { name: "Edit event" });
        await expect(edit).toBeVisible();
        await audit(page, "the edit dialog");
        await edit.getByRole("textbox", { name: "Title" }).fill("Stand-up!");
        await edit.getByRole("button", { name: "Save" }).click();
        await expect(page.getByRole("alertdialog", { name: "Edit recurring event" })).toBeVisible();
        await audit(page, "the scope dialog");
      });

      test("a task's details and its edit dialog", async ({ page }) => {
        await page.setViewportSize(PHONE);
        await openDemo(page, "day");
        await today(page)
          .getByRole("button", { name: /Send the report/ })
          .click();
        const details = page.getByRole("dialog", { name: "Send the report" });
        await expect(details).toBeVisible();
        await audit(page, "a task's details");
        await details.getByRole("button", { name: "Edit" }).click();
        await expect(page.getByRole("dialog", { name: "Edit task" })).toBeVisible();
        await audit(page, "a task's edit dialog");
      });

      test("the accounts dialog, the conflicts list and adding an account", async ({ page }) => {
        await page.setViewportSize(WIDE);
        await openDemo(page, "week");
        await page.getByRole("button", { name: /^Accounts/ }).click();
        const accounts = page.getByRole("dialog", { name: "Accounts" });
        await expect(accounts.getByRole("button", { name: "Review" })).toBeVisible();
        await audit(page, "the accounts dialog");
        await accounts.getByRole("button", { name: "Review" }).click();
        await expect(
          page.getByRole("dialog", { name: "Conflicts" }).getByRole("listitem").first(),
        ).toBeVisible();
        await audit(page, "the conflicts list");
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: "Conflicts" })).toHaveCount(0);

        // The list closes over the accounts dialog, still open under it.
        await accounts.getByRole("button", { name: "Add account" }).click();
        const signIn = page.getByRole("dialog", { name: "Add an account" });
        await expect(signIn).toBeVisible();
        await audit(page, "adding an account");
        await signIn.getByRole("tab", { name: "CalDAV" }).click();
        await expect(signIn.getByRole("textbox", { name: "User name" })).toBeVisible();
        await audit(page, "adding an account by password");
      });
    });
  }
});

test("Russian: the document's language follows the UI's", async ({ browser }) => {
  const context = await browser.newContext({
    locale: "ru-RU",
    viewport: WIDE,
    timezoneId: "Europe/Vilnius",
  });
  const page = await context.newPage();
  await openDemo(page, "week");
  await expect(today(page).getByRole("listitem").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  await audit(page, "the week in Russian");
  await page.getByLabel("Язык").selectOption({ label: "English" });
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await context.close();
});

/** The element, or one inside it, has the focus. */
const holdsFocus = (page: Page, locator: Locator) =>
  expect(locator.and(page.locator(":focus-within"))).toHaveCount(1);

test.describe("what axe cannot see (design D120)", () => {
  test("a dialog keeps the focus inside and gives it back to what opened it", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await openDemo(page, "week");
    const opener = page
      .getByRole("list", { name: "Thursday, November 5" })
      .getByRole("button", { name: /^Stand-up, / });
    await opener.focus();
    await page.keyboard.press("Enter");
    const details = page.getByRole("dialog", { name: "Stand-up" });
    await expect(details).toBeVisible();
    await holdsFocus(page, details);
    // Tab after Tab stays in the dialog (a modal dialog's trap).
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      await holdsFocus(page, details);
    }
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test("the drawer on a phone traps the focus and gives it back to the menu button", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openDemo(page, "day");
    const menu = page.getByRole("button", { name: "Main menu" });
    await menu.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name: "Main menu" });
    await holdsFocus(page, drawer);
    await page.keyboard.press("Shift+Tab");
    await holdsFocus(page, drawer);
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
  });

  for (const view of ["week", "month"] as const) {
    test(`every keyboard stop in the ${view} view shows its whole ring`, async ({ page }) => {
      await page.setViewportSize(WIDE);
      await openDemo(page, view);
      await expect(today(page).getByRole("listitem").first()).toBeVisible();
      // The top bar, the drawer, then the view's days and items, until Tab
      // comes round again. Each stop shows an outline, and the whole of it is
      // inside every box that clips it (a scroller, a day's rows) and on
      // screen: a ring cut off by the grid's scroller is not seen.
      let stops = 0;
      for (let tab = 0; tab < 400; tab++) {
        await page.keyboard.press("Tab");
        const ring = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          // Past the last stop the focus leaves the page.
          if (!element || element === document.body) return null;
          const again = element.dataset["ringSeen"] !== undefined;
          element.dataset["ringSeen"] = "";
          const style = getComputedStyle(element);
          const reach = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth);
          const box = element.getBoundingClientRect();
          // The outline's outer edge; one drawn inward stays within the element.
          const grow = Math.max(reach, 0);
          const outer = {
            left: box.left - grow,
            top: box.top - grow,
            right: box.right + grow,
            bottom: box.bottom + grow,
          };
          const clips = [{ left: 0, top: 0, right: innerWidth, bottom: innerHeight, by: "screen" }];
          for (let up = element.parentElement; up; up = up.parentElement) {
            const { overflowX, overflowY } = getComputedStyle(up);
            if (overflowX === "visible" && overflowY === "visible") continue;
            const r = up.getBoundingClientRect();
            const left = r.left + up.clientLeft;
            const top = r.top + up.clientTop;
            clips.push({
              left,
              top,
              right: left + up.clientWidth,
              bottom: top + up.clientHeight,
              by: up.getAttribute("aria-label") ?? up.className,
            });
          }
          const cut = clips.find(
            (clip) =>
              outer.left < clip.left - 0.5 ||
              outer.top < clip.top - 0.5 ||
              outer.right > clip.right + 0.5 ||
              outer.bottom > clip.bottom + 0.5,
          );
          return {
            again,
            name: element.getAttribute("aria-label") ?? element.textContent ?? element.tagName,
            style: style.outlineStyle,
            width: style.outlineWidth,
            cut: cut?.by ?? null,
          };
        });
        // Round once: the focus left the page or came back to a stop seen.
        if (!ring || ring.again) break;
        stops++;
        expect(ring.style, ring.name).not.toBe("none");
        expect(ring.width, ring.name).not.toBe("0px");
        expect(ring.cut, `${ring.name}: its ring is cut off`).toBeNull();
      }
      // The view's items were reached, not only the chrome.
      expect(stops).toBeGreaterThan(40);
    });
  }

  test("the page has its landmarks and a heading for the period", async ({ page }) => {
    await page.setViewportSize(WIDE);
    await openDemo(page, "week");
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
    await expect(page.getByRole("main", { name: /^November/ })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /^November/ })).toBeAttached();
    await expect(
      page.getByRole("heading", { level: 2, name: "Wednesday, November 4" }),
    ).toBeVisible();
  });

  for (const view of ["day", "3days", "week", "month", "agenda"] as const) {
    test(`at 320 px wide (400% zoom of 1280) the ${view} view needs no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await openDemo(page, view);
      await expect(today(page).getByRole("listitem").first()).toBeVisible();
      for (const name of ["Main menu", "Search", /^Today/, "Tasks", /^Accounts/]) {
        await expect(page.getByRole("banner").getByRole("button", { name })).toBeInViewport();
      }
      await expect(page.getByRole("button", { name: "Create" })).toBeInViewport();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width).toBeLessThanOrEqual(320);
    });
  }

  for (const colorScheme of ["dark", "light"] as const) {
    test(`every colour an item can have is drawn dark enough for its white text, ${colorScheme}`, async ({
      page,
    }) => {
      // The fill as Chromium resolves styles.css (packages/ui/test/item-colors.test.ts
      // proves the rule itself): a grid over sRGB, colours outside it, a
      // translucent one, the editor's names, each also done (muted).
      await page.emulateMedia({ colorScheme });
      await openDemo(page, "day");
      await expect(today(page).getByRole("listitem").first()).toBeVisible();
      const worst = await page.evaluate(() => {
        const colors: string[] = [];
        for (let r = 0; r < 256; r += 51) {
          for (let g = 0; g < 256; g += 51) {
            for (let b = 0; b < 256; b += 51) colors.push(`rgb(${r} ${g} ${b})`);
          }
        }
        colors.push(
          "color(display-p3 0 1 0)",
          "color(rec2020 0 1 1)",
          "oklch(0.95 0.4 200)",
          "oklch(0.6 0.5 140)",
          "#ffff0080",
          "#0082c9",
          "tomato",
          "orange",
          "gold",
          "mediumseagreen",
          "lightseagreen",
          "steelblue",
          "slateblue",
          "palevioletred",
          "slategray",
          "white",
        );
        const box = document.createElement("div");
        document.body.append(box);
        const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
        // Chromium gives a resolved colour in its own space; a canvas draws it in sRGB, 8 bits.
        const canvas = document.createElement("canvas").getContext("2d", {
          willReadFrequently: true,
        })!;
        const drawn = (color: string) => {
          canvas.clearRect(0, 0, 1, 1);
          canvas.fillStyle = color;
          canvas.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = canvas.getImageData(0, 0, 1, 1).data;
          return { linear: [r!, g!, b!].map((x) => toLinear(x / 255)), alpha: a };
        };
        let found = { contrast: Infinity, color: "", done: false, fill: "", text: "" };
        for (const color of colors) {
          for (const done of [false, true]) {
            const item = document.createElement("div");
            item.className = "item";
            item.style.setProperty("--item", color);
            if (done) item.dataset["done"] = "";
            box.append(item);
            const style = getComputedStyle(item);
            const fill = drawn(style.backgroundColor);
            const text = drawn(style.color);
            if (fill.alpha !== 255) throw new Error(`a translucent fill for ${color}`);
            const y = ([r, g, b]: number[]) => 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
            const [hi, lo] = [y(text.linear), y(fill.linear)].toSorted((p, q) => q - p);
            const contrast = (hi! + 0.05) / (lo! + 0.05);
            if (contrast < found.contrast) {
              found = { contrast, color, done, fill: style.backgroundColor, text: style.color };
            }
          }
        }
        box.remove();
        return found;
      });
      expect(worst.contrast, JSON.stringify(worst)).toBeGreaterThanOrEqual(4.5);
    });
  }

  test("asked for less motion, the drawer slides in no more", async ({ browser }) => {
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: PHONE,
      locale: "en-US",
      timezoneId: "Europe/Vilnius",
    });
    const page = await context.newPage();
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Main menu" }).click();
    const drawer = page.getByRole("dialog", { name: "Main menu" });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveCSS("transition-duration", "0s");
    await context.close();
  });
});
