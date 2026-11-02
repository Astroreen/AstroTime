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

test("a name whose percent-encoding is broken is shown as it came, not dropped", async () => {
  const body = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:response><d:href>/remote.php/dav/files/astrotime-test/50%25%20off%E0%A4.txt</d:href><d:propstat><d:prop><d:resourcetype/><oc:fileid>7</oc:fileid></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
  const http: HttpClient = async (request) => ({
    status: 207,
    url: request.url,
    header: () => null,
    body,
  });
  const list = await filesOf(http, { username: "u", password: "p" }, HOME)!.list("/");
  expect(list.map((file) => file.name)).toEqual(["50%25%20off%E0%A4.txt"]);
});

test("a file uploaded goes to /Calendar under a name not taken, and comes back as listed (foundation D232)", async () => {
  const asked: { method: string; url: string; headers: Record<string, string>; body: unknown }[] =
    [];
  const taken = new Set(["/remote.php/dav/files/astrotime-test/Calendar/Q3.pdf"]);
  const http: HttpClient = async (request) => {
    asked.push({
      method: request.method,
      url: request.url,
      headers: { ...request.headers },
      body: request.body,
    });
    const path = new URL(request.url).pathname;
    const reply = (status: number, body = "") => ({
      status,
      url: request.url,
      header: () => null,
      body,
    });
    if (request.method === "MKCOL") return reply(405);
    if (request.method === "PUT") return reply(taken.has(path) ? 412 : 201);
    return reply(
      207,
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"><d:response><d:href>${path}</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontenttype>application/pdf</d:getcontenttype><d:getcontentlength>3</d:getcontentlength><oc:fileid>99</oc:fileid><nc:has-preview>false</nc:has-preview></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`,
    );
  };
  const bytes = new Uint8Array([37, 80, 68]);
  const file = await filesOf(http, { username: "u", password: "p" }, HOME)!.upload(
    "Q3.pdf",
    "application/pdf",
    bytes,
  );
  const root = "https://cloud.example.com/remote.php/dav/files/astrotime-test/Calendar";
  expect(asked.map((r) => `${r.method} ${r.url}`)).toEqual([
    `MKCOL ${root}`,
    `PUT ${root}/Q3.pdf`,
    `PUT ${root}/Q3%20(2).pdf`,
    `PROPFIND ${root}/Q3%20(2).pdf`,
  ]);
  // Never over a file there: If-None-Match, the bytes as they are.
  expect(asked[1]!.headers).toMatchObject({
    "If-None-Match": "*",
    "Content-Type": "application/pdf",
  });
  expect(asked[2]!.body).toBe(bytes);
  expect(asked[3]!.headers).toMatchObject({ Depth: "0" });
  expect(file).toMatchObject({
    path: "/Calendar/Q3 (2).pdf",
    name: "Q3 (2).pdf",
    attachment: {
      uri: "https://cloud.example.com/index.php/f/99",
      name: "/Calendar/Q3 (2).pdf",
      parameters: { "X-NC-FILE-ID": "99", "X-NC-HAS-PREVIEW": "false" },
    },
  });
});

test("a name with a slash or a control character is made safe before it is uploaded", async () => {
  const urls: string[] = [];
  const http: HttpClient = async (request) => {
    urls.push(request.url);
    return {
      status: request.method === "MKCOL" ? 201 : 207,
      url: request.url,
      header: () => null,
      body: "<multistatus/>",
    };
  };
  await expect(
    filesOf(http, { username: "u", password: "p" }, HOME)!.upload(
      "a/b\n.txt",
      "text/plain",
      new Uint8Array(),
    ),
  ).rejects.toThrow(/not listed/);
  expect(urls[1]).toBe(
    "https://cloud.example.com/remote.php/dav/files/astrotime-test/Calendar/a_b_.txt",
  );
});
