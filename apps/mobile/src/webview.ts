// The System WebView the app runs in (docs/plans/android.md#D61): the web
// store needs OPFS with synchronous access handles, which Chromium has since
// 109; on an older WebView the app says to update it instead of failing.

/** The oldest WebView the store works on. */
export const MINIMUM_WEBVIEW = 109;

/** The WebView's Chromium major version from its user agent, or `null` when it names none. */
export function chromiumVersion(userAgent: string): number | null {
  const match = /\bChrome\/(\d+)\./.exec(userAgent);
  return match ? Number(match[1]) : null;
}
