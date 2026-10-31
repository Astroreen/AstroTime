import type { SqlDriver } from "../driver.ts";
import type { Request, Response } from "./protocol.ts";

type Distribute<T> = T extends unknown ? Omit<T, "id"> : never;

/**
 * The web store's driver: SQLite in a worker, kept on OPFS under `name`.
 * One tab at a time may hold a database; a second tab's open fails.
 */
export async function webDriver(name = "astrotime"): Promise<SqlDriver> {
  const worker = new Worker(new URL("worker.ts", import.meta.url), {
    type: "module",
    name: "astrotime-store",
  });
  const waiting = new Map<
    number,
    { resolve: (rows: unknown[][]) => void; reject: (error: Error) => void }
  >();
  let next = 0;
  worker.addEventListener("message", (event: MessageEvent<Response>) => {
    const response = event.data;
    const pending = waiting.get(response.id);
    waiting.delete(response.id);
    if (response.ok) pending?.resolve(response.rows ?? []);
    else pending?.reject(new Error(response.error));
  });
  // A worker that fails to load or crashes answers nothing again: every
  // waiting request and every later one fails instead of hanging.
  let broken: Error | undefined;
  const fail = (error: Error) => {
    broken = error;
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
  };
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    fail(new Error(`The store's worker failed: ${event.message || "it could not load"}`));
  });
  worker.addEventListener("messageerror", () =>
    fail(new Error("The store's worker sent a message it could not read.")),
  );
  const send = (request: Distribute<Request>) =>
    new Promise<unknown[][]>((resolve, reject) => {
      if (broken) return reject(broken);
      const id = next++;
      waiting.set(id, { resolve, reject });
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin
      worker.postMessage({ ...request, id });
    });

  try {
    await send({ type: "open", name });
  } catch (error) {
    worker.terminate();
    throw error;
  }
  return {
    query: (sql, params) => send({ type: "query", sql, params }),
    script: async (sql) => {
      await send({ type: "script", sql });
    },
    close: async () => {
      try {
        await send({ type: "close" });
      } finally {
        // A broken worker still holds its thread until it is terminated.
        worker.terminate();
      }
    },
  };
}
