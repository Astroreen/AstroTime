// The evidence for desktop PR D1 (docs/plans/desktop.md#pr-d1--the-shell-the-store-and-http):
// the window with a Radicale account signed in, in both themes; and for PR
// D2, the question asked where no keyring protects the password (D74). The
// Login Flow's waiting state is taken by login-flow.spec.ts. Runs only when
// ASTROTIME_SCREENSHOTS names a directory:
//
//   ASTROTIME_SCREENSHOTS=/tmp/shots xvfb-run -a -s "-screen 0 1440x900x24" \
//     pnpm --filter @astrotime/desktop e2e screenshots
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { startRadicale } from "../../../packages/sync/test/servers.ts";
import { keepPassword, launch, profile, putEvent, signInByPassword } from "./support.ts";

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
