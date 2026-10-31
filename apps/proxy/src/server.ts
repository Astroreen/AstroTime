// The web app's server (docs/plans/foundation.md#D20, D39): the built app's
// static files, and the CalDAV proxy at /dav-proxy/. It keeps no state.
import { createHash } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
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
  /** The hosts it answers for (`ASTROTIME_PUBLIC_HOST`, D81); any when absent. */
  readonly hosts?: readonly PublicHost[];
  readonly fetch?: typeof fetch;
}

/** A host name, and the port it must come with (null: any port). */
interface PublicHost {
  readonly hostname: string;
  readonly port: string | null;
}

/** Splits a Host header (`name`, `name:port`, `[v6]`, `[v6]:port`); null when it is not one. */
function splitHost(value: string): PublicHost | null {
  const match = /^(\[[0-9a-fA-F:.]+\]|[^\s:[\]/?#@\\]+)(?::(\d{1,5}))?$/.exec(value);
  if (!match?.[1]) return null;
  const port = match[2] === undefined ? null : Number(match[2]);
  if (port !== null && (port < 1 || port > 65535)) return null;
  try {
    return { hostname: new URL(`http://${match[1]}`).hostname, port: port?.toString() ?? null };
  } catch {
    return null;
  }
}

/**
 * Parses `ASTROTIME_PUBLIC_HOST` (D81): comma-separated host names the
 * server answers for, each with an optional port; unset or empty, any.
 */
export function publicHosts(value: string | undefined): PublicHost[] | undefined {
  const entries = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return undefined;
  return entries.map((entry) => {
    const host = splitHost(entry);
    const name = entry.replace(/:\d+$/, "").toLowerCase();
    // Spelled as browsers send it: lower case, punycode, no scheme or path.
    if (entry === "*" || host === null || host.hostname !== name) {
      throw new Error(
        `ASTROTIME_PUBLIC_HOST: "${entry}" is not a host name like calendar.example.com or calendar.example.com:8443`,
      );
    }
    return host;
  });
}

function listed(hosts: readonly PublicHost[], header: string | undefined): boolean {
  const host = header === undefined ? null : splitHost(header);
  return (
    host !== null &&
    hosts.some((h) => h.hostname === host.hostname && (h.port === null || h.port === host.port))
  );
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

/** What the image's build precompresses (compress.ts, D80), in the order the server prefers. */
const ENCODINGS = [
  ["br", ".br"],
  ["gzip", ".gz"],
] as const;

type Encoding = (typeof ENCODINGS)[number][0] | "identity";

/**
 * The coding to send among those on disk, by the client's Accept-Encoding
 * (RFC 9110, section 12.5.3): the highest q wins, a tie goes to the server's
 * order, and with no header the file goes as it is.
 */
export function negotiate(header: string | undefined, available: readonly Encoding[]): Encoding {
  const weights = new Map<string, number>();
  for (const part of (header ?? "").split(",")) {
    const [coding = "", ...params] = part.split(";").map((s) => s.trim().toLowerCase());
    if (!coding) continue;
    const q = params.find((p) => p.startsWith("q="));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    weights.set(coding, Number.isNaN(weight) ? 0 : weight);
  }
  // The file as it is stays acceptable unless refused, but loses to any
  // coding the client names.
  const weight = (coding: Encoding) =>
    weights.get(coding) ?? weights.get("*") ?? (coding === "identity" ? Number.MIN_VALUE : 0);
  let best: Encoding = "identity";
  let bestWeight = 0;
  for (const coding of [...available, "identity" as const]) {
    if (weight(coding) > bestWeight) [best, bestWeight] = [coding, weight(coding)];
  }
  // A client that refuses even the file as it is gets it anyway, not a 406.
  return best;
}

/** True when an If-None-Match header names this ETag (weak comparison, RFC 9110, 13.1.2). */
function matches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const strip = (tag: string) => tag.trim().replace(/^W\//, "");
  return header.trim() === "*" || header.split(",").some((tag) => strip(tag) === strip(etag));
}

/**
 * The static files of one root (D80). Files are streamed, never held in
 * memory; only each file's ETag is kept, hashed from its content once and
 * again only when its size or time changes.
 */
function staticFiles(root: string) {
  const etags = new Map<string, { readonly stamp: string; readonly etag: Promise<string> }>();
  const etagOf = (file: string, info: Stats): Promise<string> => {
    const stamp = `${info.ino}:${info.size}:${info.mtimeMs}`;
    const known = etags.get(file);
    if (known?.stamp === stamp) return known.etag;
    const etag = (async () => {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
      return `"${hash.digest("base64url").slice(0, 22)}"`;
    })();
    const entry = { stamp, etag };
    etags.set(file, entry);
    // A file that could not be read is hashed afresh next time.
    etag.catch(() => etags.get(file) === entry && etags.delete(file));
    return etag;
  };
  const isFile = (path: string) =>
    stat(path).then(
      (info) => (info.isFile() ? info : null),
      () => null,
    );

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const file = resolve(join(root, path));
    // Nothing outside the app's directory, whatever the path says; and the
    // precompressed copies are reached only through Accept-Encoding.
    if (
      (file !== root && !file.startsWith(root + sep)) ||
      ENCODINGS.some(([, suffix]) => file.endsWith(suffix))
    ) {
      res.writeHead(404).end();
      return;
    }
    const found = await isFile(file);
    // Judged on the resolved file, so `/assets/..%2findex.html` is not an asset.
    const asset = file.startsWith(join(root, "assets") + sep);
    // A missing asset, or a missing file of a type we serve (`/favicon.ico`,
    // `/robots.txt`), is missing; anything else (`/day/2026.10.31`) is a route
    // of the single-page app.
    if (!found && (asset || extname(path).toLowerCase() in TYPES)) {
      res.writeHead(404).end();
      return;
    }
    const target = found ? file : join(root, "index.html");
    const variants = await Promise.all(
      ENCODINGS.map(async ([coding, suffix]) => ({
        coding,
        file: target + suffix,
        info: await isFile(target + suffix),
      })),
    );
    const coding = negotiate(
      req.headers["accept-encoding"],
      variants.filter((v) => v.info).map((v) => v.coding),
    );
    const variant = variants.find((v) => v.coding === coding);
    const sent = variant?.file ?? target;
    const info = variant?.info ?? (found || (await stat(target)));
    const etag = await etagOf(sent, info);
    // Vite names what it puts in assets/ by its content: it never changes.
    // Everything else, index.html first, is asked about again every time.
    const immutable = asset && target === file;
    const headers: Record<string, string | number> = {
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      ETag: etag,
      Vary: "Accept-Encoding",
      "X-Content-Type-Options": "nosniff",
    };
    if (matches(req.headers["if-none-match"], etag)) {
      res.writeHead(304, headers).end();
      return;
    }
    res.writeHead(200, {
      ...headers,
      "Content-Type": TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": info.size,
      ...(variant ? { "Content-Encoding": coding } : {}),
    });
    if (req.method === "HEAD") return void res.end();
    await pipeline(createReadStream(sent), res).catch((error: { code?: string }) => {
      // A client that went away midway is ordinary, not an error to log.
      if (error.code !== "ERR_STREAM_PREMATURE_CLOSE") throw error;
    });
  };
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
  const serveStatic = staticFiles(root);
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
      // Any Host: it tells nothing, and health checks come by loopback or the
      // container's own address (D81).
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    } else if (options.hosts && !listed(options.hosts, req.headers.host)) {
      // Against DNS rebinding: a page on a name that is not ours never reaches
      // the app or the proxy, whatever address that name points to (D81).
      res
        .writeHead(421, { "Content-Type": "text/plain; charset=utf-8" })
        .end("This server does not answer for this host.");
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
      // A file of our own that cannot be read is our failure, not an upstream's.
      serveStatic(req, res).catch((error: unknown) => {
        console.error(error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    } else {
      res.writeHead(405).end();
    }
  });
}
