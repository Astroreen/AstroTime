// One redirect rule for every shell whose HTTP follows none itself
// (docs/plans/desktop.md#D72, docs/plans/android.md#D62): fetch's, so a
// server answers the desktop and Android as it answers the web.
import type { HttpRequest, HttpResponse } from "./http.ts";

/** Redirects followed; the one after them is returned as it came. */
const MAX_REDIRECTS = 10;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Headers that describe a body, dropped with it (Fetch's request-body-header names). */
const BODY_HEADERS = new Set([
  "content-type",
  "content-encoding",
  "content-language",
  "content-location",
]);

/**
 * An `HttpClient` that follows redirects over `hop`, which makes one
 * exchange and returns a redirect as it came, so the response's `url` is the
 * one that answered. A 307 or 308 keeps the method and body; a 301 or 302
 * turns only a `POST` into a `GET`, a 303 anything but `GET` and `HEAD`.
 * `Authorization` goes only to the request's origin (scheme, host and port):
 * a redirect that leaves it drops the header for the rest of the way. The
 * answer is `hop`'s own, whatever more it carries.
 */
export function followRedirects<Response extends HttpResponse>(
  hop: (request: HttpRequest) => Promise<Response>,
): (request: HttpRequest) => Promise<Response> {
  return async (request) => {
    const origin = new URL(request.url).origin;
    let current = request;
    for (let followed = 0; ; followed++) {
      const response = await hop(current);
      const location = response.header("location");
      if (!REDIRECTS.has(response.status) || location === null || followed === MAX_REDIRECTS) {
        return response;
      }
      let next: URL;
      try {
        next = new URL(location, response.url);
      } catch {
        return response;
      }
      if (next.protocol !== "https:" && next.protocol !== "http:") return response;
      current = redirected(current, response.status, next, origin);
    }
  };
}

function redirected(request: HttpRequest, status: number, to: URL, origin: string): HttpRequest {
  const get =
    (status === 303 && request.method !== "GET" && request.method !== "HEAD") ||
    ((status === 301 || status === 302) && request.method === "POST");
  const headers = Object.fromEntries(
    Object.entries(request.headers).filter(([name]) => {
      const lower = name.toLowerCase();
      if (lower === "authorization") return to.origin === origin;
      return !(get && BODY_HEADERS.has(lower));
    }),
  );
  return {
    method: get ? "GET" : request.method,
    url: to.href,
    headers,
    ...(get || request.body === undefined ? {} : { body: request.body }),
  };
}
