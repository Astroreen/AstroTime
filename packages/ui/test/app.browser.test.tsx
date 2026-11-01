// The UI on the web store in Chromium: it draws what the local store holds
// and follows it as it changes (docs/plans/foundation.md#D5), and says so
// plainly when it cannot open the store.
import type { HttpClient } from "@astrotime/caldav";
import { OfflineError } from "@astrotime/core";
import { Store, StoreInUseError } from "@astrotime/storage";
import { webDriver } from "@astrotime/storage/web";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser/context";

import { loadDemo } from "../src/demo/index.ts";
import { AstroTime, type Platform } from "../src/index.ts";
import { memoryPreferences } from "../src/preferences.ts";
import { memorySecrets, nextcloud, SERVER } from "./fakes.ts";

const NOW = new Date("2026-11-04T10:40:00+02:00");
const timeZone = "Europe/Vilnius";
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
  vi.useRealTimers();
});

/** Never reached: the demo account does not sync. */
const unreachable: HttpClient = async () => {
  throw new OfflineError("no network in this test");
};

function render(store: Promise<Store>, languages: string[], platform: Partial<Platform> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  root.render(
    <AstroTime
      platform={{
        store,
        preferences: memoryPreferences({ "astrotime.view": "day" }),
        http: unreachable,
        secrets: memorySecrets(),
        openExternal: () => {},
        ...platform,
      }}
      languages={languages}
      timeZone={timeZone}
    />,
  );
  cleanups.push(() => {
    root.unmount();
    container.remove();
  });
}

/** A store that fails to open; handled here, so the test is not failed for an unhandled rejection. */
function failing(error: Error): Promise<Store> {
  const opening = Promise.reject(error);
  opening.catch(() => {});
  return opening;
}

let n = 0;
async function demoStore(languages: string[]): Promise<Store> {
  const store = await Store.open(await webDriver(`ui-${Date.now()}-${n++}`));
  cleanups.push(() => store.close());
  await loadDemo(store, { languages, timeZone, now: NOW.getTime() });
  return store;
}

const event = (uid: string, summary: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART;TZID=${timeZone}:20261104T160000\r\nDTEND;TZID=${timeZone}:20261104T170000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

test("draws today from the local store, and follows the store as a sync writes to it", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await demoStore(["en-US"]);
  render(Promise.resolve(store), ["en-US"]);
  const today = page.getByRole("list", { name: "Wednesday, November 4" });
  await expect
    .element(today.getByRole("listitem", { name: /^Design review, / }))
    .toBeInTheDocument();
  await expect
    .element(
      page.getByRole("list", { name: "All day" }).getByRole("button", { name: "3 undone tasks" }),
    )
    .toBeInTheDocument();

  const work = (await store.calendars()).find((calendar) => calendar.name === "Work")!;
  const written = await store.saveFromServer(work.id, {
    href: "late.ics",
    etag: '"1"',
    ics: event("late", "Late review"),
  });
  const late = today.getByRole("listitem", { name: /^Late review, / });
  await expect.element(late).toBeInTheDocument();
  await store.removeObject(written.id);
  await expect.element(late).not.toBeInTheDocument();
});

test("a store another tab holds: a message in the user's language", async () => {
  render(failing(new StoreInUseError("held")), ["ru-RU"]);
  await expect
    .element(
      page.getByRole("alert").getByRole("heading", { name: "AstroTime открыт в другой вкладке" }),
    )
    .toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
});

test("a store that does not open for another reason: the failure, not a blank page", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  cleanups.push(() => quiet.mockRestore());
  render(failing(new Error("broken")), ["en-US"]);
  await expect
    .element(
      page.getByRole("alert").getByRole("heading", { name: "Your calendar could not be opened" }),
    )
    .toBeInTheDocument();
  expect(quiet).toHaveBeenCalled();
});

// The app's stylesheet lifts a dialog above Base UI's own backdrop; these
// tests load no CSS, so a dialog's buttons get the clicks only with this.
const lift = document.createElement("style");
lift.textContent = "[role=dialog], [role=alertdialog] { position: relative; z-index: 1; }";
document.head.append(lift);

async function emptyStore(): Promise<Store> {
  const store = await Store.open(await webDriver(`ui-${Date.now()}-${n++}`));
  cleanups.push(() => store.close());
  return store;
}

test("an empty app leads to adding an account, and a wrong password says so in the user's language", async () => {
  const store = await emptyStore();
  const server = nextcloud({ password: "right" });
  const secrets = memorySecrets();
  render(Promise.resolve(store), ["ru-RU"], { http: server.http, secrets });
  await expect
    .element(page.getByRole("heading", { name: "Ваши календари и задачи с вашего сервера" }))
    .toBeInTheDocument();
  await page.getByRole("button", { name: "Другой сервер CalDAV" }).click();
  const dialog = page.getByRole("dialog", { name: "Добавить аккаунт" });
  await expect
    .element(dialog.getByRole("tab", { name: "CalDAV" }))
    .toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("textbox", { name: "Адрес сервера" }).fill("cloud.example.com");
  await dialog.getByRole("textbox", { name: "Имя пользователя" }).fill("astro");
  await dialog.getByLabelText("Пароль").fill("wrong");
  await dialog.getByRole("button", { name: "Войти" }).click();
  await expect
    .element(dialog.getByRole("alert"))
    .toHaveTextContent("Неверное имя пользователя или пароль.");
  expect(await store.accounts()).toEqual([]);

  await dialog.getByLabelText("Пароль").fill("right");
  await dialog.getByRole("button", { name: "Войти" }).click();
  // Signed in: the dialog closes and the calendar, with the account's button, takes its place.
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: /^Аккаунты/ })).toBeInTheDocument();
  expect((await store.accounts()).map((a) => a.name)).toEqual(["astro@cloud.example.com"]);
  expect(secrets.values.size).toBe(1);
});

test("Login Flow v2 in the UI: it waits, opens the page again, cancels, and finishes on return", async () => {
  const store = await emptyStore();
  const server = nextcloud({ password: "app-pass" });
  const opened: string[] = [];
  render(Promise.resolve(store), ["en-US"], {
    http: server.http,
    openExternal: (url) => opened.push(url),
  });
  await page.getByRole("button", { name: "Sign in to Nextcloud" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an account" });
  await dialog.getByRole("textbox", { name: "Server address" }).fill("cloud.example.com");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect
    .element(dialog.getByRole("status").getByRole("heading", { name: "Waiting for Nextcloud" }))
    .toBeInTheDocument();
  expect(opened).toEqual([`${SERVER}/login/v2/flow/abc`]);
  await dialog.getByRole("button", { name: "Open the sign-in page again" }).click();
  expect(opened).toHaveLength(2);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.element(dialog.getByRole("button", { name: "Continue" })).toBeInTheDocument();

  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect
    .element(dialog.getByRole("heading", { name: "Waiting for Nextcloud" }))
    .toBeInTheDocument();
  // Approved on Nextcloud's page; coming back to the tab asks at once.
  server.approve();
  document.dispatchEvent(new Event("visibilitychange"));
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect((await store.accounts()).map((a) => a.username)).toEqual(["astro"]);
});
