// The TypeScript side of the HTTP plugin (docs/plans/android.md#D69, tests):
// the plugin is replaced, so this runs in Node; the plugin itself is tested
// by Gradle (android/app/src/test/).
import { OfflineError } from "@astrotime/core";
import { expect, test } from "vite-plus/test";

import {
  cleartextOrigins,
  nativeClient,
  type NativeHttp,
  type NativeRequest,
  type NativeResponse,
} from "../src/http.ts";

/** A plugin that answers `answer`, or rejects as Capacitor does, with the plugin's code. */
function plugin(answer: { code: string } | NativeResponse) {
  const requests: NativeRequest[] = [];
  const http: NativeHttp = {
    request: async (request) => {
      requests.push(request);
      if ("code" in answer) throw Object.assign(new Error("refused"), answer);
      return answer;
    },
  };
  return { http, requests };
}

test("a request crosses the bridge with the origins plain http may reach, and its answer comes back", async () => {
  const { http, requests } = plugin({
    status: 207,
    url: "http://10.0.2.2:5232/astro/",
    headers: { "content-type": "text/xml", dav: "1, 2, calendar-access" },
    body: "<multistatus/>",
  });
  const client = nativeClient(http, async () => ["http://10.0.2.2:5232"]);
  const response = await client({
    method: "PROPFIND",
    url: "http://10.0.2.2:5232/",
    headers: { Depth: "0" },
    body: "<propfind/>",
  });
  expect(requests).toEqual([
    {
      method: "PROPFIND",
      url: "http://10.0.2.2:5232/",
      headers: { Depth: "0" },
      body: "<propfind/>",
      cleartext: ["http://10.0.2.2:5232"],
    },
  ]);
  expect(response.status).toBe(207);
  expect(response.url).toBe("http://10.0.2.2:5232/astro/");
  expect(response.body).toBe("<multistatus/>");
  expect(response.header("Content-Type")).toBe("text/xml");
  expect(response.header("DAV")).toBe("1, 2, calendar-access");
  expect(response.header("ETag")).toBeNull();
});

test("a request without a body sends none", async () => {
  const { http, requests } = plugin({
    status: 200,
    url: "https://a.example/",
    headers: {},
    body: "",
  });
  await nativeClient(http, async () => [])({
    method: "GET",
    url: "https://a.example/",
    headers: {},
  });
  expect(requests[0]).not.toHaveProperty("body");
});

test("the plugin's offline is OfflineError; a hop to plain http names its address; any other refusal stays", async () => {
  const offline = nativeClient(plugin({ code: "offline" }).http, async () => []);
  await expect(offline({ method: "GET", url: "https://a.example/", headers: {} })).rejects.toThrow(
    OfflineError,
  );
  const cleartext = nativeClient(
    {
      request: async () => {
        throw Object.assign(
          new Error("Plain http to http://b.example:8080 is not an address the user typed."),
          { code: "cleartext" },
        );
      },
    },
    async () => [],
  );
  await expect(
    cleartext({ method: "PROPFIND", url: "https://a.example/", headers: {} }),
  ).rejects.toMatchObject({
    name: "ProxyRefusedError",
    reason: "other-server",
    location: "http://b.example:8080",
  });
  const refused = nativeClient(plugin({ code: "redirects" }).http, async () => []);
  const error = await refused({ method: "GET", url: "http://a.example/", headers: {} }).catch(
    (caught: unknown) => caught,
  );
  expect(error).not.toBeInstanceOf(OfflineError);
  expect(error).toMatchObject({ code: "redirects" });
});

test("plain http may reach the accounts' servers and calendar homes and the one being signed in to, nothing else", () => {
  const accounts = [
    { serverUrl: "http://10.0.2.2:5232/", homeUrl: "http://10.0.2.2:5232/astro/" },
    { serverUrl: "https://cloud.example.com/", homeUrl: "https://cloud.example.com/dav/" },
    { serverUrl: "http://nas.local/", homeUrl: null },
  ];
  expect(
    cleartextOrigins(accounts, ["http://192.168.1.5:8080/", "https://other.example/"]),
  ).toEqual(["http://10.0.2.2:5232", "http://nas.local", "http://192.168.1.5:8080"]);
  expect(cleartextOrigins([], [])).toEqual([]);
});
