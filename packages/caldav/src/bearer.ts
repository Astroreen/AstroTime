// An OAuth account's bearer token on a request (docs/plans/providers.md#D254),
// loaded with the first one: no password's account needs it.
import { inClear, type TokenSource } from "./auth.ts";
import type { HttpRequest } from "./http.ts";

/**
 * An OAuth token for an address `inClear`: never sent (D254). The sign-in
 * says it as it says such an address for a password (D262).
 */
export class InClearError extends Error {
  override name = "InClearError";
  constructor(url: string) {
    super(`${new URL(url).origin}: an OAuth token is never sent unencrypted.`);
  }
}

/**
 * The `Authorization` header with the account's token. A token is a
 * password: never on the wire in clear; OAuth's services are all https, so
 * plain http to another host than this device is refused.
 */
export async function bearerHeader(
  tokens: TokenSource,
  request: Pick<HttpRequest, "url">,
): Promise<string> {
  if (inClear(request.url)) throw new InClearError(request.url);
  return `Bearer ${await tokens.token()}`;
}

/** After a 401 to the request signed with `header`: its token renewed, unless another renewal replaced it. */
export function renewBearer(tokens: TokenSource, header: string | null): Promise<boolean> {
  return tokens.renew(header?.replace(/^Bearer /, ""));
}
