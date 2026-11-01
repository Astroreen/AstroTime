// Builds the app as the web image does, for the specs that run it on the
// image's own server (playwright.config.ts, the "built" project).
import { execFileSync } from "node:child_process";

import { test } from "@playwright/test";

test("build the app", () => {
  execFileSync("vp", ["build"], { cwd: new URL("../..", import.meta.url), stdio: "inherit" });
});
