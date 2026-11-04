// Every recorded service replayed (docs/plans/providers.md#D249): the
// scenario the recording was made with runs against it, asks exactly what
// was asked, nothing more, and finds what the service answered then.
import { readdirSync, readFileSync } from "node:fs";

import { expect, test } from "vite-plus/test";

import type { Recording } from "./recording.ts";
import { redacted, replay } from "./recording.ts";
import { scenario } from "./scenario.ts";

const folder = new URL("./fixtures/services/", import.meta.url);
const recordings = readdirSync(folder)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(new URL(file, folder), "utf8")) as Recording);

test.each(recordings.map((recording) => [recording.service, recording] as const))(
  "the recording of %s replays: discovery, a calendar made, items found, changed and deleted",
  async (_service, recording) => {
    const http = replay(recording);
    const tasks = recording.exchanges.some((exchange) =>
      exchange.request.body?.includes("BEGIN:VTODO"),
    );
    const result = await scenario(
      http,
      recording.server,
      { username: "user", password: "recorded" },
      { tasks },
    );
    expect(result.found).toEqual(tasks ? ["Recorded event", "Recorded task"] : ["Recorded event"]);
    expect(result.changed).toEqual(["Recorded event changed"]);
    expect(result.removed).toBe(true);
    // Nothing recorded was left unasked.
    expect(http.left()).toBe(0);
  },
);

test("a replay fails on a request the recording does not hold, and a recording keeping a secret is refused", async () => {
  const recording: Recording = {
    service: "example",
    recorded: "2026-11-04",
    origin: "https://dav.example",
    server: "https://dav.example/",
    exchanges: [
      {
        request: { method: "GET", path: "/a", depth: null, body: null },
        response: { status: 200, path: "/a", headers: {}, body: "secrets 4711" },
      },
    ],
  };
  const http = replay(recording);
  await expect(http({ method: "GET", url: "https://dav.example/b", headers: {} })).rejects.toThrow(
    /Request 1 is not the recording's/,
  );
  expect((await http({ method: "GET", url: "https://dav.example/a", headers: {} })).body).toBe(
    "secrets 4711",
  );
  // Past its end, nothing more is answered.
  await expect(
    http({ method: "GET", url: "https://dav.example/a", headers: {} }),
  ).rejects.toThrow();
  expect(
    redacted(recording, new Map([["4711", "account-1"]]), "pw").exchanges[0]!.response.body,
  ).toBe("secrets account-1");
  // A short name inside a longer word is no match; the password, anywhere, is refused.
  expect(redacted(recording, new Map([["secret", "user"]]), "pw").exchanges[0]!.response.body).toBe(
    "secrets 4711",
  );
  expect(() => redacted(recording, new Map(), "4711")).toThrow(/not written/);
});
