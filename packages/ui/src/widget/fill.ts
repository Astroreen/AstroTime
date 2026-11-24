// The colour a home screen widget's row is filled with (docs/plans/android.md#D317):
// the item's colour darkened as `--item-fill` darkens it in the app (design
// D120), so white text on it reaches 4.5:1, worked out here because a
// widget draws no CSS. A done task's is its colour mixed with grey first,
// muted as the app mutes it, and darkened the same way.
import { colorNameHex } from "@astrotime/core";

/** The luminance the fill is capped at, as `styles.css` caps `--item-fill`. */
const CAP = 0.18;
/** What a done task's colour is mixed with, and how much of its own it keeps. */
const MUTED = [0x8a, 0x8f, 0x98] as const;
const KEPT = 0.45;

type Rgb = readonly [number, number, number];

const toLinear = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const fromLinear = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * `#rgb`, `#rrggbb` or a CSS3 name as its 8-bit channels, and `#rgba` or
 * `#rrggbbaa` (Nextcloud's calendar colours) without their alpha, as the
 * views draw an item opaque; `null` for anything else.
 */
export function rgbOf(color: string | null | undefined): Rgb | null {
  if (!color) return null;
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(color.trim())
    ? color.trim()
    : colorNameHex(color);
  if (!hex) return null;
  const digits =
    hex.length <= 5 ? Array.from(hex.slice(1, 4), (d) => d + d).join("") : hex.slice(1, 7);
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as unknown as Rgb;
}

/**
 * `#rrggbb` to fill a row of `color` with, white text on it at 4.5:1 or
 * more; a done task's muted. Each channel is rounded down, so the 8-bit
 * colour drawn is never lighter than the bound allows.
 */
export function fillOf(color: Rgb, done = false): string {
  const mixed = done ? color.map((c, i) => c * KEPT + MUTED[i]! * (1 - KEPT)) : color;
  const linear = mixed.map((c) => toLinear(c / 255)) as unknown as Rgb;
  const dim = Math.min(1, CAP / Math.max(luminance(linear), 0.0001));
  return `#${linear
    .map((x) =>
      Math.floor(fromLinear(x * dim) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
