// The app's files on app://astrotime/ (docs/plans/desktop.md#D71): the page
// with its policy and a fresh nonce each time, the files under the renderer's
// folder and nothing outside it.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

import { appFiles } from "./app-protocol.ts";

function renderer() {
  const parent = mkdtempSync(join(tmpdir(), "astrotime-renderer-"));
  writeFileSync(join(parent, "secret.txt"), "outside");
  const root = join(parent, "renderer");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(
    join(root, "index.html"),
    '<meta property="csp-nonce" nonce="astrotime-csp-nonce"><script nonce="astrotime-csp-nonce" src="/assets/app.js"></script>',
  );
  writeFileSync(join(root, "assets", "app.js"), "console.log(1)");
  return appFiles(root);
}

const get = (serve: ReturnType<typeof appFiles>, url: string, method = "GET") =>
  serve(new Request(url, { method }));

test("the page comes with the desktop's policy and a fresh nonce in it and in its tags", async () => {
  const serve = renderer();
  const first = await get(serve, "app://astrotime/");
  const policy = first.headers.get("content-security-policy") ?? "";
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  expect(policy).toMatch(/^default-src 'none'; script-src 'self'; style-src 'self' 'nonce-/);
  expect(policy).not.toContain("connect-src");
  expect(first.headers.get("content-type")).toBe("text/html; charset=utf-8");
  const page = await first.text();
  expect(page.match(/nonce="([^"]+)"/g)).toEqual([`nonce="${nonce}"`, `nonce="${nonce}"`]);
  const second = await get(serve, "app://astrotime/index.html");
  expect(second.headers.get("content-security-policy")).not.toBe(policy);
});

test("a file of the renderer comes as itself; anything else is not found", async () => {
  const serve = renderer();
  const script = await get(serve, "app://astrotime/assets/app.js");
  expect([script.status, script.headers.get("content-type"), await script.text()]).toEqual([
    200,
    "text/javascript; charset=utf-8",
    "console.log(1)",
  ]);
  for (const url of [
    "app://astrotime/missing.js",
    "app://astrotime/%2e%2e/secret.txt",
    "app://astrotime/assets/%2e%2e%2f%2e%2e%2fsecret.txt",
    "app://astrotime/%E0%A4%A",
    "app://elsewhere/index.html",
  ]) {
    expect([url, (await get(serve, url)).status]).toEqual([url, 404]);
  }
  expect((await get(serve, "app://astrotime/", "POST")).status).toBe(405);
});
