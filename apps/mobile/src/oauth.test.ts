// Android's OAuth redirect (docs/plans/providers.md#D254), on fakes of the
// Capacitor plugins: the answer at the app's scheme, the tab closed after;
// the tab closed by the user answers nothing.
import { expect, test } from "vite-plus/test";

import { androidOAuth, OAUTH_REDIRECT, type OAuthPlugins } from "./oauth.ts";

function plugins() {
  const listeners = new Map<string, Set<(event: { url: string }) => void>>();
  const opened: string[] = [];
  let closed = 0;
  const add = (event: string, listener: (event: { url: string }) => void) => {
    const set = listeners.get(event) ?? new Set();
    set.add(listener);
    listeners.set(event, set);
    return Promise.resolve({ remove: async () => void set.delete(listener) });
  };
  const fake: OAuthPlugins = {
    app: { addListener: (event, listener) => add(event, listener) },
    browser: {
      open: async ({ url }) => void opened.push(url),
      close: async () => void (closed += 1),
      addListener: (event, listener) => add(event, () => listener()),
    },
  };
  const emit = (event: string, url = "") => {
    // A copy: a listener may remove itself as it hears.
    for (const listener of Array.from(listeners.get(event) ?? [])) listener({ url });
  };
  return {
    fake,
    emit,
    opened,
    closed: () => closed,
    count: (event: string) => listeners.get(event)?.size ?? 0,
  };
}

test("the answer comes back at the app's scheme; the tab closes and the listeners go", async () => {
  const p = plugins();
  const attempt = await androidOAuth(p.fake).begin();
  expect(attempt.redirectUri).toBe(OAUTH_REDIRECT);
  const answer = attempt.open("https://accounts.example/authorize");
  await Promise.resolve();
  expect(p.opened).toEqual(["https://accounts.example/authorize"]);
  // Another link into the app is not the answer.
  p.emit("appUrlOpen", "io.github.astroreen.astrotime:/other");
  p.emit("appUrlOpen", `${OAUTH_REDIRECT}?code=c&state=s`);
  expect(await answer).toBe(`${OAUTH_REDIRECT}?code=c&state=s`);
  expect(p.closed()).toBe(1);
  await Promise.resolve();
  expect(p.count("appUrlOpen")).toBe(0);
});

test("the tab closed by the user, or the sign-in left, answers nothing", async () => {
  const p = plugins();
  const pending: (() => void)[] = [];
  const later = (then: () => void) => void pending.push(then);
  const attempt = await androidOAuth(p.fake, later).begin();
  const answer = attempt.open("https://accounts.example/authorize");
  p.emit("browserFinished");
  // Nothing came after the tab closed: no answer.
  for (const then of pending.splice(0)) then();
  expect(await answer).toBeNull();
  const left = await androidOAuth(p.fake).begin();
  const nothing = left.open("https://accounts.example/authorize");
  left.cancel();
  expect(await nothing).toBeNull();
});

test("the redirect that closed the tab wins, though Android told the tab closed first", async () => {
  const p = plugins();
  const pending: (() => void)[] = [];
  const attempt = await androidOAuth(p.fake, (then) => void pending.push(then)).begin();
  const answer = attempt.open("https://accounts.example/authorize");
  p.emit("browserFinished");
  p.emit("appUrlOpen", `${OAUTH_REDIRECT}?code=c&state=s`);
  // The grace runs out after the answer: it changes nothing.
  for (const then of pending.splice(0)) then();
  expect(await answer).toBe(`${OAUTH_REDIRECT}?code=c&state=s`);
});

test("a tab that cannot open ends the sign-in, with nothing left listening", async () => {
  const p = plugins();
  const failing: OAuthPlugins = {
    ...p.fake,
    browser: { ...p.fake.browser, open: () => Promise.reject(new Error("no browser")) },
  };
  const attempt = await androidOAuth(failing).begin();
  await expect(attempt.open("https://accounts.example/authorize")).rejects.toThrow("no browser");
  await Promise.resolve();
  expect(p.count("appUrlOpen")).toBe(0);
  expect(p.count("browserFinished")).toBe(0);
});
