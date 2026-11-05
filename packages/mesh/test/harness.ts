// Peers of one mesh over the in-memory network, by name: each name is the
// peer's id, a listening one at `mem://<name>`. Nothing waits for time:
// `settle` waits for the network to fall quiet and winds the redial timers.
import { type Mesh, MeshNode, newMesh } from "../src/index.ts";
import { ManualTimers, MemoryMeshStore, MemoryNetwork } from "../src/memory.ts";

export interface PeerSpec {
  /** Whether it listens (a server image, a desktop) or only dials (a browser, a phone). */
  readonly listens: boolean;
  /** The listening peers its invite named. */
  readonly invitedBy: readonly string[];
  /** Its wall clock's offset from the others', in milliseconds. */
  readonly skew?: number;
  /** A mesh of its own instead of the harness's, for a wrong secret. */
  readonly mesh?: Mesh;
}

export const addressOf = (name: string) => `mem://${name}`;

export class Harness {
  readonly network = new MemoryNetwork();
  readonly timers = new ManualTimers();
  readonly mesh = newMesh();
  readonly stores = new Map<string, MemoryMeshStore>();
  readonly nodes = new Map<string, MeshNode>();
  readonly errors: { peer: string; error: unknown }[] = [];
  readonly refusals: { peer: string; reason: string }[] = [];
  /** Each peer's wall clock offset from the shared one, in milliseconds. */
  readonly skews = new Map<string, number>();
  /** Each peer's connected peers, every time they changed. */
  readonly connections: { peer: string; peers: readonly string[] }[] = [];
  /** The shared wall clock. */
  time = 1_800_000_000_000;
  private readonly specs = new Map<string, PeerSpec>();

  add(name: string, spec: PeerSpec): MemoryMeshStore {
    this.specs.set(name, spec);
    this.skews.set(name, spec.skew ?? 0);
    const store = new MemoryMeshStore(spec.invitedBy.map(addressOf));
    this.stores.set(name, store);
    return store;
  }

  /** Starts a peer, as a device opening the app: a new node on its store. */
  async up(name: string): Promise<MeshNode> {
    const spec = this.specs.get(name)!;
    const node = new MeshNode({
      peer: name,
      mesh: spec.mesh ?? this.mesh,
      store: this.stores.get(name)!,
      transport: this.network.transport(name),
      ...(spec.listens ? { listening: [addressOf(name)] } : {}),
      now: () => this.time + this.skews.get(name)!,
      timers: this.timers,
      onPeers: (peers) => this.connections.push({ peer: name, peers }),
      onError: (error) => this.errors.push({ peer: name, error }),
      onRefused: (reason) => this.refusals.push({ peer: name, reason }),
    });
    this.nodes.set(name, node);
    if (spec.listens)
      this.network.listen(addressOf(name), name, (connection) => node.accept(connection));
    await node.start();
    return node;
  }

  /** Stops a peer, as a device closing the app or going off. */
  down(name: string): void {
    this.network.unlisten(addressOf(name));
    this.nodes.get(name)?.stop();
    this.nodes.delete(name);
  }

  node(name: string): MeshNode {
    const node = this.nodes.get(name);
    if (!node) throw new Error(`${name} is down`);
    return node;
  }

  /**
   * Waits for quiet, then fires the redials waiting and waits again, until
   * none is left; at most `rounds` times, as a partitioned peer's redials
   * fail and wait again for ever.
   */
  async settle(rounds = 20): Promise<void> {
    await this.network.quiet();
    for (let round = 0; round < rounds && this.timers.size > 0; round += 1) {
      this.timers.fire();
      await this.network.quiet();
    }
  }

  versions(name: string) {
    return this.stores.get(name)!.versions();
  }
}
