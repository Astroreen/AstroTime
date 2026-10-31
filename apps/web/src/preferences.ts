import type { Preferences } from "@astrotime/ui";

/** The web app keeps this device's preferences in localStorage. */
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
      // Storage refused (full, or disabled): the choice lasts this visit only.
    }
  },
};
