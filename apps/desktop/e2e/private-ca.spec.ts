// A self-hosted server with its own CA (docs/plans/desktop.md#D72): once the
// system trusts the CA, net.request reaches the server, as Chromium does; a
// certificate the system does not trust fails as an unreachable server
// (Deferred: "Untrusted certificates"). The CA goes into the user's NSS
// database (~/.pki/nssdb, which Chromium reads on Linux) under a HOME of the
// test's own. Needs openssl and certutil: the dev shell has both.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import type { HttpAnswer } from "../src/bridge.ts";
import { launch, profile } from "./support.ts";

const missing = ["openssl", "certutil"].filter((tool) => spawnSync(tool, ["-h"]).error);
test.skip(missing.length > 0, `needs ${missing.join(" and ")} (the dev shell has them)`);

/** A CA, and a certificate for localhost and 127.0.0.1 it signed. */
function certificates(dir: string) {
  const openssl = (command: string) =>
    execFileSync("openssl", command.split(" "), { cwd: dir, stdio: "pipe" });
  openssl(
    "req -x509 -newkey rsa:2048 -nodes -days 1 -keyout ca.key -out ca.pem -subj /CN=AstroTime-test-CA -addext basicConstraints=critical,CA:TRUE -addext keyUsage=critical,keyCertSign,cRLSign",
  );
  openssl("req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj /CN=localhost");
  writeFileSync(
    join(dir, "server.ext"),
    "subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n",
  );
  openssl(
    "x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 1 -out server.pem -extfile server.ext",
  );
  return {
    ca: join(dir, "ca.pem"),
    key: readFileSync(join(dir, "server.key")),
    cert: readFileSync(join(dir, "server.pem")),
  };
}

/** A HOME whose NSS database trusts `ca`, as `certutil` (or Chromium's settings) leaves it. */
function trusting(ca: string): string {
  const home = mkdtempSync(join(tmpdir(), "astrotime-home-"));
  const db = join(home, ".pki", "nssdb");
  mkdirSync(db, { recursive: true });
  const certutil = (...args: string[]) => execFileSync("certutil", ["-d", `sql:${db}`, ...args]);
  certutil("-N", "--empty-password");
  certutil("-A", "-t", "C,,", "-n", "AstroTime test CA", "-i", ca);
  return home;
}

test("a server whose CA the system trusts is reached; one it does not trust is unreachable", async () => {
  const { ca, key, cert } = certificates(mkdtempSync(join(tmpdir(), "astrotime-ca-")));
  const server = createServer({ key, cert }, (_request, response) => response.end("trusted"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port.");
  const url = `https://localhost:${address.port}/`;
  const get = (page: Awaited<ReturnType<typeof launch>>["page"]) =>
    page.evaluate(
      (target) =>
        (
          window as unknown as { astrotime: { http(r: object): Promise<HttpAnswer> } }
        ).astrotime.http({ method: "GET", url: target, headers: {} }),
      url,
    );

  const trusted = await launch(profile(), { env: { HOME: trusting(ca) } });
  expect(await get(trusted.page)).toMatchObject({ status: 200, url, body: "trusted" });
  await trusted.app.close();

  const untrusted = await launch(profile(), {
    env: { HOME: mkdtempSync(join(tmpdir(), "astrotime-home-")) },
  });
  expect(await get(untrusted.page)).toMatchObject({
    offline: expect.stringMatching(/could not reach the server/),
  });
  await untrusted.app.close();
  await new Promise((resolve) => server.close(resolve));
});
