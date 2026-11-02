// The scrollbar's thumb (design D191) against every surface a scroller sits
// on, light and dark: 3:1 or more at rest (WCAG 1.4.11), stronger under the
// pointer and while dragged. The thumb's shares of the ink and the theme's
// colours are read from styles.css; the mixing is `color-mix(in srgb, …,
// transparent)` drawn over the surface, modelled here.
import { readFileSync } from "node:fs";

import { describe, expect, test } from "vite-plus/test";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

function token(name: string): { light: string; dark: string } {
  const found = new RegExp(`--color-${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`).exec(
    css,
  );
  if (!found) throw new Error(`styles.css has no --color-${name}: the model is out of date`);
  return { light: found[1]!, dark: found[2]! };
}

function share(name: string): number {
  const found = new RegExp(`--${name}: color-mix\\(in srgb, var\\(--color-ink\\) (\\d+)%`).exec(
    css,
  );
  if (!found) throw new Error(`styles.css has no --${name}: the model is out of date`);
  return Number(found[1]) / 100;
}

type Rgb = readonly [number, number, number];
const rgb = (hex: string): Rgb =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as unknown as Rgb;
const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const luminance = (c: Rgb) => {
  const [r, g, b] = c.map(toLinear) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
/** `share` of the ink over `surface`, as the screen gets it. */
const over = (ink: Rgb, surface: Rgb, part: number) =>
  ink.map((x, i) => part * x + (1 - part) * surface[i]!) as unknown as Rgb;

const ink = token("ink");
const surfaces = ["canvas", "tile", "raised", "raised-hover"].map(token);

describe("the scrollbar's thumb (design D191)", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`3:1 or more at rest on every surface, ${theme}; stronger under the pointer and dragged`, () => {
      for (const surface of surfaces) {
        const on = (part: number) =>
          contrast(over(rgb(ink[theme]), rgb(surface[theme]), part), rgb(surface[theme]));
        const rest = on(share("scrollbar"));
        expect(rest, `${theme} on ${surface[theme]}`).toBeGreaterThanOrEqual(3);
        expect(on(share("scrollbar-hover"))).toBeGreaterThan(rest);
        expect(on(share("scrollbar-active"))).toBeGreaterThan(on(share("scrollbar-hover")));
      }
    });
  }
});
