// Starts the web app's server from its environment (README.md#self-hosting).
import { resolve } from "node:path";

import { allowlist, createAppServer } from "./server.ts";

const port = Number(process.env["PORT"] || 8080);
// A typo here would listen on a random port that the healthcheck never finds.
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be a port number, not "${process.env["PORT"]}"`);
}
const root = resolve(process.env["ASTROTIME_WEB_ROOT"] ?? "apps/web/dist");
const server = createAppServer({ root, allow: allowlist(process.env["ASTROTIME_PROXY_ALLOW"]) });
server.listen(port, () => {
  console.log(`AstroTime on :${port}, serving ${root}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Idle connections go now; requests in flight (a PUT on its way to the
    // CalDAV server) get a few seconds to finish, inside docker stop's 10.
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 7_000).unref();
  });
}
