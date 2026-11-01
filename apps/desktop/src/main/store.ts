// The store's process, as the main process keeps it (docs/plans/desktop.md#D73):
// started once, asked for a port for each page, closed before the app quits,
// and started again if it goes.
import { MessageChannelMain, utilityProcess, type MessagePortMain } from "electron";

import type { StoreCommand } from "../store/index.ts";

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
  const start = () => {
    const child = utilityProcess.fork(entry, [database], { serviceName: "AstroTime store" });
    child.once("exit", (code) => {
      if (closing) return;
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
      current.postMessage({ type: "connect" } satisfies StoreCommand, [port1]);
      return port2;
    },
    close() {
      if (closing) return Promise.resolve();
      closing = true;
      const child = current;
      const ended = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a utility process's postMessage takes no origin
      child.postMessage({ type: "close" } satisfies StoreCommand);
      return ended;
    },
  };
}
