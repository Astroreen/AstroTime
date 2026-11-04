// The desktop's loopback redirect (docs/plans/providers.md#D254): one
// request to /oauth is the answer, on 127.0.0.1 only, and the server goes.
import { expect, test } from "vite-plus/test";

import { loopback } from "./oauth.ts";

test("the browser's return to /oauth is the answer, once; the port then closes", async () => {
  const redirect = await loopback("<p>Back to AstroTime</p>");
  expect(redirect.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth$/);
  redirect.expect("s1");
  // A stray request (no state, another sign-in's) is refused; the server waits on.
  expect((await fetch(`${redirect.redirectUri}?code=x`)).status).toBe(400);
  expect((await fetch(`${redirect.redirectUri}?code=x&state=other`)).status).toBe(400);
  // Another path is no answer.
  expect((await fetch(redirect.redirectUri.replace("/oauth", "/elsewhere"))).status).toBe(404);
  const page = await fetch(`${redirect.redirectUri}?code=c1&state=s1`);
  // The whole page arrives before the server goes.
  expect(await page.text()).toBe("<p>Back to AstroTime</p>");
  expect(page.headers.get("content-security-policy")).toBe("default-src 'none'");
  expect(await redirect.answer).toBe(`${redirect.redirectUri}?code=c1&state=s1`);
  await expect(fetch(redirect.redirectUri)).rejects.toThrow();
});

test("a sign-in left (cancelled) answers nothing, and frees its port", async () => {
  const redirect = await loopback("x");
  redirect.close();
  expect(await redirect.answer).toBeNull();
  await expect(fetch(redirect.redirectUri)).rejects.toThrow();
});

test("before the sign-in's page is opened, nothing is the answer; a refusal with the state is", async () => {
  const redirect = await loopback("x");
  expect((await fetch(`${redirect.redirectUri}?code=c&state=s`)).status).toBe(400);
  redirect.expect("s");
  const denied = await fetch(`${redirect.redirectUri}?error=access_denied&state=s`);
  expect(denied.status).toBe(200);
  expect(await redirect.answer).toBe(`${redirect.redirectUri}?error=access_denied&state=s`);
});
