// End-to-end tests of the web app in Chromium (AGENTS.md: role and
// accessibility-tree locators, a frozen clock, no sleeps). They run against
// the dev server, which can load the demo data (`?demo`); those in e2e/built
// run the production build on the web image's server, under its Content
// Security Policy (docs/plans/foundation.md#D110).
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env["ASTROTIME_E2E_PORT"] ?? 5190);
const ci = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "e2e",
  forbidOnly: ci,
  reporter: ci ? [["github"], ["list"]] : "list",
  // A ceiling, not a wait (AGENTS.md): a check once gave up at the default
  // 5 s on CI and passed on rerun; it did not happen locally in 120 runs.
  // The likely cause, not measured, is CI's two cores with a dev server that
  // compiles modules on first request. Nothing waits for time to pass.
  ...(ci ? { expect: { timeout: 15_000 } } : {}),
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["Desktop Chrome"],
    locale: "en-US",
    timezoneId: "Europe/Vilnius",
    colorScheme: "dark",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "dev", testIgnore: "built/**" },
    { name: "build", testMatch: "built/build.setup.ts" },
    { name: "built", testMatch: "built/*.spec.ts", dependencies: ["build"] },
  ],
  webServer: {
    command: `vp dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !ci,
  },
});
