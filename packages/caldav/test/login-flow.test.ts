import { expect, test } from "vite-plus/test";

import { startLoginFlow, type HttpClient, type HttpRequest } from "../src/index.ts";

/** Nextcloud's Login Flow v2 as its documentation shows it, the user approving after the first poll. */
function nextcloud(): { http: HttpClient; requests: HttpRequest[] } {
  const requests: HttpRequest[] = [];
  let polls = 0;
  const http: HttpClient = async (request) => {
    requests.push(request);
    const reply = (status: number, body: unknown) => ({
      status,
      url: request.url,
      header: () => null,
      body: JSON.stringify(body),
    });
    if (request.url === "https://cloud.example.com/index.php/login/v2") {
      return reply(200, {
        poll: { token: "t0k3n", endpoint: "https://cloud.example.com/login/v2/poll" },
        login: "https://cloud.example.com/login/v2/flow/abc",
      });
    }
    if (request.url === "https://cloud.example.com/login/v2/poll") {
      return polls++ === 0
        ? reply(404, [])
        : reply(200, {
            server: "https://cloud.example.com",
            loginName: "astro",
            appPassword: "app-pass",
          });
    }
    return reply(404, []);
  };
  return { http, requests };
}

test("Login Flow v2: the user approves on their server and AstroTime gets an app password (D19)", async () => {
  const { http, requests } = nextcloud();
  const flow = await startLoginFlow(http, "https://cloud.example.com");
  expect(flow.loginUrl).toBe("https://cloud.example.com/login/v2/flow/abc");
  expect(await flow.poll()).toBeNull();
  expect(await flow.poll()).toEqual({
    server: "https://cloud.example.com",
    username: "astro",
    password: "app-pass",
  });
  expect(requests.map((r) => [r.method, r.url, r.body])).toEqual([
    ["POST", "https://cloud.example.com/index.php/login/v2", undefined],
    ["POST", "https://cloud.example.com/login/v2/poll", "token=t0k3n"],
    ["POST", "https://cloud.example.com/login/v2/poll", "token=t0k3n"],
  ]);
});

test("a server without Login Flow v2 says so", async () => {
  const http: HttpClient = async (request) => ({
    status: 404,
    url: request.url,
    header: () => null,
    body: "",
  });
  await expect(startLoginFlow(http, "https://radicale.example.com/")).rejects.toThrow(
    /Login Flow v2/,
  );
});

test("a login flow pointing to another server is refused", async () => {
  const http: HttpClient = async (request) => ({
    status: 200,
    url: request.url,
    header: () => null,
    body: JSON.stringify({
      poll: { token: "t", endpoint: "https://evil.example/poll" },
      login: "https://cloud.example.com/login/v2/flow/x",
    }),
  });
  await expect(startLoginFlow(http, "https://cloud.example.com")).rejects.toThrow(
    /points to evil.example/,
  );
});

test("behind a TLS terminator a flow naming its pages http:// on the same host is accepted", async () => {
  const http: HttpClient = async (request) => ({
    status: 200,
    url: request.url,
    header: () => null,
    body: JSON.stringify({
      poll: { token: "t", endpoint: "http://cloud.example.com/login/v2/poll" },
      login: "http://cloud.example.com/login/v2/flow/x",
    }),
  });
  expect((await startLoginFlow(http, "https://cloud.example.com")).loginUrl).toBe(
    "http://cloud.example.com/login/v2/flow/x",
  );
});
