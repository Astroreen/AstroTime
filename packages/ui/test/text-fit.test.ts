import { describe, expect, test } from "vite-plus/test";

import { HOUR, textFit } from "../src/components/items.tsx";

/** The pixels a block shows of `minutes` at its top, as `TimedItem` draws them. */
const shown = (minutes: number) => (minutes / 60) * HOUR - 2;

describe("what of a covered block's text fits above the item over it (design D153)", () => {
  test("at the title room, 45 minutes, a wide block keeps two lines of its title and drops its time", () => {
    expect(textFit(shown(45), { compact: false, covered: true })).toEqual({
      showTime: false,
      lines: 2,
    });
  });

  test("a narrow column's block keeps two lines too, and never shows its time", () => {
    expect(textFit(shown(45), { compact: true, covered: true })).toEqual({
      showTime: false,
      lines: 2,
    });
  });

  test("the time line comes back once two lines of the title fit above it", () => {
    expect(textFit(shown(50), { compact: false, covered: true }).showTime).toBe(false);
    expect(textFit(shown(55), { compact: false, covered: true })).toEqual({
      showTime: true,
      lines: 2,
    });
    expect(textFit(shown(90), { compact: false, covered: true })).toEqual({
      showTime: true,
      lines: 4,
    });
  });

  test("a block nothing covers wraps freely, with its time from 38 px", () => {
    expect(textFit(shown(45), { compact: false, covered: false })).toEqual({
      showTime: true,
      lines: undefined,
    });
    expect(textFit(30, { compact: false, covered: false }).showTime).toBe(false);
  });

  test("at a larger text size the hour is taller and so are the lines: the same 45 minutes keep two (design D295)", () => {
    const scale = 1.3;
    const at = (minutes: number) => (minutes / 60) * HOUR * scale - 2;
    expect(textFit(at(45), { compact: false, covered: true, scale })).toEqual({
      showTime: false,
      lines: 2,
    });
    // Measured at 100 % lines, the same pixels would add the time line, which has no room at 130 %.
    expect(textFit(at(45), { compact: false, covered: true }).showTime).toBe(true);
    expect(textFit(38, { compact: false, covered: false, scale }).showTime).toBe(false);
  });
});
