// End-to-end tests of the web app in Chromium (AGENTS.md: role and
// accessibility-tree locators, a frozen clock, no sleeps). They run against
// the dev server, which can load the demo data (`?demo`).
import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env["ASTROTIME_E2E_PORT"] ?? 5190);
const ci = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "e2e",
  forbidOnly: ci,
  reporter: ci ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices["Desktop Chrome"],
    locale: "en-US",
    timezoneId: "Europe/Vilnius",
    colorScheme: "dark",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `vp dev --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !ci,
  },
});
