import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { _electron, expect, type ElectronApplication, type Page } from "@playwright/test";

import type { CalDavServer } from "../../../packages/sync/test/servers.ts";

/** The day the specs see, as the web's e2e has it: a Wednesday, mid-morning in Vilnius. */
const NOW = new Date("2026-11-04T10:40:00+02:00");

/** Outside Electron, the `electron` package names its binary: the dev shell's nixpkgs one, or CI's. */
const executablePath = createRequire(import.meta.url)("electron") as string;
const appDir = fileURLToPath(new URL("..", import.meta.url));

/** A fresh profile: the app's userData, with its store. */
export const profile = () => mkdtempSync(join(tmpdir(), "astrotime-desktop-"));

/** A keyring of the test's own: a session bus with gnome-keyring's Secret Service on it. */
export interface Keyring {
  /** What the app needs to reach it. */
  readonly env: Record<string, string>;
  stop(): Promise<void>;
}

/**
 * Starts a D-Bus session bus and an unlocked gnome-keyring on it, in a
 * directory of their own: the app's keyring in the tests, never the user's.
 * Each step is awaited by what says it is done: the bus prints its address
 * once it listens, and gnome-keyring's first process exits once its daemon
 * serves the Secret Service.
 */
export async function keyringSession(): Promise<Keyring> {
  const home = mkdtempSync(join(tmpdir(), "astrotime-keyring-"));
  const config = join(home, "session.conf");
  writeFileSync(
    config,
    `<busconfig><type>session</type><listen>unix:dir=${home}</listen><auth>EXTERNAL</auth>` +
      `<policy context="default"><allow send_destination="*" eavesdrop="true"/>` +
      `<allow eavesdrop="true"/><allow own="*"/></policy></busconfig>`,
  );
  const bus = spawn("dbus-daemon", [`--config-file=${config}`, "--print-address=1", "--nofork"], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [chunk] = (await once(bus.stdout, "data")) as [Buffer];
  const env = { DBUS_SESSION_BUS_ADDRESS: chunk.toString().trim() };
  const keyring = spawn("gnome-keyring-daemon", ["--unlock", "--components=secrets"], {
    env: { ...process.env, ...env, HOME: home, XDG_RUNTIME_DIR: home, XDG_DATA_HOME: home },
    stdio: ["pipe", "ignore", "inherit"],
  });
  keyring.stdin.end("astrotime-test-keyring");
  const [code] = (await once(keyring, "exit")) as [number | null];
  if (code !== 0) throw new Error(`gnome-keyring-daemon exited with ${code}`);
  return {
    env,
    // The keyring's daemon leaves with its bus.
    async stop() {
      const exited = once(bus, "exit");
      bus.kill();
      await exited;
    },
  };
}

/** The app's command line and environment on the profile `userData`. */
function command(userData: string, options: { env?: Record<string, string>; keyring?: Keyring }) {
  const { keyring } = options;
  return {
    args: [
      appDir,
      `--user-data-dir=${userData}`,
      "--lang=en-US",
      `--password-store=${keyring ? "gnome-libsecret" : "basic"}`,
    ],
    env: {
      ...process.env,
      TZ: "Europe/Vilnius",
      LANG: "en_US.UTF-8",
      ...keyring?.env,
      ...options.env,
    },
  };
}

/**
 * Starts the built app on the profile `userData` and returns its window,
 * showing the app with the clock frozen at `NOW` (the main process's clock,
 * and with `realClock` the page's too, run on). Its passwords go to
 * `keyring`, or, without one, nowhere protected (`--password-store=basic`),
 * so a test never reaches the user's own keyring.
 */
export async function launch(
  userData: string,
  options: { env?: Record<string, string>; keyring?: Keyring; realClock?: boolean } = {},
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    executablePath,
    ...command(userData, options),
    colorScheme: "dark",
  });
  const page = await app.firstWindow();
  if (options.realClock) return { app, page };
  // The first load ends before the reload that brings the frozen clock in;
  // a reload over a load still going is aborted (net::ERR_ABORTED).
  await page.waitForLoadState("load");
  await page.clock.setFixedTime(NOW);
  await page.reload();
  return { app, page };
}

/** Launches the app a second time on the same profile, as a user would; resolves with its exit code. */
export async function launchAgain(userData: string): Promise<number | null> {
  const { args, env } = command(userData, {});
  const second = spawn(executablePath, args, { env, stdio: "inherit" });
  const [code] = (await once(second, "exit")) as [number | null];
  return code;
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

/**
 * Without a keyring the app asks how to keep the password before it saves
 * anything (docs/plans/desktop.md#D74); this answers.
 */
export async function keepPassword(
  page: Page,
  choice: "Keep until AstroTime quits" | "Save unprotected",
): Promise<void> {
  const prompt = page.getByRole("alertdialog", { name: "No keyring to keep your password safe" });
  await prompt.getByRole("button", { name: choice }).click();
  await expect(prompt).toHaveCount(0);
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
