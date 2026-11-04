// The replica's rules (docs/plans/server.md#D284, D285), on one
// transaction of a `MeshStore`: a change made here, versions applied from
// another peer, and what another peer lacks.
import type { MeshTransaction } from "./store.ts";
import {
  compareVersions,
  covers,
  type HybridClock,
  type Item,
  mergeVectors,
  type Vector,
  vectorOf,
  type Version,
} from "./version.ts";

/**
 * A change made on this peer: a new version of `item` (`body` null deletes
 * it), stamped after its current one, with this peer's next sequence number.
 */
export async function change(
  tx: MeshTransaction,
  clock: HybridClock,
  peer: string,
  item: Item,
  body: string | null,
): Promise<Version> {
  const vector = vectorOf(await tx.vector());
  const current = await tx.current(item);
  if (current) clock.observe(current.hlc);
  const seq = (vector[peer] ?? 0) + 1;
  const version: Version = { item, hlc: clock.next(), seq, body };
  await tx.put(version);
  vector[peer] = seq;
  await tx.setVector(vector);
  return version;
}

/**
 * Applies versions from another peer: each newer than its item's current
 * version replaces it. The vector counts a version once every earlier one
 * of its author is covered too, so it never claims one this replica has
 * not seen; a version that arrived out of order is applied all the same and
 * counted at the next anti-entropy. With `sender`, the vector of the peer
 * that answered with these versions as everything it had that this one
 * lacked, the vector then takes the element-wise maximum (D285).
 *
 * Returns the versions that changed something here, a winner or a newly
 * counted one: those a peer passes on (the relay of D283). The rest it
 * already had, or had newer.
 */
export async function apply(
  tx: MeshTransaction,
  versions: readonly Version[],
  sender?: Vector,
): Promise<Version[]> {
  const vector = vectorOf(await tx.vector());
  const fresh: Version[] = [];
  const ordered = versions.toSorted((a, b) =>
    a.hlc.peer < b.hlc.peer ? -1 : a.hlc.peer > b.hlc.peer ? 1 : a.seq - b.seq,
  );
  for (const version of ordered) {
    if (covers(vector, version)) continue;
    const current = await tx.current(version.item);
    const wins = !current || compareVersions(version, current) > 0;
    if (wins) await tx.put(version);
    const counted = version.seq === (vector[version.hlc.peer] ?? 0) + 1;
    if (counted) vector[version.hlc.peer] = version.seq;
    if (wins || counted) fresh.push(version);
  }
  await tx.setVector(sender ? mergeVectors(vector, sender) : vector);
  return fresh;
}
