// The web store's worker: SQLite compiled to WebAssembly, on the Origin
// Private File System through the "opfs-sahpool" VFS, which needs a worker
// but no cross-origin isolation headers (docs/plans/foundation.md#D25).
//
// Every tab's driver has one. The VFS holds the database's files
// exclusively, so only the worker holding the store's Web Lock opens them:
// it leads, and serves the statements of every tab, its own included
// (docs/plans/foundation.md#D98). The lock lives and dies with this worker,
// as the files' handles do.
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

import {
  names,
  post,
  type Announcement,
  type Command,
  type Report,
  type Reply,
  type Request,
} from "./protocol.ts";
import { serving } from "./serving.ts";

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type Pool = Awaited<ReturnType<Sqlite3["installOpfsSAHPoolVfs"]>>;
type Database = InstanceType<Pool["OpfsSAHPoolDb"]>;

interface Leader {
  /** Closes the database; `closed` settles once it is. */
  close(): void;
  readonly closed: Promise<void>;
}

const report = (message: Report) =>
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker's postMessage takes no origin
  self.postMessage(message);

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Ends this worker's turn: stops waiting for the lock, or closes the database. */
let stop: () => Promise<void> = async () => {};

self.addEventListener("message", (event: MessageEvent<Command>) => {
  const command = event.data;
  if (command.type === "close") {
    void stop().then(() => report({ type: "closed" }));
    return;
  }
  const quit = new AbortController();
  let stopping = false;
  let leading: Promise<Leader> | undefined;
  // Without `ifAvailable`: the tabs queue, and the next one leads when this one goes.
  const turn = navigator.locks
    .request(names(command.name).store, { signal: quit.signal }, () => {
      if (stopping) return;
      leading = lead(command.name);
      // The lock lasts until the database is closed.
      return leading.then(
        (leader) => leader.closed,
        (error: unknown) => report({ type: "failed", error: messageOf(error) }),
      );
    })
    .catch(() => {
      // Aborted while waiting: the tab closed its store before its turn came.
    });
  stop = async () => {
    stopping = true;
    quit.abort();
    (await leading?.catch(() => undefined))?.close();
    await turn;
  };
});

/** Opens the database and serves it to every driver until it is closed. */
async function lead(name: string): Promise<Leader> {
  const { sqlite3, pool, db } = await open(name);
  // Every leader's connection is set up alike, since drivers move between
  // them without knowing: foreign keys on, as the store's schema expects.
  db.exec("PRAGMA foreign_keys = ON;");
  // Any write transaction that commits, whatever it wrote: rows, the schema,
  // `user_version`. A rolled back one changed nothing for the other tabs.
  let committed = false;
  sqlite3.capi.sqlite3_commit_hook(
    db.pointer!,
    () => {
      committed = true;
      return 0;
    },
    0,
  );
  const leader = crypto.randomUUID();
  const channels = names(name);
  const store = new BroadcastChannel(channels.store);
  const clients = new Map<string, { channel: BroadcastChannel; watch: AbortController }>();

  const served = serving(
    {
      query: (sql, params) =>
        db.exec({
          sql,
          bind: params as never,
          rowMode: "array",
          returnValue: "resultRows",
        }) as unknown[][],
      script: (sql) => void db.exec(sql),
      inTransaction: () => sqlite3.capi.sqlite3_get_autocommit(db.pointer!) === 0,
      committed: () => {
        const was = committed;
        committed = false;
        return was;
      },
    },
    {
      reply(client, reply) {
        const known = clients.get(client);
        if (known) post(known.channel, reply);
      },
      changed: (by) => post(store, { type: "changed", by } satisfies Announcement),
      // The tab terminates this worker on it, which closes the database and lets the lock go.
      lost: (error) => report({ type: "lost", error: messageOf(error) }),
    },
  );

  const gone = (client: string) => {
    const known = clients.get(client);
    if (!known) return;
    clients.delete(client);
    known.watch.abort();
    known.channel.close();
    served.gone(client);
  };

  const serve = (client: string) => {
    let known = clients.get(client);
    if (!known) {
      known = {
        channel: new BroadcastChannel(channels.channel(client)),
        watch: new AbortController(),
      };
      clients.set(client, known);
      known.channel.addEventListener("message", (event: MessageEvent<Request>) =>
        served.receive(client, event.data),
      );
      // A driver holds a lock of its own while it is open: granted here, it is gone.
      navigator.locks
        .request(channels.client(client), { signal: known.watch.signal }, () => gone(client))
        .catch(() => {
          // Aborted: this leader closed first.
        });
    }
    post(known.channel, { type: "welcome", leader } satisfies Reply);
  };

  store.addEventListener("message", (event: MessageEvent<Announcement>) => {
    if (event.data.type === "hello") serve(event.data.client);
  });
  post(store, { type: "leader", leader } satisfies Announcement);

  let done: () => void = () => {};
  const closed = new Promise<void>((resolve) => (done = resolve));
  return {
    closed,
    close() {
      // A transaction left open is rolled back; the statements not run yet
      // go to the next leader (docs/plans/foundation.md#D98).
      served.close();
      for (const known of clients.values()) {
        known.watch.abort();
        post(known.channel, { type: "bye", leader } satisfies Reply);
        known.channel.close();
      }
      clients.clear();
      store.close();
      try {
        db.close();
        // The files' handles go before the lock, so the next leader opens them at once.
        pool.pauseVfs();
      } catch {
        // The lock goes all the same: the next leader opens the files once
        // this worker's end lets them go (`open` tries again meanwhile).
      }
      done();
    },
  };
}

/**
 * Opens the database on OPFS. The worker that led before may hold the files
 * for a moment after its lock is released (a closed tab tears both down in
 * no set order), so a locked file is tried again, for a few seconds.
 */
async function open(name: string): Promise<{ sqlite3: Sqlite3; pool: Pool; db: Database }> {
  const sqlite3 = await sqlite3InitModule();
  const options = {
    name: `astrotime-${name}`,
    // A failed open would otherwise delete the pool's files, the database with them.
    preserveOnInitFailure: true,
    // Without it, a failed open is remembered and every later one fails as it did
    // (sqlite-wasm's own option, missing from its typings).
    forceReinitIfPreviouslyFailed: true,
  };
  for (let attempt = 0; ; attempt++) {
    try {
      const pool = await sqlite3.installOpfsSAHPoolVfs(options);
      return { sqlite3, pool, db: new pool.OpfsSAHPoolDb(`/${name}.sqlite3`) };
    } catch (error) {
      const locked = error instanceof DOMException && error.name === "NoModificationAllowedError";
      if (!locked || attempt === 7) throw error;
      // 50 ms, doubling: about 6 s in all.
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}
