// A mesh's invite (docs/plans/server.md#D287):
// `astrotime-mesh:<mesh id>.<secret, base64url>@<listening address>,…`.
import { base64url, fromBase64url, randomBytes } from "./crypto.ts";

const SCHEME = "astrotime-mesh:";
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** A mesh: its id and its 32-byte secret. */
export interface Mesh {
  readonly id: string;
  readonly secret: Uint8Array<ArrayBuffer>;
}

export interface Invite {
  readonly mesh: Mesh;
  /** The listening addresses the inviting peer knows; none from a mesh of dial-only peers. */
  readonly addresses: readonly string[];
}

/** A new mesh, made by its first peer. */
export function newMesh(): Mesh {
  return { id: base64url(randomBytes(16)), secret: randomBytes(32) };
}

/** A new peer id: random, so two devices never pick the same one. */
export function newPeerId(): string {
  return base64url(randomBytes(16));
}

/**
 * An invite as text; throws on an address it could not carry (with `@`,
 * `,` or white space in it, which `parseInvite` would split).
 */
export function formatInvite({ mesh, addresses }: Invite): string {
  for (const address of addresses) {
    if (address === "" || /[@,\s]/.test(address)) {
      throw new RangeError(`An invite cannot carry the address ${JSON.stringify(address)}`);
    }
  }
  const text = `${SCHEME}${mesh.id}.${base64url(mesh.secret)}`;
  return addresses.length > 0 ? `${text}@${addresses.join(",")}` : text;
}

/** An invite from text a user pasted or scanned; undefined when it is not one. */
export function parseInvite(text: string): Invite | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith(SCHEME)) return undefined;
  const rest = trimmed.slice(SCHEME.length);
  const at = rest.indexOf("@");
  const [id, key, ...more] = (at === -1 ? rest : rest.slice(0, at)).split(".");
  if (id === undefined || key === undefined || more.length > 0 || !ID.test(id)) return undefined;
  const secret = fromBase64url(key);
  if (secret?.length !== 32) return undefined;
  const addresses = at === -1 ? [] : rest.slice(at + 1).split(",");
  if (addresses.some((address) => address === "" || /[@\s]/.test(address))) return undefined;
  return { mesh: { id, secret }, addresses };
}

/** Whether a peer or mesh id is well formed. */
export function isId(text: string): boolean {
  return ID.test(text);
}
