// How a peer's messages travel (docs/plans/server.md#D286, D288): text
// frames over a connection, in order. The shells give WebSocket; the tests
// `MemoryNetwork` (`@astrotime/mesh/memory`). A listening peer's shell
// hands each connection it accepts to `MeshNode.accept`.

/** One open connection to another peer. Frames arrive in the order they were sent. */
export interface MeshConnection {
  send(text: string): void;
  /** Closes both ends; each side's `closed` is called once. */
  close(): void;
}

/** What a peer does with a connection's frames. */
export interface ConnectionHandlers {
  /**
   * A frame from the other side, in order. A transport need not wait for
   * the promise before handing over the next: the session queues them.
   */
  message(text: string): Promise<void> | void;
  /** The connection closed, from either side or the network. */
  closed(): void;
}

export interface DialHandlers {
  opened(connection: MeshConnection): ConnectionHandlers;
  /** The address did not answer; nothing was opened. */
  failed(error: unknown): void;
}

export interface MeshTransport {
  /** Opens a connection to a listening address, calling back `opened` or `failed`. */
  dial(address: string, handlers: DialHandlers): void;
}

/** When to run something later: `setTimeout` in the shells, a hand-wound clock in tests. */
export interface Timers {
  after(ms: number, run: () => void): () => void;
}

export const realTimers: Timers = {
  after(ms, run) {
    const id = globalThis.setTimeout(run, ms);
    return () => globalThis.clearTimeout(id);
  },
};
