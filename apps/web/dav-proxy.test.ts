import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { ViteDevServer } from "vite";
import { expect, test } from "vite-plus/test";

import { davProxy } from "./dav-proxy.ts";

/** The status the proxy answers a request with, without reaching any server. */
function statusFor(env: Record<string, string>, host: string | undefined): number {
  const hook = davProxy(env).configureServer;
  if (typeof hook !== "function") throw new Error("configureServer is a function");
  let middleware: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
  hook.call(
    {} as never,
    {
      config: { server: { host } },
      middlewares: { use: (_: string, fn: typeof middleware) => (middleware = fn) },
    } as unknown as ViteDevServer,
  );
  const res = Object.assign(new EventEmitter(), {
    statusCode: 0,
    setHeader() {},
    end() {},
  }) as unknown as ServerResponse;
  middleware?.({ url: "/https%3A%2F%2Fdav.example/" } as IncomingMessage, res);
  return res.statusCode;
}

test("beyond localhost, or for tailnet clients through a front on loopback, the allowlist is required", () => {
  expect(statusFor({}, "0.0.0.0")).toBe(403);
  expect(statusFor({ ASTROTIME_WEB_CLIENTS: "tailnet" }, "127.0.0.1")).toBe(403);
  expect(statusFor({ ASTROTIME_WEB_CLIENTS: "tailnet" }, undefined)).toBe(403);
});

test("on localhost alone, or with a list, the request goes on to the proxy", () => {
  // Not refused: the status is left for the proxy's answer to set.
  expect(statusFor({}, "127.0.0.1")).toBe(0);
  expect(statusFor({ ASTROTIME_PROXY_ALLOW: "https://dav.example" }, "0.0.0.0")).toBe(0);
});
