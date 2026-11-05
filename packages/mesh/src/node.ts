// A peer of a mesh (docs/plans/server.md#D283–D287): its store, its
// connections, and the rules between them. On every connection, once the
// handshake is done, each side says hello with its vector and answers the
// other's with every current version that vector does not cover (D285);
// after that, each version this peer makes or applies goes to every other
// connected peer that does not have it, and that is the relay of D283.
// The peer dials every listening address it knows, redialling with backoff,
// and tells the others the addresses it learns (D286).
import { proofKey } from "./crypto.ts";
import type { Mesh } from "./invite.ts";
import type { Message } from "./protocol.ts";
import { apply, change } from "./replica.ts";
import { ClockAheadError, MAX_DRIFT, type Refusal, Session } from "./session.ts";
import type { MeshStore } from "./store.ts";
import {
  type ConnectionHandlers,
  type MeshConnection,
  type MeshTransport,
  realTimers,
  type Timers,
} from "./transport.ts";
import { HybridClock, type Item, type Vector, type Version } from "./version.ts";

/** The first redial's wait after a failed dial, doubled per failure up to `MAX_BACKOFF`. */
const BACKOFF = 1000;
const MAX_BACKOFF = 60_000;

export interface MeshNodeOptions {
  /** This peer's id, made once per device and mesh (D292). */
  readonly peer: string;
  readonly mesh: Mesh;
  readonly store: MeshStore;
  readonly transport: MeshTransport;
  /** The addresses this peer listens at, if it can: told to the others, never dialled. */
  readonly listening?: readonly string[];
  /** The wall clock in milliseconds; `Date.now` by default. */
  readonly now?: () => number;
  readonly timers?: Timers;
  /** The peers connected now, each time that changes (the account row's count, D289). */
  readonly onPeers?: (peers: readonly string[]) => void;
  /**
   * A connection this side refused, or the other in the handshake: `clock`
   * when the two wall clocks are more than five minutes apart, which the UI
   * says ("this device's clock is off", D284); `ahead` when the other side
   * sent a version stamped more than five minutes ahead (its clock, or the
   * clock of the peer that made it); `refused` for a wrong secret.
   */
  readonly onRefused?: (reason: "clock" | "refused" | "ahead", address: string | undefined) => void;
  /** A connection that failed: a frame that did not open, a store that threw. */
  readonly onError?: (error: unknown) => void;
}

/** One listening address and this peer's dialling of it. */
interface Dial {
  /** A dial or its connection is under way. */
  busy: boolean;
  failures: number;
  /** The peer that answered there last. */
  peer?: string;
  cancel?: (() => void) | undefined;
}

export class MeshNode {
  readonly peer: string;
  private readonly clock: HybridClock;
  private readonly now: () => number;
  private readonly timers: Timers;
  private readonly proofKey: Promise<CryptoKey>;
  /** Every connection, in the handshake or established. */
  private readonly connections = new Set<Session>();
  /** The established session with each peer. */
  private readonly sessions = new Map<string, Session>();
  private readonly dials = new Map<string, Dial>();
  private readonly known = new Set<string>();
  private readonly own: ReadonlySet<string>;
  private readonly selves = new Set<string>();
  private lock: Promise<unknown> = Promise.resolve();
  private running = false;
  private readonly options: MeshNodeOptions;

  constructor(options: MeshNodeOptions) {
    this.options = options;
    this.peer = options.peer;
    this.now = options.now ?? Date.now;
    this.clock = new HybridClock(options.peer, this.now);
    this.timers = options.timers ?? realTimers;
    this.proofKey = proofKey(options.mesh.secret);
    this.own = new Set(options.listening);
  }

  /** Starts dialling every listening address the store knows. */
  async start(): Promise<void> {
    this.running = true;
    for (const address of await this.options.store.addresses()) this.known.add(address);
    this.dialAll();
  }

  /** Closes every connection and dials no more. */
  stop(): void {
    this.running = false;
    for (const dial of this.dials.values()) {
      dial.cancel?.();
      dial.cancel = undefined;
    }
    for (const session of this.connections) session.close();
  }

  /** The peers connected now. */
  peers(): string[] {
    return [...this.sessions.keys()];
  }

  /** A connection a listening shell accepted. */
  accept(connection: MeshConnection): ConnectionHandlers {
    return this.open(connection);
  }

  /** A change made on this peer: a version of `item`, or its tombstone with `body` null. */
  async change(item: Item, body: string | null): Promise<Version> {
    const version = await this.exclusive(() =>
      this.options.store.transaction((tx) => change(tx, this.clock, this.peer, item, body)),
    );
    await this.relay([version]);
    return version;
  }

  private open(connection: MeshConnection, address?: string): ConnectionHandlers {
    const session = new Session(
      this.peer,
      this.options.mesh,
      this.proofKey,
      connection,
      {
        established: (established) => this.established(established),
        message: (from, message) => this.message(from, message),
        ended: (ended, refusal) => this.ended(ended, refusal),
        error: (error) => this.options.onError?.(error),
      },
      this.now,
      address,
    );
    this.connections.add(session);
    const handlers = session.start();
    if (!this.running) session.close();
    return handlers;
  }

