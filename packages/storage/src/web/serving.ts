// What the leader does with every tab's statements (docs/plans/foundation.md#D98):
// it runs them on its one connection, one tab's transaction at a time, and
// tells the tabs of each commit. Apart from the worker, so it runs on any
// SQLite (`node:sqlite` in its tests).
import type { Reply, Request } from "./protocol.ts";

/** The leader's connection, as serving needs it. */
export interface Connection {
  /** Runs one statement and returns its rows; throws SQLite's error. */
  query(sql: string, params: readonly unknown[]): unknown[][];
  /** Runs a script of statements; throws SQLite's error. */
  script(sql: string): void;
  /** Whether a transaction is open. */
  inTransaction(): boolean;
  /**
   * Whether a write transaction committed since the last call: any write,
   * rows, the schema or a pragma such as `user_version`.
   */
  committed(): boolean;
}

/** Where serving sends what it has to say. */
export interface Out {
  /** The answer to one of `client`'s statements, on its channel. */
  reply(client: string, reply: Reply): void;
  /** `client`'s statement committed a write: every other tab reads again. */
  changed(client: string): void;
  /**
   * The connection is stuck in a transaction nobody owns (its ROLLBACK
   * failed): this leader cannot serve on, and must stop, so another opens
   * the database afresh (SQLite rolls the journal back when it does).
   */
  lost(error: Error): void;
}

export interface Serving {
  /** One of `client`'s statements: it runs now, or once the transaction ahead of it ends. */
  receive(client: string, request: Request): void;
  /**
   * `client`'s tab is gone (closed, discarded, or put away): its waiting
   * statements are dropped, and a transaction it left open is rolled back.
   */
  gone(client: string): void;
  /**
   * The leader closes: a transaction left open is rolled back, and the
   * statements still waiting never run (the next leader gets them).
   */
  close(): void;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function serving(connection: Connection, out: Out): Serving {
  /** The client whose transaction is open; the others' statements wait until it ends. */
  let owner: string | undefined;
  const waiting: { client: string; request: Request }[] = [];

  /** Who holds the connection after a statement of `client`; tells the others of a commit. */
  const settle = (client: string): boolean => {
    const transaction = connection.inTransaction();
    owner = transaction ? client : undefined;
    if (!transaction && connection.committed()) out.changed(client);
    return transaction;
  };

  const execute = (client: string, request: Request) => {
    let result: { rows?: unknown[][]; error?: string };
    try {
      result =
        request.type === "query"
          ? { rows: connection.query(request.sql, request.params) }
          : (connection.script(request.sql), {});
    } catch (error) {
      result = { error: messageOf(error) };
    }
    out.reply(client, { type: "result", id: request.id, transaction: settle(client), ...result });
  };

  // The oldest statement whose client may use the connection runs next: any
  // while no transaction is open, else only the owner's.
  const drain = () => {
    for (;;) {
      const next = waiting.findIndex((w) => owner === undefined || owner === w.client);
      if (next < 0) return;
      const [{ client, request }] = waiting.splice(next, 1) as [(typeof waiting)[number]];
      execute(client, request);
    }
  };

  /** Ends the owner's transaction, whatever ROLLBACK says: nobody else may wait on it. */
  /** Ends a gone tab's transaction; false when the connection is stuck in it. */
  const rollBack = (): boolean => {
    if (owner === undefined) return true;
    try {
      connection.script("ROLLBACK;");
    } catch {
      // Ended already, or a connection that cannot: which one, it says next.
    }
    // Still in it: another tab's statements would run inside the gone tab's
    // transaction, so nothing more runs here.
    if (connection.inTransaction()) return false;
    owner = undefined;
    return true;
  };

  return {
    receive(client, request) {
      waiting.push({ client, request });
      drain();
    },
    gone(client) {
      for (let i = waiting.length - 1; i >= 0; i--) {
        if (waiting[i]!.client === client) waiting.splice(i, 1);
      }
      // A tab gone mid-transaction leaves nothing of it.
      if (owner === client && !rollBack()) {
        waiting.length = 0;
        out.lost(new Error("A transaction of a tab that went could not be rolled back."));
        return;
      }
      drain();
    },
    close() {
      waiting.length = 0;
      rollBack();
    },
  };
}
