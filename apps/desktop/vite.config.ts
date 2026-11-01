import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type EnvironmentOptions } from "vite";

// The desktop app's three parts, each bundled with what it imports, so the
// package holds plain files and no node_modules (docs/plans/desktop.md#D70,
// D78): the renderer (the page, the shared UI), the main process with the
// store's utility process, and the preload, which a sandboxed renderer loads
// as one CommonJS script. `vp build` builds them all.
const node: EnvironmentOptions = {
  consumer: "server",
  resolve: { noExternal: true, external: ["electron"] },
};

export default defineConfig({
  // The React Compiler memoizes components, as in the web app.
  plugins: [react({ compiler: true }), tailwindcss()],
  // The page's tags, and a <meta property="csp-nonce"> the page reads, carry
  // this placeholder; app:// fills in a fresh nonce on every load
  // (src/main/app-protocol.ts), as the web image's server does.
  html: { cspNonce: "astrotime-csp-nonce" },
  builder: {},
  environments: {
    client: {
      build: { outDir: "dist/renderer", emptyOutDir: true },
    },
    main: {
      ...node,
      build: {
        outDir: "dist/main",
        emptyOutDir: true,
        target: "node24",
        rolldownOptions: {
          input: { index: "src/main/index.ts", store: "src/store/index.ts" },
          output: { format: "es", entryFileNames: "[name].js" },
        },
      },
    },
    preload: {
      ...node,
      build: {
        outDir: "dist/preload",
        emptyOutDir: true,
        target: "esnext",
        rolldownOptions: {
          input: { index: "src/preload/index.ts" },
          output: { format: "cjs", entryFileNames: "[name].cjs" },
        },
      },
    },
  },
});
