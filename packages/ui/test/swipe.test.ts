import { describe, expect, test } from "vite-plus/test";

import { swipeOutcome } from "../src/hooks.ts";

describe("where a swipe let go goes (design D154)", () => {
  test("past a quarter of the view, the next or previous period", () => {
    expect(swipeOutcome(-110, 0, 0, 412)).toBe(1);
    expect(swipeOutcome(110, 0, 0, 412)).toBe(-1);
    expect(swipeOutcome(-90, 0, 0, 412)).toBe(0);
  });

  test("at least 56 px on a narrow view, at most 120 on a wide one", () => {
    expect(swipeOutcome(-57, 0, 0, 200)).toBe(1);
    expect(swipeOutcome(-55, 0, 0, 200)).toBe(0);
    expect(swipeOutcome(-121, 0, 0, 1440)).toBe(1);
  });

  test("a flick from 24 px moves on, in the way it went", () => {
    expect(swipeOutcome(-30, 0, -0.6, 412)).toBe(1);
    expect(swipeOutcome(-20, 0, -0.6, 412)).toBe(0);
    // Pulled back at the end: the flick goes the other way than the swipe.
    expect(swipeOutcome(-30, 0, 0.6, 412)).toBe(0);
  });

  test("mostly up or down, nothing", () => {
    expect(swipeOutcome(-150, 80, -1, 412)).toBe(0);
  });
});
