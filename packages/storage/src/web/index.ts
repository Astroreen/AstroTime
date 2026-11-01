import { HandOverError, InsecureContextError, type SqlDriver } from "../driver.ts";
import {
  names,
  post as tell,
  type Announcement,
  type Command,
  type Reply,
  type Report,
  type Request,
} from "./protocol.ts";

type Distribute<T> = T extends unknown ? Omit<T, "id"> : never;

interface Pending {
  readonly request: Request;
  readonly resolve: (rows: unknown[][]) => void;
  readonly reject: (error: Error) => void;
}

/** Holds a Web Lock; returns the function that lets it go. */
function hold(name: string): Promise<() => void> {
  return new Promise((resolve, reject) => {
    navigator.locks
      // The lock lasts until this promise settles.
      .request(name, () => new Promise<void>((release) => resolve(release)))
      .catch(reject);
  });
}

/** A statement that ends a transaction: COMMIT, END or ROLLBACK, not ROLLBACK TO a savepoint. */
const ENDS_TRANSACTION = /^\s*(COMMIT|END|ROLLBACK)(?:\s+TRANSACTION)?\s*;?\s*$/i;

const CLOSED = "The store is closed.";
const LOST =
  "The leader tab went during this transaction: it is over, and nothing more runs in it.";

/**
 * The web store's driver: SQLite in a worker, kept on OPFS under `name`.
 * Every tab may open it: the tab whose worker holds the store's Web Lock
 * opens the database and runs every tab's statements, and the next tab takes
 * over when it goes (docs/plans/foundation.md#D98).
 */
