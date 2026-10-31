import { AuthError as CredentialsRefused, OfflineError } from "@astrotime/core";

export interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpResponse {
  readonly status: number;
  /** The URL that answered, after redirects. */
  readonly url: string;
  header(name: string): string | null;
  readonly body: string;
}

/**
 * How the provider reaches servers; each platform brings one
 * (docs/plans/foundation.md#D22). Throws `OfflineError` when the server
 * cannot be reached at all.
 */
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

/**
 * An `HttpClient` on `fetch`. `via` sends requests through a proxy and maps
 * the URLs back (the web app and its CORS proxy, D20): `to` turns a server
 * URL into the proxy's, `from` the proxy's into the server's.
 */
export function fetchClient(
  options: {
    fetch?: typeof fetch;
    via?: { to(url: string): string; from(url: string): string };
  } = {},
): HttpClient {
  const run = options.fetch ?? fetch;
  const via = options.via ?? { to: (url: string) => url, from: (url: string) => url };
  return async (request) => {
    let response: Response;
    try {
      response = await run(via.to(request.url), {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        credentials: "omit",
      });
    } catch (error) {
      throw new OfflineError(`${request.method} ${request.url} could not reach the server.`, {
        cause: error,
      });
    }
    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      // The connection broke while the answer came: as offline as no answer.
      throw new OfflineError(`${request.method} ${request.url}: the answer broke off.`, {
        cause: error,
      });
    }
    return {
      status: response.status,
      url: via.from(response.url || via.to(request.url)),
      header: (name) => response.headers.get(name),
      body,
    };
  };
}

export class HttpError extends Error {
  override name = "HttpError";
  readonly status: number;
  constructor(request: HttpRequest, response: HttpResponse) {
    super(`${request.method} ${request.url} answered ${response.status}.`);
    this.status = response.status;
  }
}

/** The server refused the credentials (401); the sync engine stops on it. */
export class AuthError extends CredentialsRefused {
  readonly status = 401;
  constructor(request: HttpRequest) {
    super(`${request.method} ${request.url}: the server refused the credentials.`);
  }
}
