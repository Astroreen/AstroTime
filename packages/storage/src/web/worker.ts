// The web store's worker: SQLite compiled to WebAssembly, on the Origin
// Private File System through the "opfs-sahpool" VFS, which needs a worker
// but no cross-origin isolation headers (docs/plans/foundation.md#D25).
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

import type { Request, Response } from "./protocol.ts";

type Database = InstanceType<
  Awaited<
    ReturnType<Awaited<ReturnType<typeof sqlite3InitModule>>["installOpfsSAHPoolVfs"]>
  >["OpfsSAHPoolDb"]
>;

let db: Database | undefined;

async function handle(request: Request): Promise<unknown[][] | undefined> {
  switch (request.type) {
    case "open": {
      const sqlite3 = await sqlite3InitModule();
      const pool = await sqlite3.installOpfsSAHPoolVfs({ name: `astrotime-${request.name}` });
      db = new pool.OpfsSAHPoolDb(`/${request.name}.sqlite3`);
      return undefined;
    }
    case "query":
      return open().exec({
        sql: request.sql,
        bind: request.params as never,
        rowMode: "array",
        returnValue: "resultRows",
      }) as unknown[][];
    case "script":
      open().exec(request.sql);
      return undefined;
    case "close":
      open().close();
      db = undefined;
      return undefined;
  }
}

function open(): Database {
  if (!db) throw new Error("The store's database is not open.");
  return db;
}

// Requests run one at a time, in order, as SQLite on one connection expects.
let queue = Promise.resolve();
self.addEventListener("message", (event: MessageEvent<Request>) => {
  const request = event.data;
  queue = queue.then(async () => {
    let response: Response;
    try {
      const rows = await handle(request);
      response =
        rows === undefined ? { id: request.id, ok: true } : { id: request.id, ok: true, rows };
    } catch (error) {
      response = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin
    self.postMessage(response);
  });
});
