// Where a peer keeps its side of the mesh (docs/plans/server.md#D288): the
// current version of every item, its version vector and the listening
// addresses it knows. `@astrotime/storage` implements it on its own tables;
// `MemoryMeshStore` (`@astrotime/mesh/memory`) is the tests'.
import type { Item, Vector, Version } from "./version.ts";

/** One transaction on a peer's store: what it writes lands together or not at all. */
export interface MeshTransaction {
  /** This replica's version vector. */
  vector(): Promise<Vector>;
  setVector(vector: Vector): Promise<void>;
  /** The current version of an item, a tombstone included. */
  current(item: Item): Promise<Version | undefined>;
  /**
   * Makes a version its item's current one. Only called with a version
   * newer than the current one; a store that shows the item (the user's
   * calendars) writes it there too, a tombstone as a deletion.
   */
  put(version: Version): Promise<void>;
  /** Every current version a vector does not cover: what a peer with it lacks. */
  notCoveredBy(vector: Vector): Promise<Version[]>;
}

export interface MeshStore {
  /**
   * Runs `work` in one transaction, committed when it resolves and rolled
   * back when it throws. A `MeshNode` never runs two at once.
   */
  transaction<T>(work: (tx: MeshTransaction) => Promise<T>): Promise<T>;
  /** The listening addresses this peer knows, from its invite and from gossip. */
  addresses(): Promise<string[]>;
  addAddresses(addresses: readonly string[]): Promise<void>;
}
