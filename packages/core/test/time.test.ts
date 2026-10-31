import { describe, expect, test } from "vite-plus/test";

import { wallClockIn, zonedToEpoch } from "../src/time.ts";
import { WINDOWS_ZONES } from "../src/windows-zones.ts";

describe("zoned wall clocks (RFC 5545 §3.3.5)", () => {
  test("an ordinary time", () => {
    expect(zonedToEpoch("2026-07-01T12:00:00", "Europe/Vilnius")).toBe(
      Date.parse("2026-07-01T09:00:00Z"),
    );
    expect(wallClockIn(Date.parse("2026-07-01T09:00:00Z"), "Europe/Vilnius")).toBe(
      "2026-07-01T12:00:00",
    );
  });

  test("a time in the spring gap uses the offset before the gap", () => {
    // Vilnius jumps from 03:00 to 04:00 on 29 Mar 2026; 03:30 does not exist.
    expect(zonedToEpoch("2026-03-29T03:30:00", "Europe/Vilnius")).toBe(
      Date.parse("2026-03-29T01:30:00Z"),
    );
  });

  test("a time repeated in autumn takes the earlier instant", () => {
    // Vilnius goes from 04:00 back to 03:00 on 25 Oct 2026; 03:30 happens twice.
    expect(zonedToEpoch("2026-10-25T03:30:00", "Europe/Vilnius")).toBe(
      Date.parse("2026-10-25T00:30:00Z"),
    );
  });
});

describe("Windows zone names (D32)", () => {
  test("every zone in the generated table names an IANA zone the runtime knows", () => {
    for (const [windows, iana] of Object.entries(WINDOWS_ZONES)) {
      expect(() => wallClockIn(0, iana), `${windows} → ${iana}`).not.toThrow();
    }
  });
});
