import { EventEmitter } from "node:events";

import type { ViteDevServer } from "vite";
import { describe, expect, test } from "vite-plus/test";

import { devTls } from "./dev-tls.ts";

// The forwarding itself is proven end to end by scripts/t3/smoke.sh, with a
// certificate dev.sh makes; here, when the plugin starts and when it refuses.
describe("devTls", () => {
  function configure(env: Record<string, string>, httpServer: unknown = new EventEmitter()) {
    const hook = devTls(env).configureServer;
    if (typeof hook !== "function") throw new Error("configureServer is a function");
    return () => hook.call({} as never, { httpServer } as unknown as ViteDevServer);
  }

  test("without a certificate, adds no front", () => {
    const httpServer = new EventEmitter();
    configure({}, httpServer)();
    expect(httpServer.listenerCount("listening")).toBe(0);
  });

  test("refuses to start with half a setup, or no server", () => {
    expect(configure({ ASTROTIME_WEB_TLS_CERT: "cert.pem" })).toThrow(
      /needs ASTROTIME_WEB_TLS_CERT/,
    );
    expect(
      configure({
        ASTROTIME_WEB_TLS_CERT: "cert.pem",
        ASTROTIME_WEB_TLS_KEY: "key.pem",
        ASTROTIME_WEB_HTTPS_HOST: "100.72.90.18",
        ASTROTIME_WEB_HTTPS_PORT: "https",
      }),
    ).toThrow(/ASTROTIME_WEB_HTTPS_PORT/);
    expect(
      configure(
        {
          ASTROTIME_WEB_TLS_CERT: "cert.pem",
          ASTROTIME_WEB_TLS_KEY: "key.pem",
          ASTROTIME_WEB_HTTPS_HOST: "100.72.90.18",
          ASTROTIME_WEB_HTTPS_PORT: "5180",
        },
        null,
      ),
    ).toThrow(/own HTTP server/);
  });
});
