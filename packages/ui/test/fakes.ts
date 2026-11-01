// Fakes for the accounts' tests: a Nextcloud that answers Login Flow v2 and
// CalDAV discovery, and a secret store in memory.
import type { HttpClient, HttpRequest, HttpResponse } from "@astrotime/caldav";
import { OfflineError, type SecretStore } from "@astrotime/core";

export const SERVER = "https://cloud.example.com";

function multistatus(prop: string): string {
  return `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`;
}

/** Nextcloud: Login Flow v2, and discovery that wants `password` for `astro`. */
export function nextcloud(options: { password: string; approveAfter?: number }) {
  const requests: HttpRequest[] = [];
  let polls = 0;
  let offlinePolls = 0;
  let approveAfter = options.approveAfter ?? Infinity;
  const reply = (request: HttpRequest, status: number, body: string): HttpResponse => ({
    status,
    url: request.url,
    header: () => null,
    body,
  });
  const http: HttpClient = async (request) => {
    requests.push(request);
    const path = new URL(request.url).pathname;
    if (path === "/index.php/login/v2") {
      return reply(
        request,
        200,
        JSON.stringify({
          poll: { token: "t0k3n", endpoint: `${SERVER}/login/v2/poll` },
          login: `${SERVER}/login/v2/flow/abc`,
        }),
      );
    }
    if (path === "/login/v2/poll") {
      if (offlinePolls > 0) {
        offlinePolls--;
        throw new OfflineError("offline");
      }
      return polls++ < approveAfter
        ? reply(request, 404, "[]")
        : reply(
            request,
            200,
            JSON.stringify({ server: SERVER, loginName: "astro", appPassword: "app-pass" }),
          );
    }
    const expected = `Basic ${btoa(`astro:${options.password}`)}`;
    if (request.headers["Authorization"] !== expected) return reply(request, 401, "");
    if (path === "/.well-known/caldav" || path === "/remote.php/dav/") {
      return reply(
        request,
        207,
        multistatus(
          "<d:current-user-principal><d:href>/remote.php/dav/principals/users/astro/</d:href></d:current-user-principal>",
        ),
      );
    }
    if (path === "/remote.php/dav/principals/users/astro/") {
      return reply(
        request,
        207,
        multistatus(
          "<c:calendar-home-set><d:href>/remote.php/dav/calendars/astro/</d:href></c:calendar-home-set>",
        ),
      );
    }
    return reply(request, 404, "");
  };
  return {
    http,
    requests,
    dropNextPolls: (n: number) => (offlinePolls = n),
    /** The user approves on Nextcloud's page: the next poll gets the app password. */
    approve: () => (approveAfter = polls),
  };
}

export function memorySecrets(): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: async (key) => values.get(key) ?? null,
    set: async (key, value) => void values.set(key, value),
    delete: async (key) => void values.delete(key),
  };
}
