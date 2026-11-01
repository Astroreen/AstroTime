import type { Page } from "@playwright/test";

/** The demo data's today, as the frozen clock has it: a Wednesday, mid-morning in Vilnius. */
const NOW = new Date("2026-11-04T10:40:00+02:00");

export const PHONE = { width: 412, height: 915 };
export const WIDE = { width: 1440, height: 900 };

/** Opens the app on the demo data with the clock frozen at `NOW`. */
export async function openDemo(page: Page, view?: "day" | "3days" | "week"): Promise<void> {
  await page.clock.setFixedTime(NOW);
  if (view) {
    await page.addInitScript((value) => localStorage.setItem("astrotime.view", value), view);
  }
  await page.goto("/?demo");
}