  /** Runs store work one at a time, so a snapshot and the pushes after it see one order. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.lock.then(work);
    this.lock = result.catch(() => undefined);
    return result;
  }

  private async established(session: Session): Promise<void> {
    const peer = session.peer!;
    if (!this.running) return session.close();
    if (session.address !== undefined) {
      const dial = this.dial(session.address);
      dial.peer = peer;
    }
    const existing = this.sessions.get(peer);
    if (existing && this.keeps(existing, session)) return session.close();
    this.sessions.set(peer, session);
    existing?.close();
    this.options.onPeers?.(this.peers());
    const vector = await this.exclusive(() => this.options.store.transaction((tx) => tx.vector()));
    await session.send({ type: "hello", vector, addresses: this.addresses() });
  }

  /**
   * Of two connections with one peer, both sides keep the same one: the
   * one dialled by the smaller peer id, or of one dialler's, the newer.
   */
  private keeps(existing: Session, added: Session): boolean {
    const dialler = (session: Session) =>
      session.address === undefined ? session.peer! : this.peer;
    const [kept, other] = [dialler(existing), dialler(added)];
    return kept !== other && kept < other;
  }

  private async message(session: Session, message: Message): Promise<void> {
    switch (message.type) {
      case "hello": {
        // The batch is queued under the lock, before any push after its snapshot;
        // its sealing is not waited for there. A second hello gets no second batch.
        const [sent] = await this.exclusive(async () => {
          if (session.live) return [Promise.resolve()] as const;
          const [versions, vector] = await this.options.store.transaction(
            async (tx) => [await tx.notCoveredBy(message.vector), await tx.vector()] as const,
          );
          session.learn(message.vector);
          session.learn(vector);
          session.live = true;
          return [session.send({ type: "batch", versions, vector })] as const;
        });
        await Promise.all([sent, this.learnAddresses(message.addresses, session)]);
        return;
      }
      case "batch":
        return this.received(session, message.versions, message.vector);
      case "push":
        return this.received(session, [message.version]);
      case "addresses":
        return this.learnAddresses(message.addresses, session);
    }
  }

  private async received(
    session: Session,
    versions: readonly Version[],
    vector?: Vector,
  ): Promise<void> {
    const limit = this.now() + MAX_DRIFT;
    if (versions.some((version) => version.hlc.wall > limit)) {
      throw new ClockAheadError("A version came stamped more than five minutes ahead");
    }
    for (const version of versions) {
      this.clock.observe(version.hlc);
      session.saw(version);
    }
    const fresh = await this.exclusive(() =>
      this.options.store.transaction((tx) => apply(tx, versions, vector)),
    );
    if (vector) {
      session.learn(vector);
      session.answeredAt ??= this.now();
    }
    await this.relay(fresh, session);
  }

  /** Pushes versions to every live session but `from` that does not have them. */
  private async relay(versions: readonly Version[], from?: Session): Promise<void> {
    const sent: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      if (session === from || !session.live) continue;
      for (const version of versions) {
        if (session.covers(version)) continue;
        session.saw(version);
        sent.push(session.send({ type: "push", version }));
      }
    }
    await Promise.all(sent);
  }

  private addresses(): string[] {
    return [...new Set([...this.own, ...this.known])];
  }

  private async learnAddresses(addresses: readonly string[], from: Session): Promise<void> {
    const added = addresses.filter((address) => !this.known.has(address) && !this.own.has(address));
    if (added.length === 0) return;
    for (const address of added) this.known.add(address);
    await this.options.store.addAddresses(added);
    const sent: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      // Every established session, live or not: its hello may have gone before.
      if (session !== from) {
        sent.push(session.send({ type: "addresses", addresses: added }));
      }
    }
    this.dialAll();
    await Promise.all(sent);
  }

  private dial(address: string): Dial {
    let dial = this.dials.get(address);
    if (!dial) {
      dial = { busy: false, failures: 0 };
      this.dials.set(address, dial);
    }
    return dial;
  }

  /** Dials every known address with no connection, no dial under way and no redial waiting. */
  private dialAll(): void {
    if (!this.running) return;
    for (const address of this.known) {
      if (this.own.has(address) || this.selves.has(address)) continue;
      const dial = this.dial(address);
      if (dial.busy || dial.cancel) continue;
      if (dial.peer !== undefined && this.sessions.has(dial.peer)) continue;
      dial.busy = true;
      this.options.transport.dial(address, {
        opened: (connection) => this.open(connection, address),
        failed: () => {
          dial.busy = false;
          this.retry(address, dial);
        },
      });
    }
  }

  private retry(address: string, dial: Dial): void {
    if (!this.running) return;
    dial.failures += 1;
    const wait = Math.min(BACKOFF * 2 ** (dial.failures - 1), MAX_BACKOFF);
    dial.cancel = this.timers.after(wait, () => {
      dial.cancel = undefined;
      this.dialAll();
    });
  }

  private ended(session: Session, refusal?: Refusal): void {
    this.connections.delete(session);
    if (session.peer !== undefined && this.sessions.get(session.peer) === session) {
      this.sessions.delete(session.peer);
      this.options.onPeers?.(this.peers());
    }
    if (refusal === "clock" || refusal === "refused" || refusal === "ahead")
      this.options.onRefused?.(refusal, session.address);
    if (session.address !== undefined) {
      const dial = this.dial(session.address);
      dial.busy = false;
      // Always again after a wait, so a peer that drops each connection is never
      // dialled in a loop. The wait starts over only after a connection that
      // served a batch and stayed up as long as the longest wait.
      const served = session.answeredAt;
      if (!refusal && served !== undefined && this.now() - served >= MAX_BACKOFF) {
        dial.failures = 0;
      }
      const elsewhere = session.peer !== undefined && this.sessions.has(session.peer);
      if (refusal === "self") this.selves.add(session.address);
      else if (!elsewhere) this.retry(session.address, dial);
    }
    this.dialAll();
  }
}
