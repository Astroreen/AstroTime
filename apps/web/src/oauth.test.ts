// The web's OAuth redirect (docs/plans/providers.md#D254): the window opened
// in the click is sent to the service, the answer heard on the app's channel,
// this redirect's alone; a refused window and a sign-in left are said.
import { expect, test } from "vite-plus/test";

import { OAUTH_CHANNEL, PopupBlockedError, webOAuth, type SignInWindow } from "./oauth.ts";

const popup = () => {
  const window: SignInWindow & { closed: boolean } = {
    location: { href: "about:blank" },
    opener: "the app",
    closed: false,
    close: () => void (window.closed = true),
  };
  return window;
};

test("the window opened in the click goes to the service; the answer oauth.html posts is this sign-in's", async () => {
  const opened = popup();
  const attempt = await webOAuth("https://cal.example/", opened).begin();
  expect(attempt.redirectUri).toBe("https://cal.example/oauth.html");
  // Cut from the app before it goes to the service.
  expect(opened.opener).toBeNull();
  const answer = attempt.open("https://accounts.example/authorize?x=1");
  expect(opened.location.href).toBe("https://accounts.example/authorize?x=1");
  // As public/oauth.js posts it, from the window of the same origin.
  const page = new BroadcastChannel(OAUTH_CHANNEL);
  // A BroadcastChannel takes no target origin: it is the origin's own.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  page.postMessage("something else");
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  page.postMessage("https://cal.example/oauth.html?code=c&state=s");
  expect(await answer).toBe("https://cal.example/oauth.html?code=c&state=s");
  page.close();
});

test("a window the browser refused is said, with the service's page for a link", async () => {
  const attempt = await webOAuth("https://cal.example/", null).begin();
  const refused = attempt.open("https://accounts.example/authorize?x=1");
  await expect(refused).rejects.toThrow(PopupBlockedError);
  await expect(refused).rejects.toMatchObject({ url: "https://accounts.example/authorize?x=1" });
});

test("a sign-in left answers nothing, and its window closes", async () => {
  const opened = popup();
  const attempt = await webOAuth("https://cal.example/", opened).begin();
  const answer = attempt.open("https://accounts.example/authorize");
  attempt.cancel();
  expect(await answer).toBeNull();
  expect(opened.closed).toBe(true);
});
