// The fill an item is drawn in (design D120): its colour darkened just enough
// for white text to reach 4.5:1. The rule is CSS (`--item-fill` in
// styles.css); this models it and proves the bound over every hue, chroma
// and lightness, inside sRGB and outside it, as the drawn 8-bit colour.
// e2e/a11y.spec.ts checks that Chromium resolves the rule the same way.
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

/** The luminance the fill is capped at, as styles.css has it. */
const CAP = Number(/--dim: min\(1, ([\d.]+) \//.exec(css)?.[1]);

type Rgb = readonly [number, number, number];

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clip = (rgb: Rgb) => rgb.map((x) => Math.min(1, Math.max(0, x))) as unknown as Rgb;
const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const fromLinear = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);

/** styles.css's `--item-fill`: clipped to sRGB in linear light, scaled to the cap. */
function itemFill(linear: Rgb): Rgb {
  const clipped = clip(linear);
  const dim = Math.min(1, CAP / Math.max(luminance(clipped), 0.0001));
  return clipped.map((x) => x * dim) as unknown as Rgb;
}

/** What the screen gets at worst: each channel rounded up to 8 bits. */
function drawn(linear: Rgb): Rgb {
  const worst = (x: number) => toLinear(Math.ceil(fromLinear(x) * 255) / 255);
  return linear.map(worst) as unknown as Rgb;
}

const contrastWithWhite = (linear: Rgb) => 1.05 / (luminance(linear) + 0.05);

/** OKLCH to linear sRGB, unclipped: outside sRGB a channel is below 0 or above 1. */
function oklch(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lc = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mc = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const sc = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * lc - 3.3077115913 * mc + 0.2309699292 * sc,
    -1.2684380046 * lc + 2.6097574011 * mc - 0.3413193965 * sc,
    -0.0041960863 * lc - 0.7034186147 * mc + 1.707614701 * sc,
  ];
}

/** The OKLCH hue of a linear sRGB colour, in degrees. */
function hueOf([r, g, b]: Rgb): number {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
}

describe("an item's fill (design D120)", () => {
  test("styles.css caps the luminance below where white reaches 4.5:1", () => {
    // White (luminance 1) against the cap: (1 + 0.05) / (CAP + 0.05).
    expect(CAP).toBeGreaterThan(0);
    expect(contrastWithWhite([CAP, CAP, CAP])).toBeGreaterThanOrEqual(4.5);
  });

  test("white text reaches 4.5:1 on every hue, chroma and lightness, inside sRGB and outside", () => {
    let worst = Infinity;
    for (let h = 0; h < 360; h += 2) {
      // Chroma to 0.5: past the edge of Display P3 and Rec. 2020 in every hue.
      for (let i = 0; i <= 50; i++) {
        for (let j = 0; j <= 50; j++) {
          const [l, c] = [j / 50, i / 100];
          worst = Math.min(worst, contrastWithWhite(drawn(itemFill(oklch(l, c, h)))));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  test("and on every colour a server can send as #rrggbb", () => {
    let worst = Infinity;
    for (let r = 0; r < 256; r += 3) {
      for (let g = 0; g < 256; g += 3) {
        for (let b = 0; b < 256; b += 3) {
          const linear = [r, g, b].map((x) => toLinear(x / 255)) as unknown as Rgb;
          worst = Math.min(worst, contrastWithWhite(drawn(itemFill(linear))));
        }
      }
    }
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  test("a colour dark enough is drawn as it is; a pale one keeps its hue, darker", () => {
    const hex = (value: string) =>
      [1, 3, 5].map((i) => toLinear(parseInt(value.slice(i, i + 2), 16) / 255)) as unknown as Rgb;
    // Already dark enough for white: unchanged.
    for (const dark of ["#3565c4", "#b3261e", "#1f456f", "#000000"]) {
      expect(itemFill(hex(dark))).toEqual(hex(dark));
    }
    // Pale or mid-tone (the demo's, Nextcloud's default blue, a yellow): darker, its hue kept.
    for (const pale of [
      "#4f8fd6",
      "#3d9f78",
      "#7a6cc9",
      "#c98a3d",
      "#0082c9",
      "#f6bf26",
      "#7c8db5",
    ]) {
      const fill = itemFill(hex(pale));
      expect(luminance(fill)).toBeCloseTo(CAP, 6);
      expect(luminance(fill)).toBeLessThan(luminance(hex(pale)));
      expect(Math.abs(hueOf(fill) - hueOf(hex(pale)))).toBeLessThan(0.5);
    }
  });
});
