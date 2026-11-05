// @astrotime/mesh: a mesh of AstroTime peers that sync with each other
// (docs/plans/server.md#D283–D288). Isomorphic (AGENTS.md rule 1): its
// cryptography is WebCrypto's, its store and its transport are injected.
export { formatInvite, type Invite, type Mesh, newMesh, newPeerId, parseInvite } from "./invite.ts";
export { MeshNode, type MeshNodeOptions } from "./node.ts";
export { type Message, PROTOCOL } from "./protocol.ts";
export { MAX_DRIFT } from "./session.ts";
export { apply, change } from "./replica.ts";
export type { MeshStore, MeshTransaction } from "./store.ts";
export type {
  ConnectionHandlers,
  DialHandlers,
  MeshConnection,
  MeshTransport,
  Timers,
} from "./transport.ts";
export {
  compareHlc,
  compareVersions,
  covers,
  type Hlc,
  HybridClock,
  type Item,
  itemKey,
  mergeVectors,
  type Vector,
  type Version,
} from "./version.ts";
