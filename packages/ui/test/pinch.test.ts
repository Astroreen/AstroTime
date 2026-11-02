// The pinch's arithmetic (design D192): the height drawn is the height kept,
// and the time under the fingers stays there through a zoom and after it.
import { describe, expect, test } from "vite-plus/test";

import { anchored, keptHour } from "../src/components/pinch.ts";

describe("pinching the time grid (design D192)", () => {
  test("the height drawn is the one kept: bounded, to a tenth of a pixel", () => {
    expect(keptHour(56 * Math.exp(0.5))).toBe(92.3);
    expect(keptHour(5)).toBe(24);
    expect(keptHour(1000)).toBe(240);
  });

  test("the time under the fingers stays there, once the zoom is kept too", () => {
    const offset = 300;
    const start = { scrollTop: 487, hour: 56 };
    const time = (start.scrollTop + offset) / start.hour;
    // Step by step, as fingers spread, to a height that is not a tenth.
    let scrollTop = start.scrollTop;
    let hour = start.hour;
    for (const next of [61.37, 70.912, 88.4441, 112.0303]) {
      const to = keptHour(next);
      scrollTop = anchored(scrollTop, offset, hour, to);
      hour = to;
    }
    // Kept as drawn: the same time at the same place, to well under a pixel.
    expect(Math.abs((scrollTop + offset) / hour - time) * hour).toBeLessThan(0.01);
  });
});
