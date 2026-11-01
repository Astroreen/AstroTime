// Builds the web app's service worker (docs/plans/foundation.md#D124):
// `sw/sw.ts` becomes `/sw.js` beside the page, and the list of every file
// the build wrote (and the public ones: the manifest and its icons), with a
// hash of them as the version, is written into it. Only the build has one;
// the dev server registers none (src/main.tsx).
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Plugin } from "vite";

const SW = "sw.js";

export function serviceWorker(): Plugin {
  let publicDir = "";
  return {
    name: "astrotime-service-worker",
    apply: "build",
    config: () => ({
      build: {
        rollupOptions: {
          input: { index: "index.html", sw: "sw/sw.ts" },
          output: {
            // At the root, under a name that never changes: its scope is the app.
            entryFileNames: (chunk) => (chunk.name === "sw" ? SW : "assets/[name]-[hash].js"),
          },
        },
      },
    }),
    configResolved(config) {
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      const worker = bundle[SW];
      if (!worker || worker.type !== "chunk") throw new Error(`The build wrote no ${SW}.`);
      const hash = createHash("sha256");
      const built = Object.keys(bundle).filter(
        (file) => file !== SW && file !== "index.html" && !file.endsWith(".map"),
      );
      const own = publicDir && existsSync(publicDir) ? readdirSync(publicDir).toSorted() : [];
      for (const file of own) hash.update(file).update(readFileSync(join(publicDir, file)));
      const files = ["/", ...[...built, ...own].toSorted().map((file) => `/${file}`)];
      for (const file of files) hash.update(file);
      const version = hash.digest("base64url").slice(0, 16);
      const code = worker.code
        .replaceAll("ASTROTIME_PRECACHE", JSON.stringify(files))
        .replaceAll("ASTROTIME_VERSION", JSON.stringify(version));
      if (code === worker.code) throw new Error(`${SW} lost the places its file list goes.`);
      worker.code = code;
    },
  };
}
