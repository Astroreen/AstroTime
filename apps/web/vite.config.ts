import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { davProxy } from "./dav-proxy.ts";
import { devClients } from "./dev-clients.ts";
import { devPreset } from "./dev-preset.ts";
import { devTls } from "./dev-tls.ts";

// Host names besides localhost and IPs the dev server answers to
// (comma-separated, `.example.com` for a domain and its subdomains);
// scripts/t3/dev.sh sets them.
const allowedHosts = process.env["ASTROTIME_WEB_ALLOWED_HOSTS"]
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export default defineConfig({
  // The React Compiler memoizes components, as in Jhin and T3 Code.
  plugins: [
    react({ compiler: true }),
    tailwindcss(),
    davProxy(),
    devClients(),
    devTls(),
    devPreset(),
  ],
  ...(allowedHosts?.length ? { server: { allowedHosts } } : {}),
  // The page's tags, and a <meta property="csp-nonce"> the app reads, carry
  // this placeholder; the web image's server fills in a fresh nonce on every
  // answer (apps/proxy/src/server.ts, docs/plans/foundation.md#D110). The dev
  // server sends no policy, so here it stays as it is.
  html: { cspNonce: "astrotime-csp-nonce" },
  // sqlite-wasm loads its .wasm next to itself; pre-bundling would move it.
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
