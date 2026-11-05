// One connection between two peers (docs/plans/server.md#D286, D287): the
// handshake that proves both know the mesh secret before anything else is
// sent, then every message sealed with AES-GCM under a key of its direction.
//
// Each side sends a challenge (its peer id and a random nonce) as soon as
// the connection opens, and answers the other's with an HMAC over both
// nonces and both peer ids. A wrong proof closes the connection: nothing
// sealed has been sent by then. Each direction's key is HKDF of the secret
// salted with both nonces, the sender's first; its IVs count the messages,
// so a frame tampered with, replayed or dropped does not open and closes
// the connection too.
import {
  base64url,
  fromBase64url,
  open,
  prove,
  randomBytes,
  seal,
  sealingKey,
  verify,
} from "./crypto.ts";
import type { Mesh } from "./invite.ts";
import { type Challenge, type Message, parseFrame, parseMessage, PROTOCOL } from "./protocol.ts";
import type { ConnectionHandlers, MeshConnection } from "./transport.ts";
import type { Vector, Version } from "./version.ts";
import { covers, vectorOf } from "./version.ts";

/** Why a session ended without being established. */
export type Refusal =
  /** The other side is this very peer (its own address, gossiped back). */
  | "self"
  /** Another mesh, a wrong proof, or a frame out of place or that does not open. */
  | "refused"
  /** The two wall clocks differ by more than `MAX_DRIFT`. */
  | "clock"
  /** The other side sent a version stamped more than `MAX_DRIFT` ahead of this clock. */
  | "ahead";

/** The longest frame read before the handshake is done: a challenge, a proof, a refusal. */
const HANDSHAKE_FRAME = 1024;

/** How far two peers' wall clocks may differ, as Kerberos and TOTP bound drift (D284). */
export const MAX_DRIFT = 5 * 60_000;

/** A version stamped more than `MAX_DRIFT` ahead of this peer's clock (D284). */
export class ClockAheadError extends Error {
  override readonly name = "ClockAheadError";
}

export interface SessionEvents {
  /** Both sides proved the secret; sealed messages may flow. */
  established(session: Session): Promise<void>;
  message(session: Session, message: Message): Promise<void>;
  /** The connection closed. `refusal` says why when this side refused it, or the other in the handshake. */
  ended(session: Session, refusal?: Refusal): void;
  error(error: unknown): void;
}

export class Session {
  /** The other peer's id, once its challenge came. */
  peer: string | undefined;
  /** Live: anti-entropy is answered, new versions are pushed (D285). */
  live = false;
  /**
   * What the other side covers, as far as this side knows: its hello's
   * vector, this side's vector as of the batch it answered with, and the
   * versions sent or received since.
   */
  remote: Record<string, number> = vectorOf();
  private readonly seen = new Set<string>();

  private readonly nonce = randomBytes(32);
  private theirs: Challenge | undefined;
  private sending: CryptoKey | undefined;
  private receiving: CryptoKey | undefined;
  private sent = 0;
  private received = 0;
  private outbox: Promise<void> = Promise.resolve();
  private inbox: Promise<void> = Promise.resolve();
  /** When the other side answered this side's hello with its batch (D285). */
  answeredAt: number | undefined;
  private state: "handshake" | "open" | "closed" = "handshake";
  private refusal: Refusal | undefined;
  private readonly me: string;
  private readonly mesh: Mesh;
  private readonly proofKey: Promise<CryptoKey>;
  private readonly connection: MeshConnection;
  private readonly events: SessionEvents;
  private readonly now: () => number;
  /** The wall clock this side's challenge carried. */
  private clock = 0;
  /** The address this side dialled; undefined for a connection it accepted. */
  readonly address: string | undefined;

  constructor(
    me: string,
    mesh: Mesh,
    proofKey: Promise<CryptoKey>,
    connection: MeshConnection,
    events: SessionEvents,
    now: () => number,
    address?: string,
  ) {
    this.now = now;
    this.me = me;
    this.mesh = mesh;
    this.proofKey = proofKey;
    this.connection = connection;
    this.events = events;
    this.address = address;
  }

  /** Whether the connection closed, read afresh after an await. */
  private get gone(): boolean {
    return this.state === "closed";
  }

  /** Sends this side's challenge; the handlers to give the transport. */
  start(): ConnectionHandlers {
    const challenge: Challenge = {
      type: "challenge",
      protocol: PROTOCOL,
      mesh: this.mesh.id,
      peer: this.me,
      nonce: base64url(this.nonce),
      clock: (this.clock = Math.floor(this.now())),
    };
    this.connection.send(JSON.stringify(challenge));
    return {
      message: (text) => {
        // One frame at a time, whatever the transport does: the handshake and
        // the sealed frames' counters depend on the order.
        this.inbox = this.inbox.then(() => this.receive(text));
        return this.inbox;
      },
      closed: () => this.closed(),
    };
  }

