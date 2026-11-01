// Every Dialog and AlertDialog takes its backdrop and popup from
// `dialog-parts.tsx`, which makes a closing one let a press through (design
// D136): a dialog that used Base UI's parts directly would swallow the press
// that follows its closing. That the parts do so is seen in a browser, on
// the app's own styles: `apps/web/e2e/settings.spec.ts`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

const components = join(import.meta.dirname, "../src/components");

test("no dialog uses Base UI's Backdrop or Popup directly (design D136)", () => {
  const direct = readdirSync(components)
    .filter((file) => file.endsWith(".tsx") && file !== "dialog-parts.tsx")
    .flatMap((file) =>
      readFileSync(join(components, file), "utf8")
        .split("\n")
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ text }) => /\b(AlertDialog|Dialog)\.(Backdrop|Popup)\b/.test(text)),
    )
    .map(({ file, line }) => `${file}:${line}`);
  expect(direct).toEqual([]);
});
