import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

import { davProxy } from "./dav-proxy.ts";
import { devClients } from "./dev-clients.ts";

// Host names besides localhost and IPs the dev server answers to
// (comma-separated, `.example.com` for a domain and its subdomains);
// scripts/t3/dev.sh sets them.
const allowedHosts = process.env["ASTROTIME_WEB_ALLOWED_HOSTS"]
  ?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export default defineConfig({
  // The React Compiler memoizes components, as in Jhin and T3 Code.
  plugins: [react({ compiler: true }), tailwindcss(), davProxy(), devClients()],
  ...(allowedHosts?.length ? { server: { allowedHosts } } : {}),
  // sqlite-wasm loads its .wasm next to itself; pre-bundling would move it.
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
