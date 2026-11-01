// HTTP from the main process (docs/plans/desktop.md#D72), through the page's
// bridge as the adapter calls it: net.request with redirects followed by the
// shared rule, so the answer names the URL that answered and Authorization
// never reaches another host or port; no cookie is kept; an unreachable
// server is offline; and the main process takes no request but an http(s) one.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { test as base, expect } from "@playwright/test";

import type { HttpAnswer } from "../src/bridge.ts";
import { launch, profile } from "./support.ts";

/** Answers `/to/<status>/<url>` with a redirect there; `/cookie` sets one; anything else echoes the request. */
function respond(request: IncomingMessage, response: ServerResponse) {
  let body = "";
  request.on("data", (chunk: Buffer) => (body += chunk.toString()));
  request.on("end", () => {
    const redirect = /^\/to\/(\d{3})\/(.+)$/.exec(request.url ?? "");
    if (redirect) {
      response.writeHead(Number(redirect[1]), { location: decodeURIComponent(redirect[2]!) });
      return response.end();
    }
    if (request.url === "/cookie") {
      response.writeHead(200, { "set-cookie": "session=1; Path=/" });
      return response.end();
    }
    response.writeHead(200, { "content-type": "application/json" });
    const { authorization = null, cookie = null } = request.headers;
    response.end(JSON.stringify({ method: request.method, authorization, cookie, body }));
  });
}

async function listen(): Promise<{ server: Server; port: number }> {
  const server = createServer(respond);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port.");
  return { server, port: address.port };
}

const test = base.extend<{ servers: { a: number; b: number; closed: number } }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  servers: async ({}, use) => {
    const [a, b, gone] = await Promise.all([listen(), listen(), listen()]);
    // A port nothing listens on any more.
    await new Promise((resolve) => gone.server.close(resolve));
    await use({ a: a.port, b: b.port, closed: gone.port });
    await Promise.all([a, b].map(({ server }) => new Promise((done) => server.close(done))));
  },
});

test("redirects end at the URL that answered, Authorization stays home, no cookie is kept, and only http(s) goes out", async ({
  servers,
}) => {
  const { app, page } = await launch(profile());
  const http = (exchange: { method: string; url: string; body?: string }) =>
    page.evaluate(
      (request) =>
        (
          window as unknown as { astrotime: { http(r: object): Promise<HttpAnswer> } }
        ).astrotime.http({ ...request, headers: { Authorization: "Basic dTpw", Depth: "0" } }),
      exchange,
    );
  const echoed = (answer: HttpAnswer) => {
    if ("offline" in answer) throw new Error(answer.offline);
    return { url: answer.url, ...(JSON.parse(answer.body) as object) };
  };
  const a = `http://127.0.0.1:${servers.a}`;
  const to = (status: number, url: string, from = a) =>
    `${from}/to/${status}/${encodeURIComponent(url)}`;

  // Within the origin: the credentials and the method go along.
  expect(echoed(await http({ method: "PROPFIND", url: to(301, "/echo"), body: "<x/>" }))).toEqual({
    url: `${a}/echo`,
    method: "PROPFIND",
    authorization: "Basic dTpw",
    cookie: null,
    body: "<x/>",
  });
  // Another port, another host: the request goes on without them.
  const port = `http://127.0.0.1:${servers.b}/echo`;
  expect(echoed(await http({ method: "PROPFIND", url: to(307, port), body: "<x/>" }))).toEqual({
    url: port,
    method: "PROPFIND",
    authorization: null,
    cookie: null,
    body: "<x/>",
  });
  const host = `http://localhost:${servers.a}/echo`;
  expect(echoed(await http({ method: "REPORT", url: to(308, host), body: "<x/>" }))).toMatchObject({
    url: host,
    method: "REPORT",
    authorization: null,
  });
  // A 303 turns it into a GET, without the body.
  expect(echoed(await http({ method: "PROPFIND", url: to(303, "/echo"), body: "<x/>" }))).toEqual({
    url: `${a}/echo`,
    method: "GET",
    authorization: "Basic dTpw",
    cookie: null,
    body: "",
  });

  // A cookie the server sets is never sent back.
  await http({ method: "GET", url: `${a}/cookie` });
  expect(echoed(await http({ method: "GET", url: `${a}/echo` }))).toMatchObject({ cookie: null });

  expect(await http({ method: "GET", url: `http://127.0.0.1:${servers.closed}/` })).toMatchObject({
    offline: expect.stringMatching(/could not reach the server/),
  });
  await expect(http({ method: "GET", url: "file:///etc/hostname" })).rejects.toThrow(
    /Not an http\(s\) URL/,
  );
  await app.close();
});
