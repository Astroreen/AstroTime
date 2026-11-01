// Starts the web app's server from its environment (README.md#self-hosting).
import { resolve } from "node:path";

import { presetFrom } from "@astrotime/caldav";

import { allowlist, createAppServer, publicHosts } from "./server.ts";

const port = Number(process.env["PORT"] || 8080);
// A typo here would listen on a random port that the healthcheck never finds.
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`PORT must be a port number, not "${process.env["PORT"]}"`);
}
const root = resolve(process.env["ASTROTIME_WEB_ROOT"] ?? "apps/web/dist");
const hosts = publicHosts(process.env["ASTROTIME_PUBLIC_HOST"]);
// A single-user preset (D123) names the server, which the proxy then carries.
const preset = presetFrom(process.env);
const server = createAppServer({
  root,
  allow: allowlist(process.env["ASTROTIME_PROXY_ALLOW"], preset),
  ...(hosts ? { hosts } : {}),
  ...(preset ? { preset } : {}),
});
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
