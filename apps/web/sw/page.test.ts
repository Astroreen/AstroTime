// What the service worker reads of the page (docs/plans/foundation.md#D124).
import * as caldav from "@astrotime/caldav";
import { expect, test } from "vite-plus/test";

import {
  isAppPage,
  namedFiles,
  PRESET_MARK,
  PRESET_META,
  presetOf,
  withoutPreset,
  withPresetBack,
} from "./page.ts";

test("the worker knows the preset by the names the server writes it under", () => {
  expect([PRESET_MARK, PRESET_META]).toEqual([caldav.PRESET_MARK, caldav.PRESET_META]);
});

const page = `<!doctype html><html><head><meta name="csp-nonce" nonce="n" /><title>AstroTime</title></head><body><script type="module" src="/assets/index-a1.js"></script></body></html>`;

test("the preset is left out of the kept page, marked by the server or written otherwise (D123)", () => {
  const marked = caldav.withPreset(page, {
    server: "https://cloud.example.com/",
    username: "astro",
  });
  expect(marked).toContain(PRESET_MARK.start);
  expect(withoutPreset(marked)).toBe(page);
  // Unmarked, in any attribute order, quoting and closing.
  for (const tag of [
    `<meta name="astrotime-server" content="https://cloud.example.com/" />`,
    `<meta content="astro" name="astrotime-username">`,
    `<META NAME='astrotime-server' CONTENT='x'/>`,
    `<meta name=astrotime-username content=astro>`,
  ]) {
    expect(withoutPreset(page.replace("</head>", `${tag}</head>`))).toBe(page);
  }
  // Another meta with a name that only begins alike stays.
  const other = page.replace("</head>", `<meta name="astrotime-server-x" content="y" /></head>`);
  expect(withoutPreset(other)).toBe(other);
});

test("the files a page names are its own paths, not other origins' or protocol-relative ones", () => {
  expect(
    namedFiles(
      `${page}<link rel="manifest" href="/manifest.webmanifest" /><link rel="icon" href='/icon.svg?v=1' /><script src="//cdn.example.com/x.js"></script><a href="https://example.com/">x</a>`,
    ),
  ).toEqual(["/assets/index-a1.js", "/manifest.webmanifest", "/icon.svg"]);
});

test("only the app's own pages are its navigations: never CalDAV's proxy, the health check or a file", () => {
  for (const path of ["/", "/day/2026-11-04", "/settings"]) expect(isAppPage(path, "/")).toBe(true);
  for (const path of [
    "/dav-proxy/https%3A%2F%2Fcloud.example.com/remote.php/dav/",
    "/dav-proxy",
    "/healthz",
    "/manifest.webmanifest",
    "/assets/index-a1.js",
  ])
    expect(isAppPage(path, "/")).toBe(false);
  // Under a base path, only below it.
  expect(isAppPage("/calendar/day/2026-11-04", "/calendar/")).toBe(true);
  expect(isAppPage("/other/", "/calendar/")).toBe(false);
  expect(isAppPage("/calendar/dav-proxy/x", "/calendar/")).toBe(false);
});

test("the preset is kept apart and given back to the kept page as the network page had it (D123)", () => {
  const marked = caldav.withPreset(page, {
    server: "https://cloud.example.com/$'",
    username: "astro",
  });
  const preset = presetOf(marked);
  expect(preset).toBe(
    caldav.presetTags({ server: "https://cloud.example.com/$'", username: "astro" }),
  );
  expect(withPresetBack(withoutPreset(marked), preset)).toBe(marked);
  // An unmarked tag is given back too; a page without one gets nothing back.
  const loose = `<meta content="astro" name="astrotime-username">`;
  expect(presetOf(page.replace("</head>", `${loose}</head>`))).toBe(loose);
  expect(presetOf(page)).toBe("");
  expect(withPresetBack(page, "")).toBe(page);
});
