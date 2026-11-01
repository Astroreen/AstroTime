// serve_target (env.sh) decides which `tailscale serve` entry stop.sh may
// remove. The status below is in the shape `tailscale serve status --json`
// prints (Tailscale 1.9x), written by hand: no serve config could be made on
// the machine this was written on (scripts/t3/README.md).
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vite-plus/test";

function serveTarget(status: unknown, port: number): string | null {
  try {
    return execFileSync(
      "bash",
      [
        "-c",
        'source scripts/t3/env.sh && serve_target "$1" "$2"',
        "test",
        JSON.stringify(status),
        String(port),
      ],
      { env: { ...process.env, ASTROTIME_DEV_DIR: mkdtempSync(join(tmpdir(), "astrotime-dev-")) } },
    )
      .toString()
      .trim();
  } catch {
    return null;
  }
}

const entry = (handlers: Record<string, unknown>, host = "machine.tailnet.ts.net:5180") => ({
  TCP: { [host.split(":")[1]!]: { HTTPS: true } },
  Web: { [host]: { Handlers: handlers } },
});

test("the one / handler of the port is read", () => {
  expect(serveTarget(entry({ "/": { Proxy: "http://127.0.0.1:5180" } }), 5180)).toBe(
    "http://127.0.0.1:5180",
  );
});

test("another port, another path, a second handler, or a file server is nobody's to take", () => {
  expect(serveTarget(entry({ "/": { Proxy: "http://127.0.0.1:5180" } }), 443)).toBeNull();
  expect(serveTarget(entry({ "/app": { Proxy: "http://127.0.0.1:5180" } }), 5180)).toBeNull();
  expect(
    serveTarget(
      entry({
        "/api": { Proxy: "http://127.0.0.1:9000" },
        "/": { Proxy: "http://127.0.0.1:5180" },
      }),
      5180,
    ),
  ).toBeNull();
  expect(serveTarget(entry({ "/": { Path: "/srv/www" } }), 5180)).toBeNull();
  expect(serveTarget({}, 5180)).toBeNull();
});
