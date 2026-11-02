// The user's own pictures on the device (design D222), in Chromium's
// IndexedDB: kept smaller, read back, forgotten; a file that is no picture
// refused.
import { expect, test } from "vite-plus/test";

import {
  addPicture,
  keptSize,
  NotAPictureError,
  pictureOf,
  removePicture,
  sweepPictures,
} from "../src/pictures/own.ts";

/** A picture as a phone's camera gives one: a PNG, 3000 × 1000. */
async function photo(): Promise<Blob> {
  const canvas = new OffscreenCanvas(3000, 1000);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#3565c4";
  context.fillRect(0, 0, 3000, 1000);
  return canvas.convertToBlob({ type: "image/png" });
}

test("a picture is kept smaller, its long side 1600 px, read back by its id, then forgotten", async () => {
  const id = await addPicture(await photo());
  const kept = await pictureOf(id);
  expect(kept?.type).toMatch(/^image\/(webp|jpeg)$/);
  const bitmap = await createImageBitmap(kept!);
  expect([bitmap.width, bitmap.height]).toEqual([1600, 533]);
  await removePicture(id);
  expect(await pictureOf(id)).toBeUndefined();
  // Forgetting one already gone is no error.
  await removePicture(id);
});

test("an SVG is kept too, drawn as a picture of its own size", async () => {
  const svg = new Blob(
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><rect width="360" height="120" fill="#e8c9a4"/></svg>',
    ],
    { type: "image/svg+xml" },
  );
  const id = await addPicture(svg);
  const bitmap = await createImageBitmap((await pictureOf(id))!);
  expect([bitmap.width, bitmap.height]).toEqual([360, 120]);
  await removePicture(id);
});

test("a file that is no picture is refused, and nothing is kept", async () => {
  await expect(
    addPicture(new Blob(["not a picture"], { type: "text/plain" })),
  ).rejects.toBeInstanceOf(NotAPictureError);
});

test("a picture already small enough keeps its size", () => {
  expect(keptSize(800, 600)).toEqual({ width: 800, height: 600 });
  expect(keptSize(1000, 4000)).toEqual({ width: 400, height: 1600 });
});

test("the sweep forgets every picture nothing names, and keeps those named", async () => {
  const named = await addPicture(await photo());
  const stray = await addPicture(await photo());
  await sweepPictures(new Set([named]));
  expect(await pictureOf(named)).toBeDefined();
  expect(await pictureOf(stray)).toBeUndefined();
  await removePicture(named);
});
