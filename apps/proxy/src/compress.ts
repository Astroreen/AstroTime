// Precompresses the built app once, when the image is built
// (docs/plans/foundation.md#D80): a `.br` and a `.gz` next to each text file,
// kept only where they are smaller. The server picks one by Accept-Encoding.
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/** Types worth compressing; images and fonts are compressed already. */
const COMPRESSIBLE = new Set([
  ".html",
  ".js",
  ".mjs",
  ".css",
  ".json",
  ".map",
  ".svg",
  ".txt",
  ".webmanifest",
  ".wasm",
  ".ico",
]);

/** Writes the compressed variants of every compressible file under `root`; returns how many. */
export async function compress(root: string): Promise<number> {
  let written = 0;
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !COMPRESSIBLE.has(extname(entry.name).toLowerCase())) continue;
    const file = join(entry.parentPath, entry.name);
    const body = await readFile(file);
    const variants: [string, Buffer][] = [
      [
        ".br",
        brotliCompressSync(body, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: body.length,
          },
        }),
      ],
      [".gz", gzipSync(body, { level: constants.Z_BEST_COMPRESSION })],
    ];
    for (const [suffix, packed] of variants) {
      // A tiny file can come out larger: then it is served as it is, and a
      // copy left from an earlier run of an older file goes.
      await rm(file + suffix, { force: true });
      if (packed.length >= body.length) continue;
      await writeFile(file + suffix, packed);
      written++;
    }
  }
  return written;
}

if (import.meta.main) {
  const root = resolve(process.argv[2] ?? "apps/web/dist");
  console.log(`Precompressed ${await compress(root)} files in ${root}`);
}
