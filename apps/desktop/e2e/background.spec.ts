// Living in the background (docs/plans/desktop.md#D75, D76): one instance,
// whose window closes to the background and comes back on a second launch;
// with the window closed, the main process's triggers sync a server's change
// and its reminder shows, late after a sleep, and a click opens its details;
// the window's frame follows the theme setting. The 15-minute timer itself
// runs on a fake clock in src/main/reminders.test.ts; here the machine's
// resume (`powerMonitor`'s event, emitted in the main process) stands in for it.
import { test as base, expect, type ElectronApplication } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { keepPassword, launch, launchAgain, profile, signInByPassword } from "./support.ts";

const test = base.extend<{ radicale: CalDavServer }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
});

/** The app on a new profile, signed in to `radicale`: the drawer's settings show once an account does. */
async function signedIn(radicale: CalDavServer, options: { realClock?: boolean } = {}) {
  const work = await radicale.mkcalendar("work");
  const userData = profile();
  const { app, page } = await launch(userData, options);
  await signInByPassword(page, radicale);
  await keepPassword(page, "Keep until AstroTime quits");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Settings" })).toBeVisible();
  return { app, page, userData, work };
}

/** Closes the window as its close button would; resolves once it is hidden. */
const closeWindow = (app: ElectronApplication) =>
  app.evaluate(
    ({ BrowserWindow }) =>
      new Promise<{ visible: boolean; destroyed: boolean }>((resolve) => {
        const [window] = BrowserWindow.getAllWindows();
        window!.once("hide", () =>
          resolve({ visible: window!.isVisible(), destroyed: window!.isDestroyed() }),
        );
        window!.close();
      }),
  );

/** Starts listening for the window to show; `shown()` resolves once it has. */
async function whenShown(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    (globalThis as { shown?: Promise<boolean> }).shown = new Promise((resolve) =>
      window!.once("show", () => resolve(window!.isVisible())),
    );
  });
  return { shown: () => app.evaluate(() => (globalThis as { shown?: Promise<boolean> }).shown) };
}

test("closing the window keeps the app running; a second launch shows it; the setting makes closing quit", async ({
  radicale,
}) => {
  const { app, page, userData } = await signedIn(radicale);

  expect(await closeWindow(app)).toEqual({ visible: false, destroyed: false });
  // A second launch hands over to the first, which shows its window, and leaves.
  const { shown } = await whenShown(app);
  expect(await launchAgain(userData)).toBe(0);
  expect(await shown()).toBe(true);

  // "Keep running" off: closing the window quits the app.
  const keepRunning = page.getByRole("switch", { name: "Keep running when the window is closed" });
  await expect(keepRunning).toBeChecked();
  await keepRunning.click();
  await expect(keepRunning).not.toBeChecked();
  const closed = app.waitForEvent("close");
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.close());
  await closed;
});

test("the window's frame follows the theme setting", async ({ radicale }) => {
  const { app, page } = await signedIn(radicale);
  // As the window starts: the system's.
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe("system");
  for (const [label, theme] of [
    ["Dark", "dark"],
    ["Light", "light"],
    ["System default", "system"],
  ] as const) {
    // Once the main process has the page's message with this theme (its own
    // listener runs first), the theme it set.
    await app.evaluate(({ ipcMain, nativeTheme }, expected) => {
      (globalThis as { applied?: Promise<string> }).applied = new Promise((resolve) => {
        const heard = (_event: unknown, state: { theme?: string }) => {
          if (state.theme !== expected) return;
          ipcMain.off("astrotime:shell", heard);
          resolve(nativeTheme.themeSource);
        };
        ipcMain.on("astrotime:shell", heard);
      });
    }, theme);
    await page.getByLabel("Theme").selectOption({ label });
    expect(await app.evaluate(() => (globalThis as { applied?: Promise<string> }).applied)).toBe(
      theme,
    );
  }
  await app.close();
});

/** An iCalendar time in UTC: 20261104T084000Z. */
const utc = (ms: number) => new Date(ms).toISOString().replaceAll(/[-:]|\.\d{3}/g, "");

/** Puts an event with a reminder 15 minutes before it on `calendar`, as another client would. */
async function putEventWithReminder(server: CalDavServer, calendar: string, start: number) {
  const response = await fetch(`${calendar}standup.ics`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${btoa(`${server.username}:${server.password}`)}`,
      "Content-Type": "text/calendar",
    },
    body: [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Another client//EN",
      "BEGIN:VEVENT",
      "UID:standup",
      `DTSTAMP:${utc(Date.now())}`,
      `DTSTART:${utc(start)}`,
      `DTEND:${utc(start + 15 * 60_000)}`,
      "SUMMARY:Standup",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:Standup",
      "TRIGGER:-PT15M",
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  });
  if (response.status >= 300) throw new Error(`PUT standup: ${response.status}`);
}

test("with the window closed, a server's change arrives on resume and its missed reminder shows, late; a click opens its details", async ({
  radicale,
}) => {
  // The page's clock runs as the main process's: a reminder's time is the same to both.
  const { app, page, work } = await signedIn(radicale, { realClock: true });
  // Notifications as the system would show them: heard in the main process.
  await app.evaluate(({ Notification }) => {
    const state = globalThis as { notified?: Promise<{ title: string; body: string }> };
    state.notified = new Promise((resolve) => {
      Notification.prototype.show = function (this: Notification) {
        (globalThis as { notification?: Notification }).notification = this;
        resolve({ title: this.title, body: this.body });
      };
    });
  });
  expect(await closeWindow(app)).toEqual({ visible: false, destroyed: false });

  // Meanwhile, on another device: an event five minutes from now, whose
  // reminder came due ten minutes ago, while this machine slept.
  await putEventWithReminder(radicale, work, Date.now() + 5 * 60_000);
  await app.evaluate(({ powerMonitor }) => void powerMonitor.emit("resume"));
  const notified = await app.evaluate(
    () => (globalThis as { notified?: Promise<{ title: string; body: string }> }).notified,
  );
  expect(notified!.title).toBe("Standup");
  expect(notified!.body).toMatch(/ · reminder due at /);

  // A click brings the window back on the occurrence's details (foundation D101).
  const { shown } = await whenShown(app);
  await app.evaluate(() =>
    (globalThis as { notification?: { emit(event: string): void } }).notification!.emit("click"),
  );
  expect(await shown()).toBe(true);
  await expect(page.getByRole("dialog", { name: "Standup" })).toBeVisible();
  await app.close();
});
