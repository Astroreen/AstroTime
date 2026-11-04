// The desktop's OAuth redirect (docs/plans/providers.md#D254): a loopback
// address on a free port, for one request, as Google's and Microsoft's
// desktop clients allow. The main process listens on 127.0.0.1 only; the
// first request to `/oauth` is the answer, and the server closes.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** How long a sign-in waits for its answer: a product limit, as Login Flow's (android D65). */
const WAIT_MS = 15 * 60_000;

export interface Loopback {
  readonly redirectUri: string;
  /** The redirect's URL, once the browser came back; `null` when cancelled or too late. */
  readonly answer: Promise<string | null>;
  /**
   * The `state` the sign-in sent: only a request that carries it is the
   * answer; anything else (another page, a stray request) is refused with a
   * 400 and the server keeps waiting.
   */
  expect(state: string): void;
  close(): void;
}

/** Opens one loopback redirect; its page tells the user to go back to AstroTime. */
export async function loopback(page: string): Promise<Loopback> {
  let finish: (url: string | null) => void = () => {};
  const answer = new Promise<string | null>((resolve) => (finish = resolve));
  let expected: string | null = null;
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/oauth") {
      res.writeHead(404).end();
      return;
    }
    // Not this sign-in's (no state, or another's): refused, still waiting.
    // A refusal from the service carries the state too (RFC 6749 §4.1.2.1).
    if (expected === null || url.searchParams.get("state") !== expected) {
      res.writeHead(400).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'",
      "Cache-Control": "no-store",
    });
    finish(`${redirectUri}${url.search}`);
    // The server goes once the browser has the whole page, not before.
    res.on("finish", close);
    res.end(page);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/oauth`;
  const ceiling = setTimeout(() => close(), WAIT_MS);
  const close = () => {
    clearTimeout(ceiling);
    server.close();
    server.closeAllConnections();
    finish(null);
  };
  return {
    redirectUri,
    answer,
    expect: (state) => void (expected = state),
    close,
  };
}
