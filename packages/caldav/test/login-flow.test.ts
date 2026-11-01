import { expect, test } from "vite-plus/test";

import { OfflineError } from "@astrotime/core";

import {
  resumeLoginFlow,
  revokeAppPassword,
  startLoginFlow,
  type HttpClient,
  type HttpRequest,
} from "../src/index.ts";

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

test("a flow kept by a page the browser discarded is polled again from its state (D121)", async () => {
  const { http, requests } = nextcloud();
  const { state } = await startLoginFlow(http, "https://cloud.example.com/");
  expect(state).toEqual({
    server: "https://cloud.example.com/",
    loginUrl: "https://cloud.example.com/login/v2/flow/abc",
    endpoint: "https://cloud.example.com/login/v2/poll",
    token: "t0k3n",
  });
  // A new page: the state went through JSON, as a shell keeps it.
  const resumed = resumeLoginFlow(http, JSON.parse(JSON.stringify(state)));
  expect(resumed.loginUrl).toBe(state.loginUrl);
  expect(await resumed.poll()).toBeNull();
  expect(await resumed.poll()).toMatchObject({ username: "astro", password: "app-pass" });
  expect(requests.slice(1).map((r) => r.body)).toEqual(["token=t0k3n", "token=t0k3n"]);
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
  // …and used on the user's https, so nothing goes in clear.
  expect((await startLoginFlow(http, "https://cloud.example.com")).loginUrl).toBe(
    "https://cloud.example.com/login/v2/flow/x",
  );
});

test("an approval naming another server keeps the app password home", async () => {
  const http: HttpClient = async (request) => {
    const reply = (body: unknown) => ({
      status: 200,
      url: request.url,
      header: () => null,
      body: JSON.stringify(body),
    });
    if (request.url.endsWith("/index.php/login/v2")) {
      return reply({
        poll: { token: "t", endpoint: "https://cloud.example.com/login/v2/poll" },
        login: "https://cloud.example.com/login/v2/flow/x",
      });
    }
    return reply({ server: "https://evil.example", loginName: "astro", appPassword: "secret" });
  };
  const flow = await startLoginFlow(http, "https://cloud.example.com");
  await expect(flow.poll()).rejects.toThrow(/names evil.example/);
});

test("a page that is not JSON (a captive portal) is named for what it is", async () => {
  const http: HttpClient = async (request) => ({
    status: 200,
    url: request.url,
    header: () => null,
    body: "<html>Sign in to the Wi-Fi</html>",
  });
  await expect(startLoginFlow(http, "https://cloud.example.com")).rejects.toThrow(/not JSON/);
});

test("the approved server is used on the user's scheme too", async () => {
  const http: HttpClient = async (request) => {
    const reply = (body: unknown) => ({
      status: 200,
      url: request.url,
      header: () => null,
      body: JSON.stringify(body),
    });
    if (request.url.endsWith("/index.php/login/v2")) {
      return reply({
        poll: { token: "t", endpoint: "http://cloud.example.com/login/v2/poll" },
        login: "http://cloud.example.com/login/v2/flow/x",
      });
    }
    return reply({ server: "http://cloud.example.com", loginName: "astro", appPassword: "secret" });
  };
  const flow = await startLoginFlow(http, "https://cloud.example.com");
  expect((await flow.poll())?.server).toBe("https://cloud.example.com");
});

test("an app password is revoked with itself, as Nextcloud's OCS API asks; one refused already is gone (D90)", async () => {
  const requests: HttpRequest[] = [];
  const answering =
    (status: number): HttpClient =>
    async (request) => {
      requests.push(request);
      return { status, url: request.url, header: () => null, body: "{}" };
    };
  const credentials = { username: "astro", password: "app-pass" };
  await revokeAppPassword(answering(200), "https://cloud.example.com/nextcloud/", credentials);
  expect(requests.map((r) => [r.method, r.url, r.headers])).toEqual([
    [
      "DELETE",
      "https://cloud.example.com/nextcloud/ocs/v2.php/core/apppassword",
      {
        "OCS-APIRequest": "true",
        Accept: "application/json",
        Authorization: `Basic ${btoa("astro:app-pass")}`,
      },
    ],
  ]);
  // Refused, and the password signs in no more: revoked in Nextcloud's settings already.
  await revokeAppPassword(answering(401), "https://cloud.example.com", credentials);
  // Refused, while the password still signs in (the OCS header lost on the way): not revoked.
  const stillValid: HttpClient = async (request) => ({
    status: request.method === "DELETE" ? 401 : 200,
    url: request.url,
    header: () => null,
    body: "{}",
  });
  await expect(
    revokeAppPassword(stillValid, "https://cloud.example.com", credentials),
  ).rejects.toThrow("would not revoke");
  // Not an app password (403), or a server that fails: it is still valid there.
  await expect(
    revokeAppPassword(answering(403), "https://cloud.example.com", credentials),
  ).rejects.toThrow("would not revoke");
  const offline: HttpClient = async (request) => {
    throw new OfflineError(`${request.url} could not be reached.`);
  };
  await expect(
    revokeAppPassword(offline, "https://cloud.example.com", credentials),
  ).rejects.toThrow(OfflineError);
});
