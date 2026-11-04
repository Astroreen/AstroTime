// The desktop's loopback redirect (docs/plans/providers.md#D254): one
// request to /oauth is the answer, on 127.0.0.1 only, and the server goes.
import { expect, test } from "vite-plus/test";

import { loopback } from "./oauth.ts";

test("the browser's return to /oauth is the answer, once; the port then closes", async () => {
  const redirect = await loopback("<p>Back to AstroTime</p>");
  expect(redirect.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth$/);
  // Another path is no answer.
  expect((await fetch(redirect.redirectUri.replace("/oauth", "/elsewhere"))).status).toBe(404);
  const page = await fetch(`${redirect.redirectUri}?code=c1&state=s1`);
  expect(await page.text()).toContain("Back to AstroTime");
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
