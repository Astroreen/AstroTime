// The single-user preset in the dev server (docs/plans/foundation.md#D123):
// `ASTROTIME_SERVER_URL` and `ASTROTIME_USERNAME` (scripts/t3/dev.sh reads
// them from `.astrotime-dev/preset.env`) go into the page as the image's
// server puts them, so the dev server signs in as a deployment would; so does
// `ASTROTIME_PLACES_URL`, the place search (D178). The build carries none:
// the image's server adds its own at every answer.
import { placesFrom, presetFrom, withPreset } from "@astrotime/caldav";
import type { Plugin } from "vite";

export function devPreset(env: Record<string, string | undefined> = process.env): Plugin {
  const preset = presetFrom(env);
  const places = placesFrom(env);
  return {
    name: "astrotime-dev-preset",
    apply: "serve",
    transformIndexHtml: (html) => withPreset(html, preset, places),
  };
}
