// An inline attachment saved on the desktop (design D230): the details'
// "Save" downloads it through Electron, which asks where; here the test
// answers for the user with a path, and reads what was written.
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { test as base, expect } from "@playwright/test";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { keepPassword, launch, profile, signInByPassword } from "./support.ts";

const test = base.extend<{ radicale: CalDavServer }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
});

test("an inline attachment is saved where the user says", async ({ radicale }) => {
  const work = await radicale.mkcalendar("work");
  const put = await fetch(`${work}planning.ics`, {
    method: "PUT",
    headers: {
      Authorization: `Basic ${btoa(`${radicale.username}:${radicale.password}`)}`,
      "Content-Type": "text/calendar",
    },
    body: [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Another client//EN",
      "BEGIN:VEVENT",
      "UID:planning",
      "DTSTAMP:20261101T080000Z",
      "DTSTART;TZID=Europe/Vilnius:20261104T140000",
      "DTEND;TZID=Europe/Vilnius:20261104T150000",
      "SUMMARY:Planning",
      "ATTACH;ENCODING=BASE64;VALUE=BINARY;FMTTYPE=text/plain;FILENAME=agenda.txt:MS4gQnVkZ2V0Cg==",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  });
  expect(put.status).toBeLessThan(300);
  const userData = profile();
  const { app, page } = await launch(userData);
  await signInByPassword(page, radicale);
  await keepPassword(page, "Keep until AstroTime quits");

  // Where the user would answer Electron's "Save as": a file in the profile.
  const target = join(userData, "agenda.txt");
  const saved = app.evaluate(
    ({ session }, path) =>
      new Promise<string>((resolve) => {
        session.defaultSession.once("will-download", (_event, item) => {
          item.setSavePath(path);
          item.once("done", (_done, state) => resolve(`${item.getFilename()} ${state}`));
        });
      }),
    target,
  );
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Planning, / })
    .click();
  await page
    .getByRole("dialog", { name: "Planning" })
    .getByRole("button", { name: "Save agenda.txt" })
    .click();
  expect(await saved).toBe("agenda.txt completed");
  expect(readFileSync(target, "utf8")).toBe("1. Budget\n");
  await app.close();
});
