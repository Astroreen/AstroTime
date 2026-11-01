import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The Android app's web part, built into `dist` for Capacitor to copy into
// the `android/` project (docs/plans/android.md#D61). No proxy: the plugin
// reaches servers directly (D62). Two pages: the app, and background sync's,
// which a WebView with no activity loads on the same origin (D67).
export default defineConfig({
  // The React Compiler memoizes components, as in apps/web.
  plugins: [react({ compiler: true }), tailwindcss()],
  // sqlite-wasm loads its .wasm next to itself; pre-bundling would move it.
  optimizeDeps: { exclude: ["@sqlite.org/sqlite-wasm"] },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: { input: ["index.html", "background.html"] },
  },
});
