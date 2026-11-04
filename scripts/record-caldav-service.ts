// Records a CalDAV service (docs/plans/providers.md#D249): the scenario of
// packages/caldav/test/scenario.ts against a test account, every request and
// answer kept with the account's own values put out, into
// packages/caldav/test/fixtures/services/<service>.json, which
// services.test.ts replays on every run. By hand, from a test account only
// (never the owner's own):
//
//   ASTROTIME_RECORD_SERVICE=icloud ASTROTIME_RECORD_URL=https://caldav.icloud.com/ \
//   ASTROTIME_RECORD_USERNAME=… ASTROTIME_RECORD_PASSWORD=… \
//   node scripts/record-caldav-service.ts
//
// ASTROTIME_RECORD_TASKS=false for a service without tasks;
// ASTROTIME_RECORD_REDACT, comma-separated, for more values to put out (an
// e-mail the service shows beside the user name). Path segments that look
// like a service's account id (six digits or more, a UUID) are put out too.
// It refuses to write a file that still holds any of them or the password,
// in any spelling (recording.ts, `leaks`). ASTROTIME_RECORD_PUBLIC_USERNAME=true
// only for a local test server whose user name is a fixed public one.
import { writeFileSync } from "node:fs";

import { CalDavProvider, fetchClient } from "../packages/caldav/src/index.ts";

import { recorder, redacted, type Recording } from "../packages/caldav/test/recording.ts";
import { calendarName, scenario } from "../packages/caldav/test/scenario.ts";

const env = (name: string) => {
  const value = process.env[`ASTROTIME_RECORD_${name}`];
  if (!value) throw new Error(`ASTROTIME_RECORD_${name} is not set.`);
  return value;
};
const service = env("SERVICE");
if (!/^[a-z0-9-]+$/.test(service))
  throw new Error("ASTROTIME_RECORD_SERVICE: a-z, 0-9 and - only.");
const server = env("URL");
const credentials = { username: env("USERNAME"), password: env("PASSWORD") };
const tasks = process.env["ASTROTIME_RECORD_TASKS"] !== "false";

// The user name of a local test server (the interop run's) is public, and
// may stand in a recording; never a cloud account's.
const local = /^(127\.\d+\.\d+\.\d+|localhost|\[::1\])$/.test(new URL(server).hostname);
const publicUsername = process.env["ASTROTIME_RECORD_PUBLIC_USERNAME"] === "true";
if (publicUsername && !local)
  throw new Error("ASTROTIME_RECORD_PUBLIC_USERNAME is for a local test server only.");
const calendar = calendarName();
const { http, exchanges, sent } = recorder(fetchClient());
const result = await scenario(http, server, credentials, { tasks, calendar });
const { principalUrl, homeUrl } = await CalDavProvider.discover(fetchClient(), server, credentials);

const secrets = new Map<string, string>([
  [credentials.username, credentials.username.includes("@") ? "user@example.com" : "user"],
]);
const name = credentials.username.split("@")[0]!;
if (name !== credentials.username) secrets.set(name, "user");
for (const extra of (process.env["ASTROTIME_RECORD_REDACT"] ?? "").split(",").filter(Boolean))
  secrets.set(extra, `redacted-${secrets.size}`);
for (const url of [principalUrl, homeUrl]) {
  for (const segment of new URL(url).pathname.split("/")) {
    if (/\d{6,}|^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment) && !secrets.has(segment))
      secrets.set(segment, `account-${secrets.size}`);
  }
}
const recording: Recording = {
  service,
  recorded: new Date().toISOString().slice(0, 10),
  origin: new URL(server).origin,
  server,
  calendar,
  exchanges,
};
const out = new URL(`../packages/caldav/test/fixtures/services/${service}.json`, import.meta.url);
writeFileSync(
  out,
  `${JSON.stringify(
    redacted(recording, secrets, {
      ...credentials,
      extra: [...secrets.keys()].filter((value) => value !== credentials.username),
      sent,
      publicUsername,
    }),
    null,
    2,
  )}\n`,
);
console.log(`${exchanges.length} exchanges recorded into ${out.pathname}`);
console.log(JSON.stringify(result));
