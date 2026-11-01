// HTTP from the main process (docs/plans/desktop.md#D72): Electron's
// `net.request`, Chromium's network stack, so the system's proxy settings and
// certificates apply. Each exchange is one hop; the shared redirect rule
// follows them (`followRedirects`), so the answer knows the URL that answered.
import { followRedirects, type HttpRequest, type HttpResponse } from "@astrotime/caldav";
import { OfflineError } from "@astrotime/core";
import { net, type Session } from "electron";

/** An answer with its headers as they cross IPC to the page (`HttpAnswer`). */
export interface NetResponse extends HttpResponse {
  /** By lower-case name; repeated ones joined with ", ", as `fetch` does. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * The desktop's HTTP: `session` is an in-memory one of its own, so no cookie
 * is kept and nothing reaches the page's; `credentials: "omit"` sends none
 * and never shows a login dialog.
 */
export function netClient(session: Session): (request: HttpRequest) => Promise<NetResponse> {
  return followRedirects((request) => hop(session, request));
}

/** As Android's plugin bounds a call (android D62). */
const HOP_CEILING_MS = 5 * 60_000;

function hop(session: Session, request: HttpRequest): Promise<NetResponse> {
  return new Promise((resolve, reject) => {
    const exchange = net.request({
      method: request.method,
      url: request.url,
      session,
      redirect: "manual",
      credentials: "omit",
      // Someone's calendar, fetched with their credentials: never kept by a cache.
      cache: "no-store",
    });
    const offline = (what: string, cause?: unknown) => {
      clearTimeout(ceiling);
      reject(new OfflineError(`${request.method} ${request.url} ${what}`, { cause }));
    };
    // A whole hop, however slowly it trickles: a stalled server never holds a sync for ever.
    const ceiling = setTimeout(() => {
      exchange.abort();
      offline("did not answer in time.");
    }, HOP_CEILING_MS);
    try {
      for (const [name, value] of Object.entries(request.headers)) exchange.setHeader(name, value);
    } catch (error) {
      clearTimeout(ceiling);
      exchange.abort();
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    exchange.on("redirect", (status, _method, _location, headers) => {
      // Not followed here: the shared rule decides where it goes, and with what.
      clearTimeout(ceiling);
      resolve(answer(request.url, status, headers, ""));
      exchange.abort();
    });
    exchange.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        clearTimeout(ceiling);
        resolve(
          answer(
            request.url,
            response.statusCode,
            response.headers,
            new TextDecoder().decode(Buffer.concat(chunks)),
          ),
        );
      });
      response.on("error", (error) => offline("the answer broke off.", error));
      response.on("aborted", () => offline("the answer broke off."));
    });
    exchange.on("error", (error) => offline("could not reach the server.", error));
    exchange.end(request.body);
  });
}

function answer(
  url: string,
  status: number,
  raw: Record<string, string | string[]>,
  body: string,
): NetResponse {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return { status, url, headers, header: (name) => headers[name.toLowerCase()] ?? null, body };
}
