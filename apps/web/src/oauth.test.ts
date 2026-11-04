// The web's OAuth redirect (docs/plans/providers.md#D254): the answer heard
// on the app's channel, this redirect's alone; a sign-in left answers nothing.
import { expect, test } from "vite-plus/test";

import { OAUTH_CHANNEL, webOAuth } from "./oauth.ts";

test("the answer oauth.html posts is this sign-in's; another page's message is not", async () => {
  const opened: string[] = [];
  const redirect = webOAuth("https://cal.example/", (url) => opened.push(url));
  const attempt = await redirect.begin();
  expect(attempt.redirectUri).toBe("https://cal.example/oauth.html");
  const answer = attempt.open("https://accounts.example/authorize?x=1");
  expect(opened).toEqual(["https://accounts.example/authorize?x=1"]);
  // As public/oauth.js posts it, from the popup of the same origin.
  const page = new BroadcastChannel(OAUTH_CHANNEL);
  // A BroadcastChannel takes no target origin: it is the origin's own.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  page.postMessage("something else");
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  page.postMessage("https://cal.example/oauth.html?code=c&state=s");
  expect(await answer).toBe("https://cal.example/oauth.html?code=c&state=s");
  page.close();
});

test("a sign-in left answers nothing", async () => {
  const attempt = await webOAuth("https://cal.example/", () => {}).begin();
  const answer = attempt.open("https://accounts.example/authorize");
  attempt.cancel();
  expect(await answer).toBeNull();
});
