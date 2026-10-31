import { describe, expect, test } from "vite-plus/test";

import { isTailnetOrLocal } from "./dev-clients.ts";

describe("isTailnetOrLocal", () => {
  test("lets in this machine and the tailnet", () => {
    for (const ip of [
      "127.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "100.64.0.1",
      "100.72.90.18",
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
    ]) {
      expect(isTailnetOrLocal(ip), ip).toBe(false);
    }
  });
});
