// Credentials on the desktop (docs/plans/desktop.md#D74), end to end: with a
// keyring the password is saved encrypted and the account stays signed in
// across a restart; an entry the keyring no longer decrypts asks to sign in
// again; without a keyring the app asks before it writes anything, and keeps
// the password as the user chose. The keyring is the test's own
// (`keyringSession`): a session bus with gnome-keyring, never the user's.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { test as base, expect, type Page } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import {
  keepPassword,
  keyringSession,
  launch,
  profile,
  putEvent,
  signInByPassword,
  type Keyring,
} from "./support.ts";

const test = base.extend<{ radicale: CalDavServer; keyring: Keyring }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  keyring: async ({}, use) => {
    const keyring = await keyringSession();
    await use(keyring);
    await keyring.stop();
  },
});

const wednesday = (page: Page) => page.getByRole("list", { name: "Wednesday, November 4" });
const promptOf = (page: Page) =>
  page.getByRole("alertdialog", { name: "No keyring to keep your password safe" });
const accountOf = (page: Page, server: CalDavServer) =>
  page.getByRole("region", { name: `${server.username}@${new URL(server.url).host}` });

/** `secrets.json` in the profile, as the main process wrote it. */
function secretsOf(userData: string): {
  secrets: Record<string, { saved: string; value: string }>;
} {
  return JSON.parse(readFileSync(join(userData, "secrets.json"), "utf8"));
}

test("with a keyring the password is saved encrypted and survives a restart; another keyring asks to sign in again", async ({
  radicale,
  keyring,
}) => {
  const work = await radicale.mkcalendar("work");
  await putEvent(radicale, work, "planning", "Planning", "20261104T090000", "20261104T100000");
  const userData = profile();

  const first = await launch(userData, { keyring });
  await signInByPassword(first.page, radicale);
  // No question: the keyring protects it. The sign-in dialog closes.
  await expect(first.page.getByRole("dialog")).toHaveCount(0);
  await expect(first.page.getByRole("alertdialog")).toHaveCount(0);
  await expect(wednesday(first.page).getByRole("listitem", { name: /^Planning, / })).toBeVisible();
  // One entry, saved in the keyring's care: ciphertext under the keyring's key (`v11`).
  const [entry, ...others] = Object.values(secretsOf(userData).secrets);
  expect(others).toEqual([]);
  expect(entry?.saved).toBe("keyring");
  const ciphertext = Buffer.from(entry!.value, "base64");
  expect(ciphertext.subarray(0, 3).toString()).toBe("v11");
  expect(ciphertext.toString("latin1")).not.toContain(radicale.password);
  await first.app.close();

  // A restart: the account syncs with the saved password, so another
  // client's event made meanwhile arrives.
  await putEvent(radicale, work, "review", "Review", "20261104T140000", "20261104T150000");
  const second = await launch(userData, { keyring });
  await expect(wednesday(second.page).getByRole("listitem", { name: /^Review, / })).toBeVisible();
  await expect(accountOf(second.page, radicale).getByText(/^Synced at /)).toBeVisible();
  await second.app.close();

  // The keyring gone (as on another machine, or a changed keyring): the
  // entry does not decrypt, and the account asks to sign in again; its items stay.
  const third = await launch(userData);
  await expect(
    accountOf(third.page, radicale).getByText("Signed out: sign in again to sync"),
  ).toBeVisible();
  await expect(wednesday(third.page).getByRole("listitem", { name: /^Review, / })).toBeVisible();
  await third.app.close();
  // The entry stays for the keyring that may come back.
  expect(Object.values(secretsOf(userData).secrets)).toEqual([entry]);
});

test("without a keyring the app asks before saving, writes nothing until the user picks, and keeps the password as picked", async ({
  radicale,
}) => {
  await radicale.mkcalendar("work");
  const userData = profile();
  const secretsFile = join(userData, "secrets.json");

  // Keep until the app quits: never written; after a restart, signed out.
  const first = await launch(userData);
  await signInByPassword(first.page, radicale);
  await expect(promptOf(first.page)).toBeVisible();
  expect(existsSync(secretsFile)).toBe(false);
  await keepPassword(first.page, "Keep until AstroTime quits");
  await expect(first.page.getByRole("dialog")).toHaveCount(0);
  await expect(accountOf(first.page, radicale).getByText(/^Synced at /)).toBeVisible();
  expect(existsSync(secretsFile)).toBe(false);
  await first.app.close();

  // Signed out after the restart; signing in again, saved unprotected.
  const second = await launch(userData);
  const account = accountOf(second.page, radicale);
  await expect(account.getByText("Signed out: sign in again to sync")).toBeVisible();
  await account
    .getByRole("button", { name: `Options for ${radicale.username}@${new URL(radicale.url).host}` })
    .click();
  await second.page.getByRole("menuitem", { name: "Sign in again" }).click();
  const dialog = second.page.getByRole("dialog", { name: "Sign in again" });
  await dialog.getByLabel("Password").fill(radicale.password);
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect(promptOf(second.page)).toBeVisible();
  expect(existsSync(secretsFile)).toBe(false);
  await keepPassword(second.page, "Save unprotected");
  await expect(account.getByText(/^Synced at /)).toBeVisible();
  // Recorded as unprotected, so it is never taken for ciphertext.
  expect(Object.values(secretsOf(userData).secrets)).toEqual([
    { saved: "unprotected", value: expect.stringContaining(radicale.password) },
  ]);
  await second.app.close();

  // Saved: after a restart the account syncs without asking.
  const third = await launch(userData);
  await expect(accountOf(third.page, radicale).getByText(/^Synced at /)).toBeVisible();
  await expect(third.page.getByRole("alertdialog")).toHaveCount(0);
  await third.app.close();
});
