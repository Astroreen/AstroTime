// The mesh protocol's messages (docs/plans/server.md#D285–D287), JSON in
// text frames. The handshake goes in the clear; every message after it is
// sealed. A frame that is not one of these closes the connection.
import { isId } from "./invite.ts";
import type { Hlc, Item, Vector, Version } from "./version.ts";

export const PROTOCOL = "astrotime-mesh.1";

/** In the clear: each side's first frame, with a random challenge for the other. */
export interface Challenge {
  readonly type: "challenge";
  readonly protocol: typeof PROTOCOL;
  readonly mesh: string;
  readonly peer: string;
  readonly nonce: string;
  /** This side's wall clock in milliseconds, checked against the other's (D284). */
  readonly clock: number;
}

/** In the clear: the answer to the other side's challenge, an HMAC with the mesh secret. */
interface Proof {
  readonly type: "proof";
  readonly proof: string;
}

/** The sealed text of a `Message`. */
interface Sealed {
  readonly type: "sealed";
  readonly data: string;
}

/**
 * In the clear, in the handshake: why this side closes the connection, so
 * the other can say so too (a clock off, D284; a wrong secret, D287).
 */
interface Refused {
  readonly type: "refusal";
  readonly reason: "clock" | "refused";
}

export type Frame = Challenge | Proof | Sealed | Refused;

/** The first sealed message: this side's vector and the listening addresses it knows. */
interface Hello {
  readonly type: "hello";
  readonly vector: Vector;
  readonly addresses: readonly string[];
}

/**
 * The answer to a hello: every current version the other side's vector
 * does not cover, and the vector they were taken with.
 */
interface Batch {
  readonly type: "batch";
  readonly versions: readonly Version[];
  readonly vector: Vector;
}

/** A version made or applied since, live. */
interface Push {
  readonly type: "push";
  readonly version: Version;
}

/** Listening addresses learned since the hello. */
interface Addresses {
  readonly type: "addresses";
  readonly addresses: readonly string[];
}

export type Message = Hello | Batch | Push | Addresses;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function isVector(value: unknown): value is Vector {
  return (
    isObject(value) && Object.entries(value).every(([peer, seq]) => isId(peer) && isCount(seq))
  );
}

function isHlc(value: unknown): value is Hlc {
  return (
    isObject(value) &&
    isCount(value.wall) &&
    isCount(value.counter) &&
    isString(value.peer) &&
    isId(value.peer)
  );
}

function isItem(value: unknown): value is Item {
  return (
    isObject(value) &&
    isString(value.calendar) &&
    (value.object === undefined || isString(value.object))
  );
}

/** A version from the wire, rebuilt with nothing but its fields; undefined when it is not one. */
function versionOf(value: unknown): Version | undefined {
  if (
    !isObject(value) ||
    !isItem(value.item) ||
    !isHlc(value.hlc) ||
    !isCount(value.seq) ||
    value.seq === 0 ||
    !(value.body === null || isString(value.body))
  ) {
    return undefined;
  }
  const { calendar, object } = value.item;
  return {
    item: object === undefined ? { calendar } : { calendar, object },
    hlc: { wall: value.hlc.wall, counter: value.hlc.counter, peer: value.hlc.peer },
    seq: value.seq,
    body: value.body,
  };
}

const isAddresses = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((address) => isString(address) && address !== "");

/** A frame from the wire; throws on anything else. */
export function parseFrame(text: string): Frame {
  const value: unknown = JSON.parse(text);
  if (isObject(value)) {
    if (
      value.type === "challenge" &&
      value.protocol === PROTOCOL &&
      isString(value.mesh) &&
      isString(value.peer) &&
      isId(value.peer) &&
      isString(value.nonce) &&
      isCount(value.clock)
    ) {
      return value as unknown as Challenge;
    }
    if (value.type === "proof" && isString(value.proof)) return value as unknown as Proof;
    if (value.type === "refusal" && (value.reason === "clock" || value.reason === "refused")) {
      return { type: "refusal", reason: value.reason };
    }
    if (value.type === "sealed" && isString(value.data)) return value as unknown as Sealed;
  }
  throw new TypeError("Not a mesh frame");
}

/** A message from a frame's opened text; throws on anything else. */
export function parseMessage(text: string): Message {
  const value: unknown = JSON.parse(text);
  if (isObject(value)) {
    if (value.type === "hello" && isVector(value.vector) && isAddresses(value.addresses)) {
      return value as unknown as Hello;
    }
    if (value.type === "batch" && Array.isArray(value.versions) && isVector(value.vector)) {
      const versions = value.versions.map(versionOf);
      if (versions.every((version) => version !== undefined)) {
        return { type: "batch", versions, vector: value.vector };
      }
    }
    if (value.type === "push") {
      const version = versionOf(value.version);
      if (version) return { type: "push", version };
    }
    if (value.type === "addresses" && isAddresses(value.addresses)) {
      return value as unknown as Addresses;
    }
  }
  throw new TypeError("Not a mesh message");
}
