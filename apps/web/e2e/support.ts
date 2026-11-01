import type { Page } from "@playwright/test";

/** The demo data's today, as the frozen clock has it: a Wednesday, mid-morning in Vilnius. */
export const NOW = new Date("2026-11-04T10:40:00+02:00");

export const PHONE = { width: 412, height: 915 };
export const WIDE = { width: 1440, height: 900 };

/** Opens the app on the demo data with the clock frozen at `NOW`. */
export async function openDemo(
  page: Page,
  view?: "day" | "3days" | "week" | "month" | "agenda",
): Promise<void> {
  await page.clock.setFixedTime(NOW);
  if (view) {
    await page.addInitScript((value) => localStorage.setItem("astrotime.view", value), view);
  }
  await page.goto("/?demo");
}

/**
 * Wraps `Notification` so a test sees what the app shows: each notification
 * is drawn in the page as a button that taps it (headless Chromium shows
 * none of its own). The permission is the browser context's, through
 * `requestPermission`; headless Chromium answers `Notification.permission`
 * with "denied" whatever the context grants, so the wrapper starts from
 * `permission`, what the test granted before the page loaded.
 */
export async function captureNotifications(
  page: Page,
  permission: NotificationPermission = "default",
): Promise<void> {
  await page.addInitScript((initial) => {
    const Real = window.Notification;
    let granted = initial;
    class Captured extends EventTarget {
      static get permission() {
        return granted;
      }
      static async requestPermission() {
        granted = await Real.requestPermission();
        return granted;
      }
      // A plain field: Playwright compiles this script, and a private one needs its helpers.
      readonly button: HTMLButtonElement;
      constructor(title: string, options: NotificationOptions = {}) {
        super();
        let log = document.querySelector<HTMLElement>("[data-notifications]");
        if (!log) {
          log = document.createElement("section");
          log.dataset["notifications"] = "";
          log.setAttribute("aria-label", "Notifications");
          log.style.cssText =
            "position:fixed;top:8px;left:8px;right:8px;z-index:1000;display:flex;flex-direction:column;gap:8px;font:14px system-ui";
          document.body.append(log);
        }
        const button = document.createElement("button");
        button.dataset["tag"] = options.tag ?? "";
        button.style.cssText =
          "text-align:left;padding:12px 14px;border-radius:16px;border:0;background:#303540;color:#e6e8ed;box-shadow:0 4px 16px #0008";
        const strong = document.createElement("strong");
        strong.textContent = title;
        const body = document.createElement("div");
        body.textContent = options.body ?? "";
        button.append(strong, body);
        button.addEventListener("click", () => this.dispatchEvent(new Event("click")));
        log.append(button);
        this.button = button;
      }
      close() {
        this.button.remove();
      }
    }
    Object.defineProperty(window, "Notification", { value: Captured, configurable: true });
  }, permission);
}

/** Opens the app on an empty store (no demo) with the clock frozen at `NOW`. */
export async function openApp(page: Page): Promise<void> {
  await page.clock.setFixedTime(NOW);
  await page.goto("/");
}
