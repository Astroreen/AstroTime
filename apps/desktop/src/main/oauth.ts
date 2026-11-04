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
  close(): void;
}

/** Opens one loopback redirect; its page tells the user to go back to AstroTime. */
export async function loopback(page: string): Promise<Loopback> {
  let finish: (url: string | null) => void = () => {};
  const answer = new Promise<string | null>((resolve) => (finish = resolve));
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/oauth") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "default-src 'none'",
      "Cache-Control": "no-store",
    });
    res.end(page);
    finish(`${redirectUri}${url.search}`);
    close();
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
  return { redirectUri, answer, close };
}
