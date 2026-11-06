// Draws every picture (docs/plans/design.md#D298) in Chromium at the sizes
// the app shows it, so each can be looked at before it ships: an item's as
// the Agenda's card (312×104) and the details' header (160 px high, on a
// phone and in the 448 px dialog), a month's as its banner (144 px high on a
// phone, 176 px on a wide screen), boxed and cropped as the components box
// and crop them, at twice the pixels. One PNG a picture; given the pictures
// of before, each PNG holds the two side by side. Run by hand:
//
//   node scripts/render-pictures.ts <out-dir> [<before-art-dir>]
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { chromium } from "playwright";

const [out, before] = process.argv.slice(2);
if (!out) throw new Error("usage: node scripts/render-pictures.ts <out-dir> [<before-art-dir>]");
mkdirSync(out, { recursive: true });
const art = new URL("../packages/ui/src/pictures/art/", import.meta.url).pathname;

/** A box the app draws a picture in, and how its picture sits in it. */
interface Box {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  /** The picture's own style in the box (`month-banner.tsx`, `item-picture.tsx`, `picture-card.tsx`). */
  readonly img: string;
}

const FILL = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover";
// The banner's picture is 116 % of its box, 8 % above it, for its drift.
const BANNER = "position:absolute;left:0;top:-8%;width:100%;height:116%;object-fit:cover";
const ITEM: readonly Box[] = [
  { label: "card 312×104", width: 312, height: 104, img: `${FILL};object-position:right` },
  { label: "details 448×160", width: 448, height: 160, img: FILL },
  { label: "details 360×160", width: 360, height: 160, img: FILL },
];
const MONTH: readonly Box[] = [
  { label: "banner 360×144", width: 360, height: 144, img: BANNER },
  { label: "banner 412×144", width: 412, height: 144, img: BANNER },
  { label: "banner 960×176", width: 960, height: 176, img: BANNER },
];

const dataUrl = (file: string) =>
  `data:image/svg+xml;base64,${readFileSync(file).toString("base64")}`;

function column(dir: string | undefined, name: string, boxes: readonly Box[], title: string) {
  const file = dir && join(dir, name);
  const shown =
    file && existsSync(file)
      ? boxes
          .map(
            (box) =>
              `<figure><figcaption>${box.label}</figcaption><div style="position:relative;overflow:hidden;width:${box.width}px;height:${box.height}px"><img src="${dataUrl(file)}" style="${box.img}"></div></figure>`,
          )
          .join("")
      : "<p>(none)</p>";
  return `<section><h2>${title}</h2>${shown}</section>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
for (const name of readdirSync(art).filter((file) => file.endsWith(".svg"))) {
  const boxes = name.startsWith("month-") ? MONTH : ITEM;
  const columns = before
    ? column(resolve(before), name, boxes, `${name}: before`) + column(art, name, boxes, "after")
    : column(art, name, boxes, name);
  await page.setContent(
    `<body style="margin:0;padding:12px;background:#fff;font:13px sans-serif;display:flex;gap:24px;width:max-content">${columns}</body>` +
      "<style>figure{margin:0 0 10px}figcaption{color:#555;margin-bottom:3px}h2{font-size:14px;margin:0 0 8px}</style>",
  );
  // Every picture decoded before the screenshot: a concrete event, not a wait.
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode())));
  await page.locator("body").screenshot({ path: join(out, name.replace(/\.svg$/, ".png")) });
}
await browser.close();
