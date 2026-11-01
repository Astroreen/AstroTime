import { expect, test } from "vite-plus/test";

import { OfflineError, retryAfter, ServerBusyError } from "@astrotime/core";

import { CalDavProvider, type HttpClient } from "../src/index.ts";

test("a 429 or a 503 stops the sync as when offline, with the server's Retry-After (D128)", async () => {
  for (const [status, header, expected] of [
    [429, "120", 120_000],
    [503, null, null],
  ] as const) {
    const http: HttpClient = async (request) => ({
      status,
      url: request.url,
      header: (name) => (name === "retry-after" ? header : null),
      body: "",
    });
    const provider = new CalDavProvider(
      http,
      { username: "u", password: "p" },
      "https://dav.example/",
    );
    const error: unknown = await provider.calendars().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServerBusyError);
    expect(error).toBeInstanceOf(OfflineError);
    expect((error as ServerBusyError).retryAfterMs).toBe(expected);
  }
});

test("Retry-After is seconds or an HTTP date (RFC 9110 §10.2.3)", () => {
  const now = Date.parse("2026-11-01T12:00:00Z");
  expect(retryAfter("30", now)).toBe(30_000);
  expect(retryAfter("Sun, 01 Nov 2026 12:02:00 GMT", now)).toBe(120_000);
  expect(retryAfter("Sun, 01 Nov 2026 11:00:00 GMT", now)).toBe(0);
  expect(retryAfter("soon", now)).toBeNull();
  expect(retryAfter(null, now)).toBeNull();
});
