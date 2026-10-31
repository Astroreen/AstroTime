// The web app's way past CORS (docs/plans/foundation.md#D20): a request to
// `<prefix><server origin>/<path>` on the app's own origin is sent on to the
// server, and its answer comes back as the app's own. The handler keeps no
// state; credentials pass through. It runs in the Vite dev server now and in
// the web app's Docker image later (PR 7).

/** Request headers a CalDAV client sends; nothing else is passed on. */
const FORWARDED = [
  "authorization",
  "content-type",
  "depth",
  "if-match",
  "if-none-match",
  "accept",
  "user-agent",
  "prefer",
  "brief",
];
/** Set on the proxy's own answer when the CalDAV server could not be reached. */
export const UNREACHABLE = "x-astrotime-unreachable";

/** Statuses whose responses carry no body (Fetch: a body with them is a TypeError). */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);
/** Response headers the client reads. */
// Not WWW-Authenticate: on the app's own origin it would make the browser
// show its own sign-in dialog; the app reads the 401 and asks itself.
const RETURNED = ["content-type", "etag", "dav", "location"];

export interface ProxyOptions {
  /** Where proxied URLs start on the app's origin, `/dav-proxy/`. */
  readonly prefix: string;
  /**
   * Origins the proxy may reach (`https://cloud.example.com`). `"*"` allows
   * any, for a dev server only it listens to; never in production.
   */
  readonly allow: readonly string[] | "*";
  readonly fetch?: typeof fetch;
}

/** Maps server URLs into the proxy's URL space and back, for `fetchClient({ via })`. */
export function throughProxy(prefix: string) {
  return {
    to(url: string): string {
      const target = new URL(url);
      return `${prefix}${encodeURIComponent(target.origin)}${target.pathname}${target.search}`;
    },
    from(url: string): string {
      const path = url.startsWith("/") ? url : new URL(url).pathname + new URL(url).search;
      if (!path.startsWith(prefix)) return url;
      const rest = path.slice(prefix.length);
      const slash = rest.indexOf("/");
      const origin = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash));
      return `${origin}${slash < 0 ? "/" : rest.slice(slash)}`;
    },
  };
}

export function proxyHandler(options: ProxyOptions): (request: Request) => Promise<Response> {
  const via = throughProxy(options.prefix);
  const run = options.fetch ?? fetch;
  // Spelled as URL spells an origin (lower case, no default port, no slash),
  // so `HTTPS://Cloud.example.com:443/` in the list matches.
  const allowed = new Set(
    options.allow === "*" ? [] : options.allow.map((origin) => new URL(origin).origin),
  );
  return async (request) => {
    const incoming = new URL(request.url);
    // Only the app's own pages may use the proxy: a page elsewhere would use
    // it to reach the servers behind it. Browsers mark cross-site requests.
    // The host is compared, not the scheme: behind a TLS terminator the page
    // is https and the request reaching us is http. (DNS rebinding is the
    // Host check's job: Vite's allowedHosts, a reverse proxy's server name.)
    const origin = request.headers.get("origin");
    const site = request.headers.get("sec-fetch-site");
    if (
      (origin !== null && hostOf(origin) !== incoming.host) ||
      (site !== null && site !== "same-origin" && site !== "none")
    ) {
      return new Response("The proxy serves this app's own pages only.", { status: 403 });
    }
    let target: URL;
    try {
      target = new URL(via.from(incoming.pathname + incoming.search));
    } catch {
      return new Response("Not a proxied URL.", { status: 400 });
    }
    if (!/^https?:$/.test(target.protocol))
      return new Response("Not a proxied URL.", { status: 400 });
    if (options.allow !== "*" && !allowed.has(target.origin)) {
      return new Response(`${target.origin} is not on this proxy's allowlist.`, { status: 403 });
    }
    const headers = new Headers();
    for (const name of FORWARDED) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const hasBody = !["GET", "HEAD"].includes(request.method);
    let answer: Response;
    try {
      answer = await run(target, {
        method: request.method,
        headers,
        ...(hasBody ? { body: await request.text() } : {}),
        // A redirect goes back to the client, mapped into the proxy, so the
        // client sees the URL that answered (discovery's /.well-known redirect).
        redirect: "manual",
        // The client went away: so does the request to the server.
        signal: request.signal,
      });
    } catch {
      // Marked as the proxy's own: the client reads it as offline, not as the server's 502.
      return new Response(`${target.origin} could not be reached.`, {
        status: 502,
        headers: { [UNREACHABLE]: "1" },
      });
    }
    const returned = new Headers();
    for (const name of RETURNED) {
      const value = answer.headers.get(name);
      if (value === null) continue;
      if (name !== "location") {
        returned.set(name, value);
        continue;
      }
      // A redirect to another server is not passed on: inside the proxy the
      // browser would keep the Authorization header for it, which a fetch to
      // another origin drops.
      let location: URL;
      try {
        location = new URL(value, target);
      } catch {
        return new Response(`${target.origin} answered with a malformed redirect.`, {
          status: 502,
        });
      }
      if (location.origin !== target.origin) {
        return new Response(
          `${target.origin} redirects to ${location.origin}; sign in with that address.`,
          {
            status: 502,
          },
        );
      }
      returned.set(name, via.to(location.href));
    }
    // Someone's calendar, fetched with their credentials: never kept by a cache.
    returned.set("cache-control", "no-store");
    // Streamed through: a calendar's multiget answer can be megabytes.
    return new Response(NULL_BODY.has(answer.status) ? null : answer.body, {
      status: answer.status,
      headers: returned,
    });
  };
}

function hostOf(origin: string): string | null {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
}
