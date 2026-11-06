import { expect, type Locator, type Page } from "@playwright/test";

/** The demo data's today, as the frozen clock has it: a Wednesday, mid-morning in Vilnius. */
export const NOW = new Date("2026-11-04T10:40:00+02:00");

/** Chooses `option` in one of AstroTime's dropdowns (design D167): opens it, taps the option. */
export async function choose(field: Locator, option: string): Promise<void> {
  await field.click();
  await field
    .page()
    .getByRole("listbox")
    .getByRole("option", { name: option, exact: true })
    .click();
}

/** Quick create's words, its own and its "Expand" (design D296), in each language. */
const QUICK = {
  en: { dialog: "Quick create", expand: "Expand", editor: /^New (event|task)$/ },
  ru: {
    dialog: "Быстрое создание",
    expand: "Развернуть",
    editor: /^Новое мероприятие$|^Новая задача$/,
  },
} as const;

/** Quick create, which a slot, the floating button or "Create" opens (design D296). */
export function quickCreate(page: Page, language: keyof typeof QUICK = "en"): Locator {
  return page.getByRole("dialog", { name: QUICK[language].dialog });
}

/**
 * The edit dialog for a new item, reached as the user reaches it: quick
 * create (design D296), opened by a slot, the floating button or "Create",
 * then its "Expand". Every spec that creates through the full editor comes
 * here, so what they test of the editor (D205 among it) is the editor's.
 */
export async function expand(page: Page, language: keyof typeof QUICK = "en"): Promise<void> {
  const quick = quickCreate(page, language);
  await quick.getByRole("button", { name: QUICK[language].expand }).click();
  await expect(quick).toHaveCount(0);
  // Its code may still be on its way: the test goes on once it is there.
  await expect(page.getByRole("dialog", { name: QUICK[language].editor })).toBeVisible();
}

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

/**
 * Opens the add-account dialog from the accounts dialog, the way in since
 * the app opens on the calendar on this device (docs/plans/foundation.md#D122);
 * on CalDAV's tab for `caldav`. `words` are the UI's, in its language.
 */
export async function addAccount(
  page: Page,
  kind: "nextcloud" | "caldav" = "nextcloud",
  words = { accounts: /^Accounts/, add: "Add account", dialog: "Add an account" },
) {
  await page.getByRole("button", { name: words.accounts }).click();
  await page.getByRole("dialog").getByRole("button", { name: words.add }).click();
  const dialog = page.getByRole("dialog", { name: words.dialog });
  if (kind === "nextcloud") return dialog;
  // The Nextcloud tab's panel may stay in the tree: CalDAV's own panel holds the form.
  await dialog.getByRole("tab", { name: "CalDAV" }).click();
  return dialog.getByRole("tabpanel", { name: "CalDAV" });
}

/** The Russian words of `addAccount`. */
export const RU_ADD_ACCOUNT = {
  accounts: /^Аккаунты/,
  add: "Добавить аккаунт",
  dialog: "Добавить аккаунт",
};
