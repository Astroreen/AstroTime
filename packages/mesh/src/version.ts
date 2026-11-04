// Versions and the order between them (docs/plans/server.md#D284): every
// change to a mesh calendar or item is a version stamped with a hybrid
// logical clock, and the newest version of an item wins on every peer.

/**
 * A hybrid logical clock timestamp: wall-clock milliseconds, a counter for
 * changes within one millisecond (or while the wall clock lags one already
 * seen), and the peer that made it.
 */
export interface Hlc {
  readonly wall: number;
  readonly counter: number;
  readonly peer: string;
}

/**
 * What a version is of: a calendar (its name, colour and components), or
 * one calendar object in it, by UID.
 */
export interface Item {
  readonly calendar: string;
  readonly object?: string;
}

/**
 * One change to an item: its content (a calendar object's text as written,
 * a calendar's properties as its store writes them) or `null`, a tombstone
 * for a deletion; when and by whom (`hlc`); and the author's own sequence
 * number for it, which version vectors count.
 */
export interface Version {
  readonly item: Item;
  readonly hlc: Hlc;
  readonly seq: number;
  readonly body: string | null;
}

/** Per peer, the highest sequence number of its versions this replica covers. */
export type Vector = Readonly<Record<string, number>>;

/** The two parts of an item as one string, for maps keyed by item. */
export function itemKey(item: Item): string {
  return JSON.stringify([item.calendar, item.object ?? null]);
}

/** HLCs in order: wall clock, counter, then the peer id breaks a tie. */
export function compareHlc(a: Hlc, b: Hlc): number {
  if (a.wall !== b.wall) return a.wall < b.wall ? -1 : 1;
  if (a.counter !== b.counter) return a.counter < b.counter ? -1 : 1;
  if (a.peer !== b.peer) return a.peer < b.peer ? -1 : 1;
  return 0;
}

/**
 * The total order of versions: the newer wins. Two versions with one HLC
 * come from one peer, which never stamps two changes alike; the sequence
 * number keeps the order total all the same.
 */
export function compareVersions(a: Version, b: Version): number {
  return compareHlc(a.hlc, b.hlc) || a.seq - b.seq;
}

/** A copy of a vector with no prototype, so a peer named `__proto__` is just a key. */
export function vectorOf(vector: Vector = {}): Record<string, number> {
  return Object.assign(Object.create(null) as Record<string, number>, vector);
}

/** Whether a vector covers a version: its author's count reaches it. */
export function covers(vector: Vector, version: Version): boolean {
  return version.seq <= (Object.hasOwn(vector, version.hlc.peer) ? vector[version.hlc.peer]! : 0);
}

/** The element-wise maximum of two vectors. */
export function mergeVectors(a: Vector, b: Vector): Record<string, number> {
  const merged = vectorOf(a);
  for (const [peer, seq] of Object.entries(b)) {
    if (seq > (merged[peer] ?? 0)) merged[peer] = seq;
  }
  return merged;
}

/**
 * The clock a peer stamps its changes with. It never goes back: a change
 * is stamped after every version this peer has seen, whatever its wall
 * clock says, so an edit always wins over the version it replaced.
 */
export class HybridClock {
  private wall = 0;
  private counter = 0;
  private readonly peer: string;
  private readonly now: () => number;

  constructor(peer: string, now: () => number) {
    this.peer = peer;
    this.now = now;
  }

  /** The stamp of a change made now. */
  next(): Hlc {
    const now = Math.floor(this.now());
    if (now > this.wall) {
      this.wall = now;
      this.counter = 0;
    } else {
      this.counter += 1;
    }
    return { wall: this.wall, counter: this.counter, peer: this.peer };
  }

  /** Takes a stamp seen from another peer (or the store) into account. */
  observe(hlc: Hlc): void {
    if (hlc.wall > this.wall) {
      this.wall = hlc.wall;
      this.counter = hlc.counter;
    } else if (hlc.wall === this.wall && hlc.counter > this.counter) {
      this.counter = hlc.counter;
    }
  }
}
