import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { davProxy } from "./dav-proxy.ts";
import { devClients } from "./dev-clients.ts";
import { devPreset } from "./dev-preset.ts";
import { devTls } from "./dev-tls.ts";
import { serviceWorker } from "./service-worker.ts";

// Host names besides localhost and IPs the dev server answers to
// (comma-separated, `.example.com` for a domain and its subdomains);
// scripts/t3/dev.sh sets them.
const allowedHosts = process.env["ASTROTIME_WEB_ALLOWED_HOSTS"]
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Rolldown's tag for a module the page loads at once. */
const initial: "$initial"[] = ["$initial"];

export default defineConfig({
  // The React Compiler memoizes components, as in Jhin and T3 Code.
  plugins: [
    react({ compiler: true }),
    tailwindcss(),
    davProxy(),
    devClients(),
    devTls(),
    devPreset(),
    serviceWorker(),
  ],
  ...(allowedHosts?.length ? { server: { allowedHosts } } : {}),
  // The page's tags, and a <meta property="csp-nonce"> the app reads, carry
  // this placeholder; the web image's server fills in a fresh nonce on every
  // answer (apps/proxy/src/server.ts, docs/plans/foundation.md#D110). The dev
  // server sends no policy, so here it stays as it is.
  html: { cspNonce: "astrotime-csp-nonce" },
  // sqlite-wasm loads its .wasm next to itself; pre-bundling would move it.
  // Base UI's Autocomplete loads with the edit dialog (design D175): named
  // here, the dev server bundles it at start, where it might otherwise find
  // it when a test first opens the dialog and reload the page (the likely,
  // not proven, cause of a places.spec failure seen once).
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
    include: ["@astrotime/ui > @base-ui/react/autocomplete"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // What each chunk imports, for the budget (scripts/bundle-budget.ts).
    manifest: true,
    rolldownOptions: {
      output: {
        // The pictures (design D219) apart from the other files: the service
        // worker keeps each as it is first shown, not with the app (D124).
        assetFileNames: (asset) =>
          asset.originalFileNames.some((name) => name.includes("/pictures/art/"))
            ? "assets/pictures/[name]-[hash][extname]"
            : "assets/[name]-[hash][extname]",
        // Libraries in chunks of their own (docs/plans/foundation.md#D145): an
        // update of AstroTime's own code leaves them in the browser's cache.
        // Only what the page loads at once (`$initial`): a library only a
        // dialog loaded later uses stays in that dialog's chunk.
        codeSplitting: {
          groups: [
            {
              name: "react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              tags: initial,
            },
            {
              name: "base-ui",
              test: /node_modules[\\/]@(base-ui|floating-ui)[\\/]/,
              tags: initial,
            },
            { name: "ical", test: /node_modules[\\/]ical\.js[\\/]/, tags: initial },
            { name: "drizzle", test: /node_modules[\\/]drizzle-orm[\\/]/, tags: initial },
            { name: "i18n", test: /node_modules[\\/](i18next|react-i18next)[\\/]/ },
            { name: "vendor", test: /node_modules[\\/]/, tags: initial },
            // AstroTime's own packages that load at once, in one chunk: a part
            // loaded later that needs some of them (the subscriptions' file
            // splitter, which needs the iCalendar core) takes them from it,
            // rather than cutting them into a chunk of their own, which
            // compresses worse (docs/plans/providers.md#D255).
            {
              name: "app",
              test: /packages[\\/](core|caldav|storage|sync)[\\/]src[\\/]/,
              tags: initial,
            },
          ],
        },
      },
    },
  },
});
