// The CORS proxy in the dev server (docs/plans/foundation.md#D20): the web app
// reaches CalDAV servers through /dav-proxy/ on its own origin. The dev server
// listens on localhost only, so any server may be reached unless
// ASTROTIME_PROXY_ALLOW lists the allowed origins (comma-separated).
import type { IncomingMessage, ServerResponse } from "node:http";

import { proxyHandler } from "@astrotime/caldav";
import type { Plugin } from "vite";

export const DAV_PROXY_PREFIX = "/dav-proxy/";

async function toRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers,
    ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
  });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function davProxy(): Plugin {
  const allow = process.env["ASTROTIME_PROXY_ALLOW"]
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const handle = proxyHandler({ prefix: DAV_PROXY_PREFIX, allow: allow?.length ? allow : "*" });
  return {
    name: "astrotime-dav-proxy",
    configureServer(server) {
      // Open to any server only while the dev server is reachable from this
      // machine alone; with --host, a client elsewhere could use it as a relay.
      const host = server.config.server.host;
      const local =
        host === undefined || host === "localhost" || host === "127.0.0.1" || host === "::1";
      server.middlewares.use(DAV_PROXY_PREFIX, (req, res) => {
        if (!allow?.length && !local) {
          res.statusCode = 403;
          res.end(
            "The dev server listens beyond localhost: list the CalDAV servers in ASTROTIME_PROXY_ALLOW.",
          );
          return;
        }
        // Connect strips the mount path; the handler needs the whole URL.
        req.url = `${DAV_PROXY_PREFIX.slice(0, -1)}${req.url ?? "/"}`;
        toRequest(req)
          .then(handle)
          .then((response) => send(res, response))
          .catch((error: unknown) => {
            res.statusCode = 502;
            res.end(error instanceof Error ? error.message : String(error));
          });
      });
    },
  };
}
