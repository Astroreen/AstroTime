// The shell's manners (docs/plans/android.md#D61, D68), with the plugins
// replaced: the back button, the bars' colour, the WebView's version.
import { expect, test } from "vite-plus/test";

import { backButton, hexOf, type NativeApp } from "../src/shell.ts";
import { chromiumVersion, MINIMUM_WEBVIEW } from "../src/webview.ts";

/** `@capacitor/app` with a back button the test presses. */
function app() {
  let listener: (() => void) | null = null;
  let minimized = 0;
  const native: NativeApp = {
    addListener: async (_event, heard) => {
      listener = heard;
      return { remove: async () => void (listener = null) };
    },
    minimizeApp: async () => void minimized++,
  };
  return {
    native,
    press: () => listener?.(),
    minimized: () => minimized,
  };
}

test("back goes to the UI first; when it closed nothing, the app goes to the background", () => {
  const device = app();
  const onBack = backButton(device.native);
  // Before the UI hears it (the store still opening, or failed): the app leaves.
  device.press();
  expect(device.minimized()).toBe(1);

  let open = 2;
  const stop = onBack(() => (open > 0 ? (open--, true) : false));
  device.press();
  device.press();
  expect([open, device.minimized()]).toEqual([0, 1]);
  device.press();
  expect(device.minimized()).toBe(2);

  // The UI's latest function is the one asked; a stale stop leaves it.
  const latest = onBack(() => true);
  stop();
  device.press();
  expect(device.minimized()).toBe(2);
  latest();
  device.press();
  expect(device.minimized()).toBe(3);
});

test("the page's background reaches the bars as #rrggbb, or not at all", () => {
  expect(hexOf("rgb(27, 29, 35)")).toBe("#1b1d23");
  expect(hexOf("rgb(238, 240, 244)")).toBe("#eef0f4");
  expect(hexOf("rgba(0, 0, 0, 0)")).toBeNull();
  expect(hexOf("oklch(0.2 0 0)")).toBeNull();
});

test("the WebView's Chromium version comes from its user agent", () => {
  const webView = (chrome: string) =>
    `Mozilla/5.0 (Linux; Android 16; Pixel; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${chrome} Mobile Safari/537.36`;
  expect(chromiumVersion(webView("133.0.6943.137"))).toBe(133);
  expect(chromiumVersion(webView("104.0.5112.97"))).toBe(104);
  expect(
    chromiumVersion("Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"),
  ).toBeNull();
  expect(MINIMUM_WEBVIEW).toBe(109);
});
