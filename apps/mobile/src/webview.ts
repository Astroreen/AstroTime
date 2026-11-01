// The System WebView the app runs in (docs/plans/android.md#D61): the web
// store needs OPFS with synchronous access handles (Chromium 109) and the
// theme's colours `light-dark()` (Chromium 123); on an older WebView the app
// says to update it instead of opening half-working.

/** The oldest WebView the app works on, colours included. */
export const MINIMUM_WEBVIEW = 123;

/** The WebView's Chromium major version from its user agent, or `null` when it names none. */
export function chromiumVersion(userAgent: string): number | null {
  const match = /\bChrome\/(\d+)\./.exec(userAgent);
  return match ? Number(match[1]) : null;
}
