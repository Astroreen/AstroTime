import { AuthError as CredentialsRefused, OfflineError } from "@astrotime/core";

import { REFUSED, UNREACHABLE } from "./proxy.ts";

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
    // The proxy could not reach the server: as offline as no answer (D37).
    if (response.headers.get(UNREACHABLE) !== null) {
      throw new OfflineError(`${request.method} ${request.url} could not reach the server.`);
    }
    const refused = response.headers.get(REFUSED);
    if (refused !== null) throw new ProxyRefusedError(request, refused);
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

/**
 * The web app's proxy would not carry the request (docs/plans/foundation.md#D20,
 * D39): the server is not on this AstroTime's allowlist (`not-allowed`), or
 * it redirects to another server (`other-server`, at `location`), which the
 * user signs in to by its own address instead.
 */
export class ProxyRefusedError extends Error {
  override name = "ProxyRefusedError";
  readonly reason: "not-allowed" | "other-server";
  /** For `other-server`: the origin the server redirects to. */
  readonly location: string | null;
  constructor(request: HttpRequest, header: string) {
    const [reason, location = null] = header.split(" ");
    super(`${request.method} ${request.url}: the proxy refused it (${header}).`);
    this.reason = reason === "other-server" ? "other-server" : "not-allowed";
    this.location = this.reason === "other-server" ? location : null;
  }
}

/**
 * The server's TLS certificate was refused: not trusted on this device (its
 * own, or from a CA the user has not installed), expired, or for another
 * name. Not offline: trying again does not help until the certificate or the
 * device's trust changes. A platform whose HTTP tells it apart throws it
 * (Android's plugin, docs/plans/android.md#D62); `fetch` cannot.
 */
export class CertificateError extends Error {
  override name = "CertificateError";
}
