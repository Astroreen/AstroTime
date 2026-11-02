// An account's Nextcloud files (docs/plans/foundation.md#D231), from the
// listings a real Nextcloud answered (fixtures/README.md): folders first,
// each file with the ATTACH Nextcloud Calendar writes for it.
import { readFileSync } from "node:fs";

import { expect, test } from "vite-plus/test";

import { filesOf } from "../src/files.ts";
import type { HttpClient, HttpRequest } from "../src/index.ts";

const HOME = "https://cloud.example.com/remote.php/dav/calendars/astrotime-test/";

/** Files whose server answers every request with a recorded listing, the requests kept. */
function serving(fixture: string, home = HOME) {
  const body = readFileSync(new URL(`fixtures/${fixture}`, import.meta.url), "utf8");
  const asked: HttpRequest[] = [];
  const http: HttpClient = async (request) => {
    asked.push(request);
    return { status: 207, url: request.url, header: () => null, body };
  };
  return { files: filesOf(http, { username: "u", password: "p" }, home), asked };
}

test("the top of the files: folders first, by name, then the files, the folder itself left out", async () => {
  const { files, asked } = serving("nextcloud-files-root.xml");
  const list = await files!.list("/");
  expect(list.map((file) => [file.name, file.folder])).toEqual([
    ["Calendar", true],
    ["Documents", true],
    ["Photos", true],
    ["Templates", true],
    ["Общее", true],
    ["Nextcloud intro.mp4", false],
    ["Nextcloud Manual.pdf", false],
    ["Nextcloud.png", false],
    ["Readme.md", false],
    ["Reasons to use Nextcloud.pdf", false],
    ["Templates credits.md", false],
  ]);
  expect(list.filter((file) => file.folder).every((file) => file.attachment === null)).toBe(true);
  expect(asked).toMatchObject([
    {
      method: "PROPFIND",
      url: "https://cloud.example.com/remote.php/dav/files/astrotime-test/",
      headers: { Depth: "1", Authorization: `Basic ${btoa("u:p")}` },
    },
  ]);
});

test("a file becomes Nextcloud Calendar's ATTACH: its link by id, its path, type, size and Nextcloud's own parameters", async () => {
  const { files, asked } = serving("nextcloud-files-calendar.xml");
  const list = await files!.list("/Calendar");
  expect(asked[0]!.url).toBe(
    "https://cloud.example.com/remote.php/dav/files/astrotime-test/Calendar/",
  );
  expect(list).toEqual([
    {
      path: "/Calendar/AstroTime fixture.txt",
      name: "AstroTime fixture.txt",
      folder: false,
      type: "text/plain",
      size: 17,
      attachment: {
        uri: "https://cloud.example.com/index.php/f/1041771",
        name: "/Calendar/AstroTime fixture.txt",
        type: "text/plain",
        size: 17,
        parameters: { "X-NC-FILE-ID": "1041771", "X-NC-HAS-PREVIEW": "true" },
      },
    },
  ]);
});

test("a folder's path is asked for part by part, encoded; a server under a path keeps it", async () => {
  const { files, asked } = serving(
    "nextcloud-files-calendar.xml",
    "https://example.com/nextcloud/remote.php/dav/calendars/astrotime-test/",
  );
  await files!.list("/Photos/Trip #1");
  expect(asked[0]!.url).toBe(
    "https://example.com/nextcloud/remote.php/dav/files/astrotime-test/Photos/Trip%20%231/",
  );
});

test("a calendar home that is not Nextcloud's has no files", async () => {
  const { files } = serving("nextcloud-files-root.xml", "https://dav.example.com/astro/");
  expect(files).toBeNull();
});
