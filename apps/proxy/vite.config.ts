import { defineConfig } from "vite";

// The server is bundled into one file with its workspace packages, so the
// image runs plain JavaScript (Node does not strip types under node_modules).
export default defineConfig({
  build: {
    ssr: "src/main.ts",
    outDir: "dist",
    emptyOutDir: true,
    target: "node24",
  },
  ssr: { noExternal: true },
});
