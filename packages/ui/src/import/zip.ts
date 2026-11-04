// The files of a ZIP archive (docs/plans/import.md#D266): Google Calendar's
// export is one, an `.ics` per calendar. Loaded only for a ZIP. Stored and
// deflated entries are read, deflate by the platform's own
// `DecompressionStream`; anything else (ZIP64, encryption, another method)
// is named, not read.

export interface ZipEntry {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * What an archive may hold, so a ZIP bomb (a few kilobytes that inflate to
 * gigabytes) costs nothing: so many files, so many bytes in all, and no
 * file inflating past its stated size or 1000 times its own. A file past
 * a limit is named as unread; the read stops at the total.
 */
export const ZIP_LIMITS = { entries: 1000, total: 64 * 1024 * 1024, ratio: 1000 } as const;

/** The archive's files, folders left out; `unread`, the names it could not read. */
export async function unzip(
  bytes: Uint8Array,
  limits: { readonly entries: number; readonly total: number; readonly ratio: number } = ZIP_LIMITS,
): Promise<{ readonly entries: ZipEntry[]; readonly unread: string[] }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record: its signature, within the last 64 KiB and 22 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("The archive has no central directory.");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const names = new TextDecoder();
  const entries: ZipEntry[] = [];
  const unread: string[] = [];
  let left = limits.total;
  for (let n = 0; n < count && at + 46 <= bytes.length; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const inflated = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extra = view.getUint16(at + 30, true);
    const comment = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (name.endsWith("/")) continue;
    const encrypted = (flags & 1) !== 0;
    const tooMany = entries.length >= limits.entries;
    const tooBig = inflated > left || inflated > Math.max(size, 1) * limits.ratio;
    if (encrypted || tooMany || tooBig || size === 0xffffffff || (method !== 0 && method !== 8)) {
      unread.push(name);
      continue;
    }
    if (local + 30 > bytes.length) {
      unread.push(name);
      continue;
    }
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    try {
      const read = method === 0 ? data : await inflate(data, inflated);
      left -= read.length;
      entries.push({ name, bytes: read });
    } catch {
      unread.push(name);
    }
  }
  return { entries, unread };
}

/** Inflates `data`, refusing once it grows past `limit`: no more than the archive said. */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  const reader = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
    .getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > limit) {
      await reader.cancel();
      throw new Error("The entry inflates past its stated size.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
