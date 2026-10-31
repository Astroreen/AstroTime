// Real CalDAV servers for the integration tests (AGENTS.md: protocol code is
// tested against a real CalDAV server). Radicale runs for every test run: the
// dev shell and CI provide its binary, and the test waits for its "ready" log
// line, never for time. Nextcloud runs in CI's nightly job, which starts it
// and passes its address in ASTROTIME_NEXTCLOUD_URL.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CalDavServer {
  readonly name: string;
  readonly url: string;
  readonly username: string;
  readonly password: string;
  /** Creates a calendar and returns its URL. */
  mkcalendar(name: string, components?: readonly string[]): Promise<string>;
  /** Deletes a calendar as another client would. */
  deleteCalendar(url: string): Promise<void>;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") throw new Error("No free port.");
  return address.port;
}

export async function startRadicale(): Promise<CalDavServer> {
  const dir = mkdtempSync(join(tmpdir(), "astrotime-radicale-"));
  const port = await freePort();
  const username = "astro";
  const password = "secret";
  writeFileSync(join(dir, "users"), `${username}:${password}\n`);
  writeFileSync(
    join(dir, "config"),
    `[server]\nhosts = 127.0.0.1:${port}\n[auth]\ntype = htpasswd\nhtpasswd_filename = ${join(dir, "users")}\nhtpasswd_encryption = plain\n[storage]\nfilesystem_folder = ${join(dir, "collections")}\n[logging]\nlevel = info\n`,
  );
  const child: ChildProcess = spawn("radicale", ["--config", join(dir, "config")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((resolve, reject) => {
    let log = "";
    const onData = (chunk: Buffer) => {
      log += chunk.toString();
      if (log.includes("Radicale server ready")) resolve();
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (error) =>
      reject(
        new Error("Could not start radicale; is it installed (devenv shell)?", { cause: error }),
      ),
    );
    child.once("exit", (code) => reject(new Error(`radicale exited with ${code}:\n${log}`)));
  });

  const url = `http://127.0.0.1:${port}/`;
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  return {
    name: "Radicale",
    url,
    username,
    password,
    async mkcalendar(name, components = ["VEVENT", "VTODO"]) {
      const calendarUrl = `${url}${username}/${name}/`;
      const response = await fetch(calendarUrl, {
        method: "MKCALENDAR",
        headers: { Authorization: authorization, "Content-Type": "application/xml" },
        body: `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>${name}</d:displayname><ic:calendar-color>#0082c9ff</ic:calendar-color><c:supported-calendar-component-set>${components.map((c) => `<c:comp name="${c}"/>`).join("")}</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`,
      });
      if (response.status !== 201)
        throw new Error(`MKCALENDAR ${calendarUrl}: ${response.status} ${await response.text()}`);
      return calendarUrl;
    },
    async deleteCalendar(calendarUrl) {
      await fetch(calendarUrl, { method: "DELETE", headers: { Authorization: authorization } });
    },
    async stop() {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    },
  };
}

/**
 * A server someone else started (CI's nightly Nextcloud), from
 * `ASTROTIME_<NAME>_URL`, `_USERNAME` and `_PASSWORD`; `null` when unset.
 */
export function externalServer(name: string): CalDavServer | null {
  const key = name.toUpperCase();
  const url = process.env[`ASTROTIME_${key}_URL`];
  const username = process.env[`ASTROTIME_${key}_USERNAME`];
  const password = process.env[`ASTROTIME_${key}_PASSWORD`];
  if (!url || !username || !password) return null;
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  // The server outlives the tests; what they create is deleted at the end, or
  // every later run would sync it all again.
  const created: string[] = [];
  return {
    name,
    url,
    username,
    password,
    async mkcalendar(calendar, components = ["VEVENT", "VTODO"]) {
      // Nextcloud keeps calendars under /remote.php/dav/calendars/<user>/.
      const calendarUrl = new URL(
        `remote.php/dav/calendars/${encodeURIComponent(username)}/${calendar}/`,
        url,
      ).href;
      const response = await fetch(calendarUrl, {
        method: "MKCALENDAR",
        headers: { Authorization: authorization, "Content-Type": "application/xml" },
        body: `<?xml version="1.0"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:ic="http://apple.com/ns/ical/"><d:set><d:prop><d:displayname>${calendar}</d:displayname><ic:calendar-color>#0082c9ff</ic:calendar-color><c:supported-calendar-component-set>${components.map((c) => `<c:comp name="${c}"/>`).join("")}</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`,
      });
      if (response.status !== 201)
        throw new Error(`MKCALENDAR ${calendarUrl}: ${response.status} ${await response.text()}`);
      created.push(calendarUrl);
      return calendarUrl;
    },
    async deleteCalendar(calendarUrl) {
      await fetch(calendarUrl, { method: "DELETE", headers: { Authorization: authorization } });
    },
    async stop() {
      for (const calendarUrl of created.splice(0)) {
        await fetch(calendarUrl, { method: "DELETE", headers: { Authorization: authorization } });
      }
    },
  };
}
