// The web's OAuth redirect on the image's own server, under its policy
// (docs/plans/providers.md#D254, foundation D110): oauth.html hands the
// answer's address to the app's tab over the origin's channel, its script
// allowed as the app's own, and closes.
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";

import { test as base, expect } from "@playwright/test";

import { createAppServer } from "../../../proxy/src/server.ts";

const test = base.extend({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  baseURL: async ({}, use) => {
    const server = createAppServer({
      root: fileURLToPath(new URL("../../dist", import.meta.url)),
      allow: [],
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    await new Promise((resolve) => server.close(resolve));
  },
});

test.use({ serviceWorkers: "block" });

test("oauth.html posts its address to the app's tab and breaks no rule of the policy", async ({
  page,
  context,
}) => {
  const violations: string[] = [];
  await page.goto("/manifest.webmanifest");
  const heard = page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const channel = new BroadcastChannel("astrotime-oauth");
        channel.addEventListener("message", (event) => resolve(String(event.data)));
      }),
  );
  const popup = await context.newPage();
  popup.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  const answer = await popup.goto("/oauth.html?code=c1&state=s1");
  expect(answer?.headers()["content-security-policy"]).toContain("script-src 'self'");
  expect(await heard).toMatch(/\/oauth\.html\?code=c1&state=s1$/);
  expect(violations).toEqual([]);
});
