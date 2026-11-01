// What the main process takes from the page (docs/plans/desktop.md#D71): a
// request it can send as it is, nothing that would go elsewhere or split it.
import { expect, test } from "vite-plus/test";

import { checkRequest, checkSecret, checkSecretKey, isAppUrl, isWebUrl } from "./checks.ts";

const request = { method: "PROPFIND", url: "https://dav.example/", headers: { Depth: "0" } };

test("a CalDAV request passes as it is, with any method and a body or none", () => {
  expect(checkRequest(request)).toEqual(request);
  const report = { ...request, method: "REPORT", body: "<x/>" };
  expect(checkRequest({ ...report, extra: "dropped" })).toEqual(report);
});

test("anything that is not one http(s) request is refused", () => {
  const refused: unknown[] = [
    null,
    "GET https://dav.example/",
    { ...request, method: "GET /evil HTTP/1.1\r\nHost: x" },
    { ...request, method: 7 },
    { ...request, url: "file:///etc/hostname" },
    { ...request, url: "app://astrotime/" },
    { ...request, url: "not a url" },
    { ...request, url: "https://user:secret@dav.example/" },
    { ...request, headers: null },
    { ...request, headers: [["Depth", "0"]] },
    { ...request, headers: { Depth: 0 } },
    { ...request, headers: { "Bad Name": "x" } },
    { ...request, headers: { Depth: "0\r\nX-Injected: 1" } },
    { ...request, headers: { Host: "elsewhere.example" } },
    { ...request, headers: { Cookie: "session=1" } },
    { ...request, headers: { "Content-Length": "999" } },
    { ...request, body: { xml: "<x/>" } },
  ];
  for (const value of refused) expect(() => checkRequest(value)).toThrow(TypeError);
});

test("the app's own pages are app://astrotime/ only; the browser opens http(s) only", () => {
  expect(isAppUrl("app://astrotime/")).toBe(true);
  expect(isAppUrl("app://astrotime/assets/index.js")).toBe(true);
  expect(isAppUrl("app://elsewhere/")).toBe(false);
  expect(isAppUrl("https://astrotime/")).toBe(false);
  expect(isWebUrl("https://cloud.example/login/v2/flow")).toBe(true);
  expect(isWebUrl("http://192.168.1.2:5232/")).toBe(true);
  expect(isWebUrl("file:///etc/hostname")).toBe(false);
  expect(isWebUrl("javascript:alert(1)")).toBe(false);
});

test("a secret's key, value and saving are checked; nothing else passes (D74)", () => {
  expect(checkSecretKey("account:7")).toBe("account:7");
  expect(checkSecret('{"username":"astro"}', "keyring")).toEqual([
    '{"username":"astro"}',
    "keyring",
  ]);
  expect(checkSecret("", "until-quit")).toEqual(["", "until-quit"]);
  for (const key of [undefined, 7, "", "k".repeat(257)]) {
    expect(() => checkSecretKey(key)).toThrow(TypeError);
  }
  expect(() => checkSecret(7, "keyring")).toThrow(TypeError);
  expect(() => checkSecret("x".repeat(65_537), "keyring")).toThrow(TypeError);
  expect(() => checkSecret("x", "plain")).toThrow(TypeError);
  expect(() => checkSecret("x", undefined)).toThrow(TypeError);
});
