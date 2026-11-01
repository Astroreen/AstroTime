// HTTP on Android (docs/plans/android.md#D62): every request goes through
// AstroTime's own Capacitor plugin on OkHttp (`AstroTimeHttp`, in
// android/app/src/main/java/io/github/astroreen/astrotime/http/), which takes
// any method, follows redirects itself and sends plain http only to the
// origins it is given with the request. This side shapes what crosses the
// bridge, and turns the plugin's "offline" into `OfflineError`.
import type { HttpClient } from "@astrotime/caldav";
import { OfflineError } from "@astrotime/core";

/** One exchange, as the plugin takes it. */
export interface NativeRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  /** The origins plain http may go to, on any hop (`http://host:port`). */
  readonly cleartext: readonly string[];
}

/** Its answer: the last hop's, after the redirects the plugin followed. */
export interface NativeResponse {
  readonly status: number;
  readonly url: string;
  /** By lower-case name; a repeated header's values joined with ", ", as `fetch` does. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface NativeHttp {
  request(request: NativeRequest): Promise<NativeResponse>;
}

/**
 * An `HttpClient` on the plugin. `cleartext` names, at each request, the
 * origins that may be reached over plain http: saved accounts' and the one
 * being signed in to (`cleartextOrigins`).
 */
export function nativeClient(
  plugin: NativeHttp,
  cleartext: () => Promise<readonly string[]>,
): HttpClient {
  return async (request) => {
    let response: NativeResponse;
    try {
      response = await plugin.request({
        method: request.method,
        url: request.url,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        cleartext: await cleartext(),
      });
    } catch (error) {
      if (codeOf(error) === "offline") {
        throw new OfflineError(`${request.method} ${request.url} could not reach the server.`, {
          cause: error,
        });
      }
      throw error;
    }
    const headers = new Map(
      Object.entries(response.headers).map(([name, value]) => [name.toLowerCase(), value]),
    );
    return {
      status: response.status,
      url: response.url,
      header: (name) => headers.get(name.toLowerCase()) ?? null,
      body: response.body,
    };
  };
}

/**
 * The origins plain http may reach: those of the accounts' addresses and
 * calendar homes, and of the servers being signed in to, so nothing the user
 * did not type goes out unencrypted (D62). Https needs no listing.
 */
export function cleartextOrigins(
  accounts: readonly { readonly serverUrl: string; readonly homeUrl: string | null }[],
  signingIn: Iterable<string>,
): string[] {
  const urls = [
    ...accounts.flatMap((a) => (a.homeUrl === null ? [a.serverUrl] : [a.serverUrl, a.homeUrl])),
    ...signingIn,
  ];
  const origins = urls.map((url) => new URL(url)).filter((url) => url.protocol === "http:");
  return [...new Set(origins.map((url) => url.origin))];
}

/** A rejection's code: Capacitor puts the plugin's on the error it throws. */
function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
}
