// What the user may do in each calendar, read from the privilege sets real
// servers answer with (docs/plans/foundation.md#D37); the files and where
// they come from: fixtures/README.md.
import { readFileSync } from "node:fs";

import { expect, test } from "vite-plus/test";

import { CalDavProvider, type HttpClient } from "../src/index.ts";

const ALL = { create: true, edit: true, delete: true };
const NONE = { create: false, edit: false, delete: false };

/** The rights of each calendar in a recorded calendar home, by the last segment of its URL. */
async function rightsIn(fixture: string, home: string) {
  const body = readFileSync(new URL(`fixtures/${fixture}`, import.meta.url), "utf8");
  const http: HttpClient = async (request) => ({
    status: 207,
    url: request.url,
    header: () => null,
    body,
  });
  const provider = new CalDavProvider(http, { username: "u", password: "p" }, home);
  return Object.fromEntries(
    (await provider.calendars()).map((c) => [new URL(c.url).pathname.split("/").at(-2), c.rights]),
  );
}

test("Nextcloud: the owner may do everything in each of their calendars, shared or not", async () => {
  expect(
    await rightsIn("nextcloud-owner.xml", "https://cloud.example/remote.php/dav/calendars/astro/"),
  ).toEqual({ personal: ALL, "shared-ro": ALL, "shared-rw": ALL });
});

test("Nextcloud: a read-only share grants nothing (its write-properties is the calendar's, not its items'); a read-write share everything", async () => {
  expect(
    await rightsIn(
      "nextcloud-shares.xml",
      "https://cloud.example/remote.php/dav/calendars/reader/",
    ),
  ).toEqual({
    personal: ALL,
    "shared-ro_shared_by_astro": NONE,
    "shared-rw_shared_by_astro": ALL,
  });
});

test("Radicale: `all` without its parts listed is every right; a calendar with rights `r` is read-only", async () => {
  expect(await rightsIn("radicale.xml", "https://dav.example/astro/")).toEqual({
    personal: ALL,
    readonly: NONE,
  });
});

test("write-content alone edits; bind adds; unbind deletes; read-free-busy grants nothing; an unreported set is every right", async () => {
  expect(
    await rightsIn("write-content-only.xml", "https://dav.example/dav/calendars/user/"),
  ).toEqual({
    "edit-only": { create: false, edit: true, delete: false },
    "no-delete": { create: true, edit: true, delete: false },
    "free-busy": NONE,
    silent: ALL,
  });
});
