// The pictures leave no gap (design D298): below the line where a picture's
// land begins (`data-solid` on its root, in its own units), shapes meant to
// meet cover the ground whole, so nothing of the ground behind them shows.
// Each picture is drawn twice in Chromium, its ground once magenta and once
// green: wherever the two differ, the ground shows through, a gap between
// two shapes (a hill and a field) or a seam where two edges only touch.
import { describe, expect, test } from "vite-plus/test";

import { ITEM_ART, MONTH_ART } from "../src/pictures/art.ts";

/** Twice the picture's own units, as a phone's screen draws it. */
const SCALE = 2;

/** The picture's pixels with its ground (its first shape, D216) painted `ground`. */
async function draw(svg: string, ground: string): Promise<ImageData> {
  const painted = svg.replace(/(<svg[^>]*>\s*<rect[^>]*fill=")#[0-9a-f]{6}/i, `$1${ground}`);
  const [, width, height] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg)!.map(Number);
  const img = new Image(width! * SCALE, height! * SCALE);
  img.src = URL.createObjectURL(new Blob([painted], { type: "image/svg+xml" }));
  await img.decode();
  const canvas = new OffscreenCanvas(width! * SCALE, height! * SCALE);
  const context = canvas.getContext("2d")!;
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(img.src);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** The points below `solid` where the ground shows, in the picture's units. */
async function gaps(svg: string): Promise<string[]> {
  const solid = Number(/<svg[^>]*\bdata-solid="([\d.]+)"/.exec(svg)?.[1]);
  expect(solid, "data-solid on the picture's root").toBeGreaterThan(0);
  const [magenta, green] = await Promise.all([draw(svg, "#ff00ff"), draw(svg, "#00ff00")]);
  const found: string[] = [];
  for (let y = Math.ceil(solid * SCALE); y < magenta.height; y++) {
    for (let x = 0; x < magenta.width; x++) {
      const at = (y * magenta.width + x) * 4;
      // A seam where two edges only touch lets a quarter of the ground through; noise none.
      const shows = [0, 1, 2].some(
        (c) => Math.abs(magenta.data[at + c]! - green.data[at + c]!) > 24,
      );
      if (shows) found.push(`${x / SCALE},${y / SCALE}`);
    }
  }
  return found;
}

const pictures = [
  ...Object.entries(ITEM_ART).map(([subject, art]) => [subject, art.url] as const),
  ...MONTH_ART.map((art, i) => [`month-${String(i + 1).padStart(2, "0")}`, art.url] as const),
];

describe("the pictures leave no gap", () => {
  test.each(pictures)("%s: its land covers its ground whole", async (_name, url) => {
    const svg = await (await fetch(url)).text();
    const found = await gaps(svg);
    expect(found.slice(0, 12), `${found.length} points show the ground`).toEqual([]);
  });

  test("the check finds a gap: a field that stops short of the hill", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 120" data-solid="60">' +
      '<rect width="360" height="120" fill="#a8c7fa"/>' +
      '<path d="M0 50Q180 30 360 50V80H0z" fill="#7fae6a"/>' +
      '<path d="M0 82H360V120H0z" fill="#5e8f4c"/></svg>';
    expect((await gaps(svg)).length).toBeGreaterThan(0);
  });

  test("and a seam: two fields that only touch", async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 120" data-solid="60">' +
      '<rect width="360" height="120" fill="#a8c7fa"/>' +
      '<path d="M0 50L360 50V80.25H0z" fill="#7fae6a"/>' +
      '<path d="M0 80.25H360V120H0z" fill="#7fae6a"/></svg>';
    expect((await gaps(svg)).length).toBeGreaterThan(0);
  });
});
