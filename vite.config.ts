import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

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
          include: ["packages/**/*.test.ts", "apps/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
          exclude: ["**/node_modules/**", "**/dist/**"],
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
        files: ["**/*.test.ts", "**/*.test.tsx"],
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
