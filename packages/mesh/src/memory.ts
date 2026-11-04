// The mesh in memory, for tests (docs/plans/server.md#D290): a store, a
// network of connections that can be partitioned and says when it is quiet,
// and timers wound by hand. No test waits for time: it waits for the
// network to fall quiet, with no frame, dial or close in flight.
import type { MeshStore, MeshTransaction } from "./store.ts";
import type { ConnectionHandlers, MeshConnection, MeshTransport, Timers } from "./transport.ts";
import { covers, itemKey, type Vector, vectorOf, type Version } from "./version.ts";

export class MemoryMeshStore implements MeshStore {
  private current = new Map<string, Version>();
  private vectorNow: Vector = vectorOf();
  private known: string[] = [];
  private busy = false;

  constructor(addresses: readonly string[] = []) {
    this.known = [...addresses];
  }

  async transaction<T>(work: (tx: MeshTransaction) => Promise<T>): Promise<T> {
    if (this.busy) throw new Error("Two mesh transactions at once");
    this.busy = true;
    const current = new Map(this.current);
    let vector = this.vectorNow;
    try {
      const result = await work({
        vector: async () => vectorOf(vector),
        setVector: async (next) => {
          vector = vectorOf(next);
        },
        current: async (item) => current.get(itemKey(item)),
        put: async (version) => {
          current.set(itemKey(version.item), version);
        },
        notCoveredBy: async (other) =>
          [...current.values()].filter((version) => !covers(other, version)),
      });
      this.current = current;
      this.vectorNow = vector;
      return result;
    } finally {
      this.busy = false;
    }
  }

  async addresses(): Promise<string[]> {
    return [...this.known];
  }

  async addAddresses(addresses: readonly string[]): Promise<void> {
    for (const address of addresses) if (!this.known.includes(address)) this.known.push(address);
  }

  /** Every current version, in item order: two stores with equal ones agree. */
  versions(): Version[] {
    return [...this.current.entries()]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, version]) => version);
  }

  vector(): Vector {
    return vectorOf(this.vectorNow);
  }
}

/** A frame on its way, for `MemoryNetwork.tap`. */
export interface Frame {
  readonly from: string;
  readonly to: string;
  readonly text: string;
}

interface End {
  readonly name: string;
  handlers?: ConnectionHandlers;
  /** Settles once everything delivered to this end is handled. */
  inbox: Promise<void>;
  /** Settles once the last frame's handler was called. */
  called: Promise<void>;
}

interface Link {
  readonly ends: readonly [End, End];
  closed: boolean;
}

/**
 * Peers by name, connected in memory. Frames arrive in order, each once the
 * one before it was handled; a partition closes every connection across it
 * and refuses dials there until `heal`.
 */
export class MemoryNetwork {
  /** Sees every frame before it arrives, and may change it. */
  tap?: (frame: Frame) => string;
  /**
   * Hands each frame over as soon as the one before was handed over, not
   * handled: a transport that does not wait for a handler's promise.
   */
  concurrent = false;
  private pending = 0;
  private waiting: (() => void)[] = [];
  private readonly listeners = new Map<
    string,
    { name: string; accept: (connection: MeshConnection) => ConnectionHandlers }
  >();
  private readonly links = new Set<Link>();
  private groups: Map<string, number> | undefined;

  /** `name` listens at `address`, handing each connection to `accept` (a node's). */
  listen(
    address: string,
    name: string,
    accept: (connection: MeshConnection) => ConnectionHandlers,
  ): void {
    this.listeners.set(address, { name, accept });
  }

  unlisten(address: string): void {
    this.listeners.delete(address);
  }

  /** The transport `name` dials with. */
  transport(name: string): MeshTransport {
    return {
      dial: (address, handlers) =>
        this.work(async () => {
          const listener = this.listeners.get(address);
          if (!listener || !this.reachable(name, listener.name)) {
            handlers.failed(new Error(`${address} does not answer ${name}`));
            return;
          }
          const dialling: End = { name, inbox: Promise.resolve(), called: Promise.resolve() };
          const accepting: End = {
            name: listener.name,
            inbox: Promise.resolve(),
            called: Promise.resolve(),
          };
          const link: Link = { ends: [dialling, accepting], closed: false };
          this.links.add(link);
          accepting.handlers = listener.accept(this.connection(link, accepting, dialling));
          dialling.handlers = handlers.opened(this.connection(link, dialling, accepting));
        }),
    };
  }

  /** Splits the peers into groups that reach only each other. */
  partition(...groups: readonly (readonly string[])[]): void {
    this.groups = new Map(groups.flatMap((names, group) => names.map((name) => [name, group])));
    for (const link of this.links) {
      if (!this.reachable(link.ends[0].name, link.ends[1].name)) this.close(link);
    }
  }

  heal(): void {
    this.groups = undefined;
  }

  /** Resolves once no frame, dial or close is in flight. */
  quiet(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  /** The connections open now between two peers. */
  connected(a: string, b: string): number {
    return [...this.links].filter(
      ({ ends: [x, y] }) => (x.name === a && y.name === b) || (x.name === b && y.name === a),
    ).length;
  }

  private reachable(a: string, b: string): boolean {
    return !this.groups || this.groups.get(a) === this.groups.get(b);
  }

  private connection(link: Link, from: End, to: End): MeshConnection {
    return {
      send: (text) => {
        if (link.closed) return;
        // A frame sent before a close still arrives, as over a WebSocket.
        this.deliver(
          to,
          async () => {
            await to.handlers?.message(
              this.tap ? this.tap({ from: from.name, to: to.name, text }) : text,
            );
          },
          !this.concurrent,
        );
      },
      close: () => this.close(link),
    };
  }

  private close(link: Link): void {
    if (link.closed) return;
    link.closed = true;
    this.links.delete(link);
    for (const end of link.ends) this.deliver(end, async () => end.handlers?.closed());
  }

  /** Runs `step` on an end after everything delivered to it before. */
  private deliver(end: End, step: () => Promise<void>, waits = true): void {
    const before = end.inbox;
    if (waits) {
      end.inbox = this.work(() => before.then(step));
      end.called = end.inbox;
      return;
    }
    // After the frame before was handed over; its handling may still be under way.
    const previous = end.called;
    let called!: () => void;
    end.called = new Promise((resolve) => (called = resolve));
    const handled = this.work(() =>
      previous.then(() => {
        const result = step();
        called();
        return result;
      }),
    );
    end.inbox = Promise.all([before, handled]).then(() => undefined);
  }

  /** Counts work in flight until it settles. */
  private work(step: () => Promise<void> | void): Promise<void> {
    this.pending += 1;
    return Promise.resolve()
      .then(step)
      .catch(() => undefined)
      .finally(() => {
        this.pending -= 1;
        if (this.pending === 0) for (const resolve of this.waiting.splice(0)) resolve();
      });
  }
}

/** Timers that run when a test says so: `fire` runs every one waiting now. */
export class ManualTimers implements Timers {
  private readonly waiting = new Set<() => void>();

  after(_ms: number, run: () => void): () => void {
    this.waiting.add(run);
    return () => this.waiting.delete(run);
  }

  get size(): number {
    return this.waiting.size;
  }

  fire(): void {
    const due = [...this.waiting];
    this.waiting.clear();
    for (const run of due) run();
  }
}
