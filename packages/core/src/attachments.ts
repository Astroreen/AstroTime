// Attachments (`ATTACH`, RFC 5545 §3.8.1.1; docs/plans/foundation.md#D229):
// a link, or a file inline in the object as base64. Each is read with the
// name, type and size its client wrote, and kept as written, every
// parameter with it, until the user removes it (foundation D7); one added
// is written as given, a provider's own parameters too (Nextcloud's
// `X-NC-FILE-ID`); `inline-file.ts` decodes an inline one.
import ICAL from "ical.js";

/** An item's `ATTACH`. */
export interface Attachment {
  /**
   * The link: absolute, or relative to the account's server, as Nextcloud
   * Calendar writes its own files' (`/index.php/f/123`); null for a file
   * inline in the object.
   */
  readonly uri: string | null;
  /**
   * The file's name: `FILENAME` (Nextcloud's is a path in the user's files,
   * of which this is the last part), or a client's own parameter for it;
   * null when none was written.
   */
  readonly name: string | null;
  /** `FMTTYPE`: its media type. */
  readonly type: string | null;
  /** Its size in bytes: `SIZE` (RFC 8607), or an inline file's own; null when not known. */
  readonly size: number | null;
}

/** The parameters clients write a file's name in, the standard's first. */
const NAMES = ["filename", "x-filename", "x-apple-filename", "x-oracle-filename"];

/** The last part of a path, Unix's or Windows', or the text itself. */
const lastPart = (path: string) => path.split(/[\\/]/).findLast((part) => part.length > 0) ?? null;

/** The bytes base64 text holds, not decoding it (an inline file is not loaded to be listed). */
function base64Size(text: string): number {
  const clean = text.replaceAll(/\s/g, "");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** Whether an `ATTACH` holds its file (`VALUE=BINARY`) rather than a link. */
export const isInline = (property: ICAL.Property) =>
  property.type === "binary" ||
  String(property.getParameter("value") ?? "").toUpperCase() === "BINARY" ||
  String(property.getParameter("encoding") ?? "").toUpperCase() === "BASE64";

/** The value's text: ical.js gives an inline file as its `Binary`. */
export const textOf = (property: ICAL.Property) => {
  const value: unknown = property.getFirstValue();
  if (value instanceof ICAL.Binary) return value.value;
  return typeof value === "string" ? value : String(value ?? "");
};

export function attachment(property: ICAL.Property): Attachment {
  const parameter = (name: string) => {
    const value: unknown = property.getParameter(name);
    const text = Array.isArray(value) ? value.join(",") : value;
    return typeof text === "string" && text.trim() !== "" ? text.trim() : null;
  };
  const inline = isInline(property);
  const named = NAMES.map(parameter).find((name) => name !== null);
  const size = Number(parameter("size"));
  return {
    uri: inline ? null : textOf(property).trim() || null,
    name: named ? lastPart(named) : null,
    type: parameter("fmttype"),
    size:
      Number.isSafeInteger(size) && size >= 0 && parameter("size") !== null
        ? size
        : inline
          ? base64Size(textOf(property))
          : null,
  };
}

/** A component's attachments, in their order. */
export const attachmentsOf = (component: ICAL.Component): Attachment[] =>
  component.getAllProperties("attach").map(attachment);

/** An attachment to add: a link, with what is known of its file. */
export interface NewAttachment {
  readonly uri: string;
  /** Written as `FILENAME`: Nextcloud's is the file's path in the user's files. */
  readonly name?: string | null;
  /** Written as `FMTTYPE`. */
  readonly type?: string | null;
  /** Written as `SIZE` (RFC 8607). */
  readonly size?: number | null;
  /** A provider's own parameters, written as given: Nextcloud's `X-NC-FILE-ID`, `X-NC-HAS-PREVIEW`. */
  readonly parameters?: Readonly<Record<string, string>>;
}

/** Removes the attachments at `remove` (their indexes before) and adds `add` after the rest. */
export function setAttachments(
  component: ICAL.Component,
  changes: { readonly remove: readonly number[]; readonly add: readonly NewAttachment[] },
): void {
  const existing = component.getAllProperties("attach");
  for (const index of changes.remove) {
    const property = existing[index];
    if (property) component.removeProperty(property);
  }
  for (const add of changes.add) {
    const property = new ICAL.Property("attach");
    property.setValue(add.uri);
    if (add.type) property.setParameter("fmttype", add.type);
    if (add.name) property.setParameter("filename", add.name);
    if (add.size !== undefined && add.size !== null)
      property.setParameter("size", String(add.size));
    for (const [name, value] of Object.entries(add.parameters ?? {}))
      property.setParameter(name.toLowerCase(), value);
    component.addProperty(property);
  }
}
