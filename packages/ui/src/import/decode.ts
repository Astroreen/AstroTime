// A file's bytes as text (docs/plans/import.md#D267): UTF-8, or UTF-16 by
// its byte order mark; a file that is not UTF-8 in the charset it names,
// else the charset most likely in the user's language, said as guessed.

/** The text, and the encoding guessed when the file did not say. */
export interface Decoded {
  readonly text: string;
  readonly guessed: string | null;
}

export function decodeText(bytes: Uint8Array, language: string): Decoded {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: decode("utf-16le", bytes), guessed: null };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: decode("utf-16be", bytes), guessed: null };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), guessed: null };
  } catch {
    // Not UTF-8: read below.
  }
  // vCalendar 1.0 and some CSVs name theirs (`CHARSET=windows-1251`).
  const named = /CHARSET=["']?([\w-]+)/i.exec(decode("latin1", bytes.subarray(0, 64 * 1024)))?.[1];
  if (named) {
    try {
      return { text: decode(named, bytes), guessed: null };
    } catch {
      // A charset this browser does not know: guessed below.
    }
  }
  // Windows' own code page in the user's language: what Outlook and older
  // phones write.
  const guessed = language.startsWith("ru") ? "windows-1251" : "windows-1252";
  return { text: decode(guessed, bytes), guessed };
}

function decode(label: string, bytes: Uint8Array): string {
  return new TextDecoder(label).decode(bytes);
}
