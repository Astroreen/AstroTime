import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  // The React Compiler memoizes components, as in Jhin and T3 Code.
  plugins: [react({ compiler: true }), tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
