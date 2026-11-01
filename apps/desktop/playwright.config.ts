// The desktop app end to end, on Playwright's Electron support (experimental:
// one smoke test leans on it, docs/plans/desktop.md#D79): the built app in
// the dev shell's Electron (nixpkgs', D70) or CI's, under xvfb-run where there
// is no display. Role and accessibility-tree locators, no sleeps (AGENTS.md).
import { defineConfig } from "@playwright/test";

const ci = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "e2e",
  forbidOnly: ci,
  reporter: ci ? [["github"], ["list"]] : "list",
  // A ceiling, not a wait (AGENTS.md), as the web's on CI's two cores.
  ...(ci ? { expect: { timeout: 15_000 } } : {}),
  // Each test starts its own app, which is heavy: one at a time.
  workers: 1,
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "build", testMatch: "build.setup.ts" },
    { name: "app", testIgnore: "build.setup.ts", dependencies: ["build"] },
  ],
});
