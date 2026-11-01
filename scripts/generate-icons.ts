// Draws the web app's PNG icons from `apps/web/public/icon.svg` in Chromium
// (docs/plans/foundation.md#D124): 192 and 512 px, as the manifest names
// them, and a maskable 512 whose drawing sits in the safe zone on a full
// square. Run by hand when the icon changes:
//
//   node scripts/generate-icons.ts
import { readFileSync } from "node:fs";

import { chromium } from "playwright";

const publicDir = new URL("../apps/web/public/", import.meta.url);
const svg = readFileSync(new URL("icon.svg", publicDir), "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();

async function draw(file: string, size: number, maskable: boolean): Promise<void> {
  await page.setViewportSize({ width: size, height: size });
  // A maskable icon fills the square; the drawing keeps to its inner 80%.
  const inner = maskable ? Math.round(size * 0.8) : size;
  await page.setContent(
    `<body style="margin:0;background:${maskable ? "#1b1d23" : "transparent"};display:grid;place-items:center;height:${size}px">` +
      `<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${inner}" height="${inner}"></body>`,
  );
  await page.screenshot({
    path: new URL(file, publicDir).pathname,
    omitBackground: !maskable,
  });
}

await draw("icon-192.png", 192, false);
await draw("icon-512.png", 512, false);
await draw("icon-maskable-512.png", 512, true);
await browser.close();
