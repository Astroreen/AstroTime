// Who may connect to the dev server when it listens beyond localhost
// (scripts/t3/dev.sh): with ASTROTIME_WEB_CLIENTS=tailnet, this machine and
// devices on the owner's tailnet only, not the rest of a LAN or a café's
// Wi-Fi. Checked per connection, so Vite's HMR socket is covered too.
import type { Plugin } from "vite";

/** Loopback, and Tailscale's ranges: 100.64.0.0/10 and fd7a:115c:a1e0::/48. */
export function isTailnetOrLocal(address: string): boolean {
  const ip = address.toLowerCase().replace(/^::ffff:/, "");
  if (ip === "::1" || ip.startsWith("fd7a:115c:a1e0:")) return true;
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const [a = 0, b = 0] = parts.map(Number);
  return a === 127 || (a === 100 && b >= 64 && b <= 127);
}

export function devClients(clients = process.env["ASTROTIME_WEB_CLIENTS"]): Plugin {
  return {
    name: "astrotime-dev-clients",
    configureServer(server) {
      if (clients !== "tailnet") return;
      server.httpServer?.on("connection", (socket) => {
        if (!isTailnetOrLocal(socket.remoteAddress ?? "")) socket.destroy();
      });
    },
  };
}
