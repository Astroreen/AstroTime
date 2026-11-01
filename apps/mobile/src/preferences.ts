import type { Preferences } from "@astrotime/ui";

/**
 * This device's preferences in the WebView's localStorage, which lives in the
 * app's data with the store (docs/plans/android.md#D63), as on the web.
 */
export const preferences: Preferences = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage refused (full): the choice lasts this run only.
    }
  },
};
