// How the tabs share the web store (docs/plans/foundation.md#D98): every tab's
// driver has a worker; the one holding the store's Web Lock opens the database
// and serves every driver, its own tab's included.

/** A tab's driver to its own worker. */
export type Command = { readonly type: "lead"; readonly name: string } | { readonly type: "close" };

/** A worker to its tab's driver. */
export type Report =
  /** It held the lock but could not open the database; it let the lock go. */
  | { readonly type: "failed"; readonly error: string }
  /** It led, and stopped: its connection was stuck in a gone tab's transaction. */
  | { readonly type: "lost"; readonly error: string }
  | { readonly type: "closed" };

/** On the store's channel, which every driver and the leader hear. */
export type Announcement =
  /** A driver asks the leader to serve it on the driver's own channel. */
  | { readonly type: "hello"; readonly client: string }
  /** A worker opened the database and serves it now. */
  | { readonly type: "leader"; readonly leader: string }
  /** The leader committed writes of `by`. */
  | { readonly type: "changed"; readonly by: string };

/** A driver to the leader, on the driver's own channel. */
export type Request =
  | {
      readonly id: number;
      readonly type: "query";
      readonly sql: string;
      readonly params: readonly unknown[];
    }
  | { readonly id: number; readonly type: "script"; readonly sql: string };

/** The leader to a driver, on the driver's own channel. */
export type Reply =
  | { readonly type: "welcome"; readonly leader: string }
  /**
   * The leader closed the database. It came after every result, so a
   * statement without one did not run: the next leader gets it.
   */
  | { readonly type: "bye"; readonly leader: string }
  | {
      readonly type: "result";
      readonly id: number;
      /** Whether the driver's transaction is still open after this statement. */
      readonly transaction: boolean;
      readonly rows?: unknown[][];
      readonly error?: string;
    };

/** The names of a store's Web Locks and channels. */
export const names = (name: string) => {
  const store = `astrotime-store:${name}`;
  return {
    /** The lock the leader holds, and the channel every driver hears. */
    store,
    /** A driver's own channel to the leader. */
    channel: (client: string) => `${store}:${client}`,
    /** The lock a driver holds while it is open, so the leader learns when it is gone. */
    client: (client: string) => `${store}:client:${client}`,
  };
};

/** Posts a message on a channel (a BroadcastChannel's postMessage takes no origin). */
export function post<T extends Announcement | Request | Reply>(
  channel: BroadcastChannel,
  message: T,
): void {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel takes no origin
  channel.postMessage(message);
}
