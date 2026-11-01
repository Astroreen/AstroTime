// Builds the app, so the specs run what the source says now.
import { execFileSync } from "node:child_process";

import { test } from "@playwright/test";

test("build the app", () => {
  execFileSync("vp", ["build"], { cwd: new URL("..", import.meta.url), stdio: "inherit" });
});
