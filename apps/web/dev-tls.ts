// The dev server's https front for the owner's tailnet devices when
// `tailscale serve` may not run (scripts/t3/dev.sh): browsers give the web
// store OPFS and Web Locks only in a secure context, which plain http is on
// localhost alone. With ASTROTIME_WEB_TLS_CERT and ASTROTIME_WEB_TLS_KEY set,
// a TLS listener on ASTROTIME_WEB_HTTPS_HOST:ASTROTIME_WEB_HTTPS_PORT forwards
// each connection to the dev server, which stays plain http on localhost.
import { readFileSync } from "node:fs";
import { connect, type AddressInfo, type Socket } from "node:net";
import { createServer } from "node:tls";

import type { Plugin, ViteDevServer } from "vite";

import { isTailnetOrLocal } from "./dev-clients.ts";

/**
 * Lets in this machine and the tailnet only, even if the front's address is
 * reachable from a LAN (Linux answers for any of its addresses on any
 * interface): any other connection is destroyed before its handshake.
 */
export function guard(front: {
  on(event: "connection", listener: (socket: Socket) => void): unknown;
}): void {
  front.on("connection", (socket) => {
    if (!isTailnetOrLocal(socket.remoteAddress ?? "")) socket.destroy();
  });
}

/** The fronts this process runs, by address, with the dev server each forwards to now. */
const fronts = new Map<string, { http: NonNullable<ViteDevServer["httpServer"]> }>();

export function devTls(env = process.env): Plugin {
  return {
    name: "astrotime-dev-tls",
    configureServer(server) {
      const cert = env["ASTROTIME_WEB_TLS_CERT"];
      const key = env["ASTROTIME_WEB_TLS_KEY"];
      const host = env["ASTROTIME_WEB_HTTPS_HOST"];
      const portText = env["ASTROTIME_WEB_HTTPS_PORT"] ?? "";
      if (!cert && !key) return;
      // Fails closed, as dev-clients.ts does: half a setup stops the dev server.
      if (!cert || !key || !host || !/^\d+$/.test(portText)) {
        throw new Error(
          "The https front needs ASTROTIME_WEB_TLS_CERT, ASTROTIME_WEB_TLS_KEY, ASTROTIME_WEB_HTTPS_HOST and ASTROTIME_WEB_HTTPS_PORT.",
        );
      }
      const port = Number(portText);
      const http = server.httpServer;
      if (!http) throw new Error("The https front needs the dev server's own HTTP server.");
      // Vite runs configureServer again when it restarts (an edited config):
      // the front then stays up and forwards to the new server, so its port
      // is never asked for twice.
      const running = fronts.get(`${host}:${port}`);
      if (running) {
        running.http = http;
        return;
      }
      const entry: { http: typeof http } = { http };
      // Bytes after the handshake are passed through as they are, so Vite's
      // HMR socket works through it too.
      const front = createServer({ cert: readFileSync(cert), key: readFileSync(key) }, (socket) => {
        const { address, port: target } = entry.http.address() as AddressInfo;
        const upstream = connect(target, address);
        socket.pipe(upstream).pipe(socket);
        // Either side going away, by an error or a plain close, takes the other.
        socket.on("close", () => upstream.destroy());
        upstream.on("close", () => socket.destroy());
        socket.on("error", () => upstream.destroy());
        upstream.on("error", () => socket.destroy());
      });
      fronts.set(`${host}:${port}`, entry);
      guard(front);
      front.on("error", (error) => {
        server.config.logger.error(`astrotime: the https front failed: ${error.message}`);
        process.exit(1);
      });
      http.once("listening", () => {
        front.listen(port, host, () => {
          // dev.sh waits for this line.
          const name = host.includes(":") ? `[${host}]` : host;
          server.config.logger.info(`  ➜  Https:   https://${name}:${port}/`);
        });
      });
      // The front ends with the process (dev.sh stops it), not with one Vite server.
      front.unref();
    },
  };
}
