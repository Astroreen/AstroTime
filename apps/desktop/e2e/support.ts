import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron, type ElectronApplication, type Page } from "@playwright/test";

import type { CalDavServer } from "../../../packages/sync/test/servers.ts";

/** The day the specs see, as the web's e2e has it: a Wednesday, mid-morning in Vilnius. */
const NOW = new Date("2026-11-04T10:40:00+02:00");

/** Outside Electron, the `electron` package names its binary: the dev shell's nixpkgs one, or CI's. */
const executablePath = createRequire(import.meta.url)("electron") as string;
const appDir = fileURLToPath(new URL("..", import.meta.url));

/** A fresh profile: the app's userData, with its store. */
export const profile = () => mkdtempSync(join(tmpdir(), "astrotime-desktop-"));

/**
 * Starts the built app on the profile `userData` and returns its window,
 * showing the app with the clock frozen at `NOW`.
 */
export async function launch(
  userData: string,
  options: { env?: Record<string, string> } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    executablePath,
    args: [appDir, `--user-data-dir=${userData}`, "--lang=en-US"],
    env: { ...process.env, TZ: "Europe/Vilnius", LANG: "en_US.UTF-8", ...options.env },
    colorScheme: "dark",
  });
  const page = await app.firstWindow();
  // The first load ends before the reload that brings the frozen clock in;
  // a reload over a load still going is aborted (net::ERR_ABORTED).
  await page.waitForLoadState("load");
  await page.clock.setFixedTime(NOW);
  await page.reload();
  return { app, page };
}

/** Signs in on the first-run screen, as a user would. */
export async function signInByPassword(page: Page, server: CalDavServer): Promise<void> {
  await page.getByRole("button", { name: "Another CalDAV server" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an account" });
  await dialog.getByRole("textbox", { name: "Server address" }).fill(server.url);
  await dialog.getByRole("textbox", { name: "User name" }).fill(server.username);
  await dialog.getByLabel("Password").fill(server.password);
  await dialog.getByRole("button", { name: "Sign in" }).click();
}

/** Puts an event on a calendar of `server`, as another client would. */
export async function putEvent(
  server: CalDavServer,
  calendarUrl: string,
  uid: string,
  summary: string,
  start: string,
  end: string,
): Promise<void> {
  const response = await fetch(`${calendarUrl}${uid}.ics`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${btoa(`${server.username}:${server.password}`)}`,
      "Content-Type": "text/calendar",
    },
    body: `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Another client//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T080000Z\r\nDTSTART;TZID=Europe/Vilnius:${start}\r\nDTEND;TZID=Europe/Vilnius:${end}\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`,
  });
  if (response.status >= 300) throw new Error(`PUT ${uid}: ${response.status}`);
}
