import { EventEmitter } from "node:events";

import type { ViteDevServer } from "vite";
import { describe, expect, test } from "vite-plus/test";

import { devClients, isTailnetOrLocal } from "./dev-clients.ts";

describe("isTailnetOrLocal", () => {
  test("lets in this machine and the tailnet", () => {
    for (const ip of [
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "100.64.0.1",
      "100.64.12.34",
      "100.127.255.254",
      "::ffff:100.100.1.2",
      "fd7a:115c:a1e0::1",
      "FD7A:115C:A1E0:ab12::3",
    ]) {
      expect(isTailnetOrLocal(ip), ip).toBe(true);
    }
  });

  test("keeps out a LAN, the internet and look-alikes", () => {
    for (const ip of [
      "192.168.1.10",
      "10.0.0.2",
      "100.63.255.255",
      "100.128.0.1",
      "8.8.8.8",
      "fe80::1",
      "fd7a:115c:a1e1::1",
      "",
      "100.64",
      "0x7f.0.0.1",
      "1e2.64.0.1",
      "100..0.1",
    ]) {
      expect(isTailnetOrLocal(ip), ip).toBe(false);
    }
  });
});

describe("devClients", () => {
  // The dev server's HTTP server, as far as the plugin uses it.
  function serve(clients: string | undefined) {
    const httpServer = new EventEmitter();
    const hook = devClients(clients).configureServer;
    if (typeof hook !== "function") throw new Error("configureServer is a function");
    void hook.call({} as never, { httpServer } as unknown as ViteDevServer);
    return (remoteAddress: string) => {
      const socket = { remoteAddress, destroyed: false, destroy: () => (socket.destroyed = true) };
      httpServer.emit("connection", socket);
      return socket.destroyed;
    };
  }

  test("with tailnet clients, ends a LAN connection and keeps a tailnet one", () => {
    const connect = serve("tailnet");
    expect(connect("192.168.50.10")).toBe(true);
    expect(connect("100.64.12.34")).toBe(false);
    expect(connect("::ffff:127.0.0.1")).toBe(false);
  });

  test("without the setting, checks no one", () => {
    expect(serve(undefined)("192.168.50.10")).toBe(false);
  });

  test("refuses to start with a value it does not know, or no server", () => {
    expect(() => serve("Tailnet")).toThrow(/takes is "tailnet"/);
    const hook = devClients("tailnet").configureServer;
    if (typeof hook !== "function") throw new Error("configureServer is a function");
    expect(() => hook.call({} as never, { httpServer: null } as unknown as ViteDevServer)).toThrow(
      /own HTTP server/,
    );
  });
});
