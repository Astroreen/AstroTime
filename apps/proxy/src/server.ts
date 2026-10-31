// The web app's server (docs/plans/foundation.md#D20, D39): the built app's
// static files, and the CalDAV proxy at /dav-proxy/. It keeps no state.
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { extname, join, resolve, sep } from "node:path";

import { proxyHandler } from "@astrotime/caldav";

export const DAV_PROXY_PREFIX = "/dav-proxy/";

/** The largest request passed on: a calendar object or a report is a few kilobytes. */
const MAX_REQUEST_BYTES = 10 * 1024 * 1024;

class TooLarge extends Error {}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
  ".mjs": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
};

export interface ServerOptions {
  /** The built web app (`apps/web/dist`). */
  readonly root: string;
  /** Origins the proxy may reach; required, never "*" in production. */
  readonly allow: readonly string[];
  readonly fetch?: typeof fetch;
}

/** Parses `ASTROTIME_PROXY_ALLOW`: a comma-separated list of origins. */
export function allowlist(value: string | undefined): string[] {
  const origins = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (origins.length === 0) {
    throw new Error(
      "ASTROTIME_PROXY_ALLOW must list the CalDAV servers the proxy may reach, e.g. https://cloud.example.com",
    );
  }
  for (const origin of origins) {
    let parsed: string | null = null;
    try {
      parsed = new URL(origin).origin;
    } catch {
      // Reported below, with the entry that is wrong.
    }
    if (origin === "*" || parsed !== origin) {
      throw new Error(
        `ASTROTIME_PROXY_ALLOW: "${origin}" is not an origin like https://cloud.example.com`,
      );
    }
  }
  return origins;
}

/**
 * Requests that went over the cap while streaming. The error itself reaches
 * the proxy wrapped in fetch's own, so the server remembers which they were.
 */
const overCap = new WeakSet<IncomingMessage>();

/** The request body as a stream, read only if the proxy lets the request through, and capped. */
async function* capped(req: IncomingMessage): AsyncGenerator<Buffer> {
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_REQUEST_BYTES) {
      overCap.add(req);
      throw new TooLarge();
    }
    yield chunk as Buffer;
  }
}

function toRequest(req: IncomingMessage, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers,
    signal,
    // Streamed: a request the proxy refuses (another origin, an unlisted
    // server) is answered without its body being read.
    ...(hasBody
      ? {
          body: Readable.toWeb(Readable.from(capped(req))) as ReadableStream,
          duplex: "half" as const,
        }
      : {}),
  } as RequestInit);
}

async function serveStatic(root: string, url: string, res: ServerResponse): Promise<void> {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url, "http://x").pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = resolve(join(root, path));
  // Nothing outside the app's directory, whatever the path says.
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(404).end();
    return;
  }
  const found = await stat(file).catch(() => null);
  // Judged on the resolved file, so `/assets/..%2findex.html` is not an asset.
  const asset = file.startsWith(join(root, "assets") + sep);
  // A missing asset, or a missing file (`/favicon.ico`, `/robots.txt`), is
  // missing; only a path without an extension is a route of the single-page app.
  if (!found?.isFile() && (asset || extname(path) !== "")) {
    res.writeHead(404).end();
    return;
  }
  const target = found?.isFile() ? file : join(root, "index.html");
  const body = await readFile(target);
  // Vite names what it puts in assets/ by its content: it never changes.
  const immutable = asset && target === file;
  res.writeHead(200, {
    "Content-Type": TYPES[extname(target)] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
}

export function createAppServer(options: ServerOptions): Server {
  const root = resolve(options.root);
  const server = createAppHandler(options, root);
  // A client that sends its request slowly, or never finishes it, is cut off.
  server.requestTimeout = 60_000;
  server.headersTimeout = 20_000;
  return server;
}

function createAppHandler(options: ServerOptions, root: string): Server {
  const proxy = proxyHandler({
    prefix: DAV_PROXY_PREFIX,
    allow: options.allow,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return createServer((req, res) => {
    const url = req.url ?? "/";
    // The cause goes to the log; the client learns only that it failed.
    const done = (error: unknown) => {
      if (overCap.has(req)) error = new TooLarge();
      if (!(error instanceof TooLarge)) console.error(error);
      if (!res.headersSent) {
        res.writeHead(
          error instanceof TooLarge ? 413 : 502,
          error instanceof TooLarge ? { Connection: "close" } : {},
        );
      }
      res.end();
    };
    const path = url.split("?")[0];
    if (path === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    } else if (url.startsWith(DAV_PROXY_PREFIX)) {
      // Refused before reading a byte when the size is announced; a body
      // without one is counted as it arrives.
      if (Number(req.headers["content-length"] ?? 0) > MAX_REQUEST_BYTES) {
        // The answer goes out first; the connection closes after it, unread.
        res.writeHead(413, { Connection: "close" }).end();
        return;
      }
      // A client that goes away cancels its request to the server.
      const gone = new AbortController();
      res.on("close", () => {
        if (!res.writableFinished) gone.abort();
      });
      Promise.resolve()
        .then(() => proxy(toRequest(req, gone.signal)))
        .then((response) => {
          if (overCap.has(req)) throw new TooLarge();
          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          // Someone's calendar, fetched with their credentials: never kept by a cache.
          res.setHeader("Cache-Control", "no-store");
          // Served on the app's own origin: never sniffed into something runnable.
          res.setHeader("X-Content-Type-Options", "nosniff");
          if (!response.body) return void res.end();
          // Broken midway, the answer is cut off, not ended: a client must not
          // take a truncated multistatus for a whole one.
          Readable.fromWeb(response.body as NodeReadableStream)
            .on("error", (error) => {
              // A client that went away is ordinary, not an error to log.
              if (!gone.signal.aborted) console.error(error);
              res.destroy(error);
            })
            .pipe(res);
        })
        .catch(done);
    } else if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(root, url, res).catch(done);
    } else {
      res.writeHead(405).end();
    }
  });
}