  get established(): boolean {
    return this.sending !== undefined;
  }

  /** Whether the other side covers a version, as far as this side knows. */
  covers(version: Version): boolean {
    return covers(this.remote, version) || this.seen.has(seenKey(version));
  }

  /** Notes a version the other side has: one sent to it, or from it. */
  saw(version: Version): void {
    if (!covers(this.remote, version)) this.seen.add(seenKey(version));
  }

  /** Takes a vector the other side covers into `remote`. */
  learn(vector: Vector): void {
    for (const [peer, seq] of Object.entries(vector)) {
      if (seq > (this.remote[peer] ?? 0)) this.remote[peer] = seq;
    }
  }

  /** Seals and sends a message; resolves once it is on the connection. */
  send(message: Message): Promise<void> {
    this.outbox = this.outbox.then(async () => {
      if (this.state !== "open" || !this.sending) return;
      const data = await seal(this.sending, this.sent++, JSON.stringify(message));
      if (!this.gone) this.connection.send(JSON.stringify({ type: "sealed", data }));
    });
    return this.outbox;
  }

  close(refusal?: Refusal): void {
    if (this.state === "closed") return;
    // In the handshake, the other side is told why (in the clear: nothing secret).
    if (this.state === "handshake" && (refusal === "clock" || refusal === "refused")) {
      this.connection.send(JSON.stringify({ type: "refusal", reason: refusal }));
    }
    this.refusal ??= refusal;
    this.state = "closed";
    this.connection.close();
  }

  private closed(): void {
    this.state = "closed";
    this.events.ended(this, this.refusal);
  }

  private async receive(text: string): Promise<void> {
    if (this.gone) return;
    try {
      // Before the handshake proves anything, a frame is small: none is parsed past that.
      if (!this.established && text.length > HANDSHAKE_FRAME) return this.close("refused");
      const frame = parseFrame(text);
      if (frame.type === "challenge") {
        if (
          this.theirs ||
          frame.mesh !== this.mesh.id ||
          fromBase64url(frame.nonce)?.length !== 32
        ) {
          return this.close("refused");
        }
        if (frame.peer === this.me) return this.close("self");
        if (Math.abs(frame.clock - this.now()) > MAX_DRIFT) return this.close("clock");
        this.theirs = frame;
        this.peer = frame.peer;
        const proof = await prove(
          await this.proofKey,
          this.proofParts(
            [this.me, base64url(this.nonce), this.clock],
            [frame.peer, frame.nonce, frame.clock],
          ),
        );
        if (!this.gone) this.connection.send(JSON.stringify({ type: "proof", proof }));
        return;
      }
      if (frame.type === "refusal") {
        // In the clear, so believed only in the handshake: after it, anyone on
        // the path could send one, and it closes the connection with no reason.
        if (this.state === "handshake") this.refusal ??= frame.reason;
        return this.close();
      }
      if (frame.type === "proof") {
        const theirs = this.theirs;
        if (!theirs || this.established) return this.close("refused");
        const parts = this.proofParts(
          [theirs.peer, theirs.nonce, theirs.clock],
          [this.me, base64url(this.nonce), this.clock],
        );
        const theirNonce = fromBase64url(theirs.nonce)!;
        if (!(await verify(await this.proofKey, parts, frame.proof))) {
          return this.close("refused");
        }
        this.receiving = await sealingKey(this.mesh.secret, theirNonce, this.nonce);
        this.sending = await sealingKey(this.mesh.secret, this.nonce, theirNonce);
        if (this.gone) return;
        this.state = "open";
        return await this.own(() => this.events.established(this));
      }
      if (this.state !== "open" || !this.receiving) return this.close("refused");
      const message = parseMessage(await open(this.receiving, this.received++, frame.data));
      await this.own(() => this.events.message(this, message));
    } catch (error) {
      // A frame malformed, or sealed without this key and count.
      this.events.error(error);
      this.close("refused");
    }
  }

  /** Runs this side's handling of a frame: what it throws (a store) refuses nobody. */
  private async own(work: () => Promise<void>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.events.error(error);
      this.close(error instanceof ClockAheadError ? "ahead" : undefined);
    }
  }

  /** What a proof is over: the prover's and the verifier's peer id, nonce and clock. */
  private proofParts(
    prover: readonly [string, string, number],
    verifier: readonly [string, string, number],
  ) {
    return ["proof", PROTOCOL, this.mesh.id, ...prover, ...verifier].map(String);
  }
}

const seenKey = (version: Version) => `${version.hlc.peer}:${version.seq}`;