export async function webDriver(name = "astrotime"): Promise<SqlDriver> {
  // `isSecureContext` alone would do; Web Locks are what this code needs first.
  if (!globalThis.isSecureContext || !("locks" in navigator)) {
    throw new InsecureContextError(
      "The web store needs a secure context (https, or localhost) for OPFS and Web Locks.",
    );
  }
  const channels = names(name);
  const client = crypto.randomUUID();
  // Held while this driver is open: the leader learns from it that this tab is gone.
  const release = await hold(channels.client(client));
  const store = new BroadcastChannel(channels.store);
  const own = new BroadcastChannel(channels.channel(client));
  const announce = (announcement: Announcement) => tell(store, announcement);

  let next = 0;
  /** Statements waiting for a leader: provably not run, so the next leader gets them. */
  const unsent: Pending[] = [];
  /** Statements on their way to the leader. */
  const sent = new Map<number, Pending>();
  /** The leader this driver sends to, since it said welcome. */
  let leader: string | undefined;
  /** The last leader heard of; a welcome from another one is stale. */
  let announced: string | undefined;
  let welcomes = 0;
  /** This driver's transaction at the leader; "lost" when that leader went. */
  let transaction: "none" | "open" | "lost" = "none";
  let broken: Error | undefined;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  let opened: { resolve: () => void; reject: (error: Error) => void } | undefined;
  const ready = new Promise<void>((resolve, reject) => (opened = { resolve, reject }));

  /** Every waiting statement and every later one fails instead of hanging. */
  const fail = (error: Error) => {
    broken ??= error;
    for (const pending of [...unsent.splice(0), ...sent.values()]) pending.reject(broken);
    sent.clear();
    opened?.reject(broken);
  };

  const post = (pending: Pending) => {
    sent.set(pending.request.id, pending);
    tell(own, pending.request);
  };

  /** The leader went, or may have: what it was sent may or may not have run. */
  const handOver = () => {
    leader = undefined;
    for (const pending of sent.values()) {
      pending.reject(
        new HandOverError(
          "The leader tab went before answering: this statement may or may not have run.",
        ),
      );
    }
    sent.clear();
    if (transaction === "open") transaction = "lost";
    announce({ type: "hello", client });
  };

  own.addEventListener("message", (event: MessageEvent<Reply>) => {
    const reply = event.data;
    if (reply.type === "welcome") {
      if (leader === reply.leader || (announced !== undefined && announced !== reply.leader)) {
        return;
      }
      leader = reply.leader;
      for (const pending of unsent.splice(0)) post(pending);
      // After a hand-over the views read again: what changed meanwhile, and
      // what failed on its way, shows.
      if (welcomes++ > 0) notify();
      opened?.resolve();
      return;
    }
    if (reply.type === "bye") {
      if (leader !== reply.leader) return;
      leader = undefined;
      if (transaction === "open") {
        transaction = "lost";
        for (const pending of sent.values()) pending.reject(new HandOverError(LOST));
      } else {
        // Every result came before this: what has none did not run.
        unsent.unshift(...sent.values());
      }
      sent.clear();
      return;
    }
    const pending = sent.get(reply.id);
    // Failed already: its leader went before this came.
    if (!pending) return;
    sent.delete(reply.id);
    transaction = reply.transaction ? "open" : "none";
    if (reply.error === undefined) pending.resolve(reply.rows ?? []);
    else pending.reject(new Error(reply.error));
  });

  store.addEventListener("message", (event: MessageEvent<Announcement>) => {
    const announcement = event.data;
    if (announcement.type === "changed" && announcement.by !== client) notify();
    if (announcement.type !== "leader") return;
    announced = announcement.leader;
    if (leader !== announcement.leader) handOver();
  });

  // This tab's worker waits its turn to lead. A tab put away (`pagehide`
  // into the back/forward cache, `freeze`) lets it go, so the others never
  // wait on a frozen tab, and queues again when it is back.
  let worker: { readonly thread: Worker; readonly closed: Promise<void> } | undefined;
  const start = () => {
    const thread = new Worker(new URL("worker.ts", import.meta.url), {
      type: "module",
      name: "astrotime-store",
    });
    let gone: () => void = () => {};
    const closed = new Promise<void>((resolve) => (gone = resolve));
    thread.addEventListener("message", (event: MessageEvent<Report>) => {
      if (event.data.type === "failed") fail(new Error(event.data.error));
      else gone();
    });
    // A worker that fails to load or crashes answers nothing again.
    thread.addEventListener("error", (event) => {
      event.preventDefault();
      fail(new Error(`The store's worker failed: ${event.message || "it could not load"}`));
      gone();
    });
    thread.addEventListener("messageerror", () => {
      fail(new Error("The store's worker sent a message it could not read."));
      gone();
    });
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin
    thread.postMessage({ type: "lead", name } satisfies Command);
    worker = { thread, closed };
  };
  const away = () => {
    worker?.thread.terminate();
    worker = undefined;
  };
  const back = (event: Event) => {
    if (event instanceof PageTransitionEvent && !event.persisted) return;
    if (worker || broken) return;
    // Whatever was said while this tab was away is unknown: ask again.
    announced = undefined;
    handOver();
    start();
  };
  globalThis.addEventListener("pagehide", away);
  globalThis.addEventListener("pageshow", back);
  globalThis.document?.addEventListener("freeze", away);
  globalThis.document?.addEventListener("resume", back);

  const send = (request: Distribute<Request>) =>
    new Promise<unknown[][]>((resolve, reject) => {
      if (broken) return reject(broken);
      if (transaction === "lost") {
        // The transaction went with its leader: nothing more runs in it, and
        // a ROLLBACK has nothing left to do.
        const end = ENDS_TRANSACTION.exec(request.sql)?.[1]?.toUpperCase();
        if (end) transaction = "none";
        if (end === "ROLLBACK") return resolve([]);
        return reject(new HandOverError(LOST));
      }
      const pending = { request: { ...request, id: next++ }, resolve, reject };
      if (leader) post(pending);
      else unsent.push(pending);
    });

  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      fail(new Error(CLOSED));
      broken = new Error(CLOSED);
      globalThis.removeEventListener("pagehide", away);
      globalThis.removeEventListener("pageshow", back);
      globalThis.document?.removeEventListener("freeze", away);
      globalThis.document?.removeEventListener("resume", back);
      store.close();
      own.close();
      if (worker) {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin
        worker.thread.postMessage({ type: "close" } satisfies Command);
        await worker.closed;
        away();
      }
      release();
    })());

  start();
  announce({ type: "hello", client });
  try {
    await ready;
  } catch (error) {
    await close();
    throw error;
  }
  return {
    query: (sql, params) => send({ type: "query", sql, params }),
    script: async (sql) => {
      await send({ type: "script", sql });
    },
    close,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
