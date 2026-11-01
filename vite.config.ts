import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import { playwright } from "vite-plus/test/browser-playwright";

const GENERATED = ["node_modules", "dist", "pnpm-lock.yaml", "*.tsbuildinfo", "devenv.lock"];

const ISOMORPHIC = "The core is isomorphic: inject platform APIs instead (AGENTS.md rule 1).";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: [
            "packages/**/*.test.{ts,tsx}",
            "apps/**/*.test.{ts,tsx}",
            "scripts/**/*.test.ts",
          ],
          exclude: ["**/node_modules/**", "**/dist/**", "**/*.browser.test.{ts,tsx}"],
        },
      },
      {
        // Anything that needs a real browser is named *.browser.test.{ts,tsx}
        // and runs in headless Chromium (as in Jhin).
        extends: true,
        // sqlite-wasm loads its .wasm next to itself; pre-bundling would move it.
        // The rest are pre-bundled up front: one found mid-run reloads the tests.
        optimizeDeps: {
          exclude: ["@sqlite.org/sqlite-wasm"],
          include: [
            "drizzle-orm/sqlite-proxy",
            "drizzle-orm",
            "ical.js",
            "@base-ui/react/checkbox",
            "@base-ui/react/dialog",
            "@base-ui/react/popover",
            "i18next",
            "react",
            "react-dom/client",
            "react-i18next",
            "react/jsx-dev-runtime",
            "vite-plus/test/browser/context",
          ],
        },
        test: {
          name: "browser",
          include: ["packages/**/*.browser.test.{ts,tsx}", "apps/**/*.browser.test.{ts,tsx}"],
          exclude: ["**/node_modules/**", "**/dist/**"],
          // A fixed port collides when two checkouts run browser tests at once.
          api: { port: 0, strictPort: false },
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
            screenshotFailures: false,
          },
        },
      },
    ],
  },
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    ignorePatterns: [...GENERATED, "LICENSE"],
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: GENERATED,
    plugins: ["eslint", "oxc", "unicorn", "typescript"],
    categories: {
      correctness: "error",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "unicorn/consistent-function-scoping": "off",
      // Sync steps against a CalDAV server are sequential on purpose.
      "eslint/no-await-in-loop": "off",
    },
    overrides: [
      {
        // AGENTS.md rule 1: the core and the providers run unchanged in the
        // browser, Capacitor and Electron. tsconfig `types: []` enforces the same.
        files: ["packages/core/src/**", "packages/caldav/src/**"],
        rules: {
          "eslint/no-restricted-imports": [
            "error",
            { patterns: [{ group: ["node:*"], message: ISOMORPHIC }] },
          ],
          "eslint/no-restricted-globals": [
            "error",
            { name: "process", message: ISOMORPHIC },
            { name: "window", message: ISOMORPHIC },
            { name: "document", message: ISOMORPHIC },
            { name: "localStorage", message: ISOMORPHIC },
            { name: "indexedDB", message: ISOMORPHIC },
            { name: "Buffer", message: ISOMORPHIC },
          ],
        },
      },
      {
        // AGENTS.md: tests wait for a concrete event, never for time.
        files: ["**/*.test.ts", "**/*.test.tsx", "**/e2e/**/*.ts"],
        rules: {
          "eslint/no-restricted-globals": [
            "error",
            { name: "setTimeout", message: "Wait for a concrete event or a persisted record." },
            { name: "setInterval", message: "Wait for a concrete event or a persisted record." },
          ],
        },
      },
    ],
  },
});
