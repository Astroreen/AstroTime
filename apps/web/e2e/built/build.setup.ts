// Builds the app as the web image does, for the specs that run it on the
// image's own server (playwright.config.ts, the "built" project), with the
// service worker's one test hook.
import { execFileSync } from "node:child_process";

import { test } from "@playwright/test";

test("build the app", () => {
  // With the service worker's test hook (a page may set its navigation bound,
  // docs/plans/foundation.md#D124); the image's build has none.
  execFileSync("vp", ["build"], {
    cwd: new URL("../..", import.meta.url),
    stdio: "inherit",
    env: { ...process.env, ASTROTIME_SW_TEST_HOOKS: "1" },
  });
});
