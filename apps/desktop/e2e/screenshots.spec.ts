// The evidence for desktop PR D1 (docs/plans/desktop.md#pr-d1--the-shell-the-store-and-http):
// the window with a Radicale account signed in, in both themes; and for PR
// D2, the question asked where no keyring protects the password (D74); for
// PR D3, Settings with "Keep running when the window is closed"
// (D75); for assistant PR AS4, Settings → Assistants with its log
// (docs/plans/assistant.md#D308, D310, D311). The Login Flow's waiting state is taken by login-flow.spec.ts. Runs only when
// ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots xvfb-run -a -s "-screen 0 1440x900x24" \
//     pnpm --filter @astrotime/desktop e2e screenshots
import { join } from "node:path";

import { expect, test } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { startRadicale } from "../../../packages/sync/test/servers.ts";
import { choose, keepPassword, launch, profile, putEvent, signInByPassword } from "./support.ts";

const directory = process.env["ASTROTIME_SCREENSHOTS"];
test.skip(!directory, "set ASTROTIME_SCREENSHOTS to a directory to take the screenshots");

test("the window, signed in to Radicale, dark and light", async () => {
  const radicale = await startRadicale();
  const work = await radicale.mkcalendar("Work");
  const personal = await radicale.mkcalendar("Personal");
  await putEvent(radicale, work, "planning", "Planning", "20261102T093000", "20261102T110000");
  await putEvent(
    radicale,
    personal,
    "lunch",
    "Lunch with Marta",
    "20261103T130000",
    "20261103T140000",
  );
  await putEvent(radicale, work, "review", "Code review", "20261104T140000", "20261104T153000");
  await putEvent(radicale, personal, "dentist", "Dentist", "20261105T083000", "20261105T093000");
  await putEvent(radicale, work, "notes", "Release notes", "20261106T110000", "20261106T120000");

  const { app, page } = await launch(profile());
  await signInByPassword(page, radicale);
  await keepPassword(page, "Keep until AstroTime quits");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("listitem", { name: /^Release notes, / })).toBeVisible();
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: join(directory!, `desktop-week-${theme}.png`) });
  }
  await app.close();
  await radicale.stop();
});

test("the question without a keyring, dark and light", async () => {
  const radicale = await startRadicale();
  await radicale.mkcalendar("Work");
  const { app, page } = await launch(profile());
  await signInByPassword(page, radicale);
  const prompt = page.getByRole("alertdialog", { name: "No keyring to keep your password safe" });
  await expect(prompt).toBeVisible();
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({
      path: join(directory!, `desktop-unprotected-${theme}.png`),
      // Once the dialog has finished opening, not through its fade.
      animations: "disabled",
    });
  }
  await keepPassword(page, "Keep until AstroTime quits");
  await app.close();
  await radicale.stop();
});

test("Settings with the desktop's keep-running switch, English dark and Russian light", async () => {
  const radicale = await startRadicale();
  await radicale.mkcalendar("Work");
  const { app, page } = await launch(profile());
  await signInByPassword(page, radicale);
  await keepPassword(page, "Keep until AstroTime quits");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await settings.getByRole("switch", { name: "Keep running when the window is closed" }).focus();
  await page.screenshot({ path: join(directory!, "desktop-settings-keep-running-dark-en.png") });
  await choose(page.getByLabel("Language"), "Русский");
  await choose(page.getByLabel("Тема"), "Светлая");
  const russian = page.getByRole("dialog", { name: "Настройки" });
  await russian.getByRole("switch", { name: "Работать в фоне после закрытия окна" }).focus();
  await page.screenshot({ path: join(directory!, "desktop-settings-keep-running-light-ru.png") });
  await app.close();
  await radicale.stop();
});

test("Settings → Assistants with a configuration and the log, dark and light", async () => {
  const radicale = await startRadicale();
  await radicale.mkcalendar("Work");
  const { app, page } = await launch(profile());
  await signInByPassword(page, radicale);
  await keepPassword(page, "Keep until AstroTime quits");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByText("Work", { exact: true })).toBeVisible();
  await settings.getByRole("switch", { name: "Let AI assistants in (MCP)" }).click();
  const url = await settings
    .getByRole("group", { name: "Address" })
    .getByText(/^http:/)
    .textContent();
  const token = await settings
    .getByRole("group", { name: "Token" })
    .getByText(/^[\w-]{43}$/)
    .textContent();

  // An assistant's morning: a meeting made and moved, a task made and done.
  const client = new Client({ name: "screenshots", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url!), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const tool = async (name: string, args: Record<string, unknown>) =>
    (await client.callTool({ name, arguments: args })).structuredContent as { id: string };
  const { calendars } = (await client.callTool({ name: "list_calendars", arguments: {} }))
    .structuredContent as { calendars: { id: string; name: string }[] };
  const work = calendars.find((calendar) => calendar.name === "Work")!.id;
  const review = await tool("create_event", {
    calendarId: work,
    summary: "Design review",
    start: "2026-11-05T11:00",
  });
  await tool("change_item", { id: review.id, start: "2026-11-05T15:00" });
  const bread = await tool("create_task", {
    calendarId: work,
    summary: "Buy bread",
    due: "2026-11-04",
  });
  await tool("complete_task", { id: bread.id });
  await client.close();

  await settings.getByRole("button", { name: "Copy a configuration for…" }).click();
  await page.getByRole("menuitem", { name: "Claude Code" }).click();
  const group = settings.getByRole("region", { name: "Assistants" });
  await expect(
    group.getByRole("region", { name: "Changed by an assistant" }).getByRole("listitem"),
  ).toHaveCount(4);
  // The group, then its log, each whole on the screen.
  const log = group.getByRole("region", { name: "Changed by an assistant" });
  for (const theme of ["dark", "light"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await group.getByRole("switch").scrollIntoViewIfNeeded();
    await group.screenshot({
      path: join(directory!, `desktop-assistants-${theme}.png`),
      animations: "disabled",
    });
    await log.screenshot({
      path: join(directory!, `desktop-assistants-log-${theme}.png`),
      animations: "disabled",
    });
  }
  await app.close();
  await radicale.stop();
});
