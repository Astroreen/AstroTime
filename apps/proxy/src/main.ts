// Starts the web app's server from its environment (README.md#self-hosting).
import { resolve } from "node:path";

import { allowlist, createAppServer } from "./server.ts";

const port = Number(process.env["PORT"] ?? 8080);
const root = resolve(process.env["ASTROTIME_WEB_ROOT"] ?? "apps/web/dist");
const server = createAppServer({ root, allow: allowlist(process.env["ASTROTIME_PROXY_ALLOW"]) });
server.listen(port, () => {
  console.log(`AstroTime on :${port}, serving ${root}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
