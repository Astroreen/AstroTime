// The store over a MessagePort (docs/plans/desktop.md#D73): one process owns
// the database file and runs the statements of each page connected to it,
// through the same `serving` as the web's leader tab (D98), so a page that
// goes mid-transaction is rolled back and never holds the next. No leader,
// no hand-over: the owner never moves. Requests and results are the web
// protocol's (`web/protocol.ts`).
import type { SqlDriver } from "./driver.ts";
import type { Reply, Request } from "./web/protocol.ts";
import { serving, type Connection } from "./web/serving.ts";

export type { Connection } from "./web/serving.ts";
export type { Reply, Request } from "./web/protocol.ts";

type Distribute<T> = T extends unknown ? Omit<T, "id"> : never;

const GONE = "The store's process went: this statement may or may not have run.";
const CLOSED = "The store is closed.";

/**
 * A page's driver on its port to the store's process. A port that closes
 * (the process went) fails what was on its way and everything after.
 */
export function portDriver(port: MessagePort): SqlDriver {
  let next = 0;
  const sent = new Map<number, { resolve(rows: unknown[][]): void; reject(error: Error): void }>();
  let broken: Error | undefined;
  const fail = (error: Error) => {
    broken ??= error;
    for (const pending of sent.values()) pending.reject(broken);
    sent.clear();
  };
  port.addEventListener("message", (event: MessageEvent<Reply>) => {
    const reply = event.data;
    if (reply.type !== "result") return;
    const pending = sent.get(reply.id);
    if (!pending) return;
    sent.delete(reply.id);
    if (reply.error === undefined) pending.resolve(reply.rows ?? []);
    else pending.reject(new Error(reply.error));
  });
  port.addEventListener("close", () => fail(new Error(GONE)));
  port.start();

  const send = (request: Distribute<Request>) =>
    new Promise<unknown[][]>((resolve, reject) => {
      if (broken) return reject(broken);
      const id = next++;
      sent.set(id, { resolve, reject });
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a MessagePort's postMessage takes no origin
      port.postMessage({ ...request, id } satisfies Request);
    });

  return {
    query: (sql, params) => send({ type: "query", sql, params }),
    script: async (sql) => {
      await send({ type: "script", sql });
    },
    async close() {
      fail(new Error(CLOSED));
      port.close();
    },
  };
}

/** One page at the store's process: what it sends, and that it went. */
export interface ServedPage {
  receive(request: Request): void;
  /** Its port closed: a transaction it left open is rolled back. */
  gone(): void;
}

/**
 * The store's process: serves every page connected to it on `connection`.
 * `lost` is told when a gone page's transaction could not be rolled back;
 * the process must then stop and open the database afresh, which rolls the
 * journal back (D98).
 */
export function portServer(connection: Connection, options: { lost(error: Error): void }) {
  const pages = new Map<string, (reply: Reply) => void>();
  const served = serving(connection, {
    reply: (page, reply) => pages.get(page)?.(reply),
    // One page at a time: nobody else to tell of a commit.
    changed: () => {},
    lost: options.lost,
  });
  let next = 0;
  return {
    /** A page connected; `send` answers it on its port. */
    connect(send: (reply: Reply) => void): ServedPage {
      const page = String(next++);
      pages.set(page, send);
      return {
        receive: (request) => served.receive(page, request),
        gone: () => {
          pages.delete(page);
          served.gone(page);
        },
      };
    },
    close: () => served.close(),
  };
}
