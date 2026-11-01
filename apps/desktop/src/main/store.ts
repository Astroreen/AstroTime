// The store's process, as the main process keeps it (docs/plans/desktop.md#D73):
// started once, asked for a port for each page, closed before the app quits,
// and started again if it goes.
import { MessageChannelMain, utilityProcess, type MessagePortMain } from "electron";

import type { StoreCommand } from "../store/index.ts";

/** Quick ends in a row before the store is not started again. */
const RESTARTS = 3;
/** Restarts in one run of the app, at any pace. */
const MAX_RESTARTS = 20;
/** An end this soon after the start counts as failing to start. */
const QUICK_END_MS = 10_000;
/** How long quitting waits for the store to close its database. */
const CLOSE_CEILING_MS = 5_000;

export interface StoreProcess {
  /** A new port to the store, for a page to send its statements on. */
  connect(): MessagePortMain;
  /** Closes the database and waits for the process to end. */
  close(): Promise<void>;
}

/**
 * Runs `entry` on the database at `database`. If the process goes (it stopped
 * itself, D98, or crashed), another starts and `restarted` is told, so the
 * page connects again.
 */
export function storeProcess(entry: string, database: string, restarted: () => void): StoreProcess {
  let closing = false;
  let alive = false;
  // Ends in a row, each soon after its start: a store that cannot open the
  // database is not started for ever; the page then shows the store failed.
  let quickEnds = 0;
  // And however slowly it keeps ending, not more than this in one run of the app.
  let restarts = 0;
  const start = () => {
    const started = Date.now();
    const child = utilityProcess.fork(entry, [database], { serviceName: "AstroTime store" });
    alive = true;
    child.once("exit", (code) => {
      alive = false;
      if (closing) return;
      quickEnds = Date.now() - started < QUICK_END_MS ? quickEnds + 1 : 0;
      restarts++;
      if (quickEnds >= RESTARTS || restarts > MAX_RESTARTS) {
        console.error(`The store's process ended (${code}) ${RESTARTS} times at start; not again.`);
        return;
      }
      console.error(`The store's process ended (${code}); starting it again.`);
      current = start();
      restarted();
    });
    return child;
  };
  let current = start();
  return {
    connect() {
      const { port1, port2 } = new MessageChannelMain();
      // A store that is not started again: the page's port closes at once,
      // so it shows the store failed instead of waiting.
      if (!alive) {
        port1.close();
        return port2;
      }
      current.postMessage({ type: "connect" } satisfies StoreCommand, [port1]);
      return port2;
    },
    close() {
      if (closing) return Promise.resolve();
      closing = true;
      const child = current;
      if (!alive) return Promise.resolve();
      const ended = new Promise<void>((resolve) => {
        // A process that does not end when asked is ended: quitting never waits for ever.
        const kill = setTimeout(() => child.kill(), CLOSE_CEILING_MS);
        child.once("exit", () => {
          clearTimeout(kill);
          resolve();
        });
      });
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a utility process's postMessage takes no origin
      child.postMessage({ type: "close" } satisfies StoreCommand);
      return ended;
    },
  };
}
