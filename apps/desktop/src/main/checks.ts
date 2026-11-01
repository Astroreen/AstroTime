// What the main process takes from the page (docs/plans/desktop.md#D71):
// each IPC handler checks its arguments before acting on them. Apart from
// Electron, so the checks are tested in Node.
import type { HttpRequest } from "@astrotime/caldav";

import { APP_HOST, APP_SCHEME } from "../bridge.ts";

/** An HTTP token (RFC 9110): a method, or a header's name. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** A header's value: no line break or NUL, which would split the request. */
const VALUE = /^[^\r\n\0]*$/;

/** The page's request, if it is one; throws a `TypeError` that says what is wrong. */
export function checkRequest(value: unknown): HttpRequest {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("An HTTP request is an object.");
  }
  const { method, url, headers, body } = value as Record<string, unknown>;
  if (typeof method !== "string" || !TOKEN.test(method)) {
    throw new TypeError(`Not an HTTP method: ${String(method)}.`);
  }
  if (typeof url !== "string" || !isWebUrl(url)) {
    throw new TypeError(`Not an http(s) URL: ${String(url)}.`);
  }
  // As fetch, which refuses a URL with credentials in it.
  const { username, password } = new URL(url);
  if (username || password) throw new TypeError("Credentials go in a header, not in the URL.");
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) {
    throw new TypeError("An HTTP request's headers are an object of strings.");
  }
  const checked: Record<string, string> = {};
  for (const [name, header] of Object.entries(headers)) {
    if (!TOKEN.test(name) || typeof header !== "string" || !VALUE.test(header)) {
      throw new TypeError(`Not an HTTP header: ${name}.`);
    }
    checked[name] = header;
  }
  if (body !== undefined && typeof body !== "string") {
    throw new TypeError("An HTTP request's body is a string.");
  }
  return { method, url, headers: checked, ...(body === undefined ? {} : { body }) };
}

/** Whether `url` is an http(s) URL: what the app sends to servers and opens in the browser. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Whether `url` is one of the app's own pages. Node's URL gives a scheme it
 * does not know no origin, so the scheme and host are compared.
 */
export function isAppUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}
