// The app's files on app://astrotime/ (docs/plans/desktop.md#D71), from the
// built renderer (in the app's asar once packaged), never from file://. The
// page comes with the desktop's Content Security Policy and a fresh nonce,
// as the web image's server sends it (foundation D110). Apart from Electron,
// so it is tested in Node.
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, sep } from "node:path";

import { APP_HOST } from "../bridge.ts";

/** What Vite's build writes where the page's nonce goes (`html.cspNonce` in vite.config.ts). */
const NONCE_PLACEHOLDER = "astrotime-csp-nonce";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * The page's policy: the web's (foundation D110) without what only the web
 * needs. No `connect-src`: the renderer reaches no network itself, every
 * request goes through the main process (D72); no worker and no wasm, since
 * the store runs in its own process (D73).
 */
function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    // The built stylesheet, and the <style> elements Base UI adds, which carry the nonce.
    `style-src 'self' 'nonce-${nonce}'`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Answers app://astrotime/ from the files under `root`: `/` is the page. */
export function appFiles(root: string): (request: Request) => Promise<Response> {
  const page = join(root, "index.html");
  return async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return notFound();
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405 });
    }
    let file: string;
    try {
      file = url.pathname === "/" ? page : join(root, decodeURIComponent(url.pathname));
    } catch {
      return notFound();
    }
    const inside = relative(root, file);
    if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return notFound();
    let body: Buffer;
    try {
      body = await readFile(file);
    } catch {
      return notFound();
    }
    const type = TYPES[extname(file)] ?? "application/octet-stream";
    if (file !== page)
      return new Response(new Uint8Array(body), { headers: { "content-type": type } });
    const nonce = randomBytes(16).toString("base64");
    return new Response(body.toString("utf8").replaceAll(NONCE_PLACEHOLDER, nonce), {
      headers: { "content-type": type, "content-security-policy": contentSecurityPolicy(nonce) },
    });
  };
}

const notFound = () => new Response("Not found.", { status: 404 });
