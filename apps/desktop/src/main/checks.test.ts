// What the main process takes from the page (docs/plans/desktop.md#D71): a
// request it can send as it is, nothing that would go elsewhere or split it.
import { expect, test } from "vite-plus/test";

import {
  checkReminders,
  checkRequest,
  checkSecret,
  checkSecretKey,
  checkShellState,
  isAppUrl,
  isWebUrl,
} from "./checks.ts";

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

const reminder = {
  id: "obj/-/0/1",
  objectId: "obj",
  fireAt: 1_700_000_000_000,
  notification: { title: "Call", body: "11:15 – 11:45 · in 15 minutes", late: "…" },
};

test("the page's reminders pass as they came, each with an id, a time and its words", () => {
  expect(checkReminders([reminder])).toEqual([reminder]);
  expect(checkReminders([])).toEqual([]);
  const refused: unknown[] = [
    null,
    reminder,
    Array.from({ length: 101 }, () => reminder),
    [null],
    [{ ...reminder, id: 7 }],
    [{ ...reminder, fireAt: "soon" }],
    [{ ...reminder, fireAt: Number.NaN }],
    [{ ...reminder, notification: null }],
    [{ ...reminder, notification: { title: "Call" } }],
    [{ ...reminder, notification: { ...reminder.notification, late: 1 } }],
  ];
  for (const value of refused) expect(() => checkReminders(value)).toThrow(TypeError);
});

test("the shell's state is a theme, whether to keep running, and its words", () => {
  const state = {
    theme: "dark",
    keepRunning: false,
    words: { open: "Open", syncNow: "Sync now", closeWindow: "Close window", quit: "Quit" },
  };
  expect(checkShellState({ ...state, extra: 1 })).toEqual(state);
  const refused: unknown[] = [
    null,
    { ...state, theme: "sepia" },
    { ...state, keepRunning: "yes" },
    { ...state, words: null },
    { ...state, words: { ...state.words, quit: 1 } },
    { ...state, words: { ...state.words, open: "x".repeat(257) } },
  ];
  for (const value of refused) expect(() => checkShellState(value)).toThrow(TypeError);
});
