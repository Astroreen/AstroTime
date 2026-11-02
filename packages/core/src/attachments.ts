// Attachments (`ATTACH`, RFC 5545 §3.8.1.1; docs/plans/foundation.md#D229):
// a link, or a file inline in the object as base64. Each is read with the
// name, type and size its client wrote, and kept as written, every
// parameter with it, until the user removes it (foundation D7); one added
// is written as given, a provider's own parameters too (Nextcloud's
// `X-NC-FILE-ID`); `inline-file.ts` decodes an inline one.
import ICAL from "ical.js";

import type { CalendarObject } from "./calendar-object.ts";
import { fromIcalTime, type ItemTime } from "./time.ts";

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
  /** Its size in bytes: an inline file's own, else `SIZE` (RFC 8607); null when not known. */
  readonly size: number | null;
  /** Whether it holds its file, inline; a link that is empty is neither (`uri` null too). */
  readonly inline: boolean;
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
    // An inline file's own size, whatever its `SIZE` says: the bytes are there to count.
    size: inline
      ? base64Size(textOf(property))
      : Number.isSafeInteger(size) && size >= 0 && parameter("size") !== null
        ? size
        : null,
    inline,
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

/** Control characters, a line break among them: no parameter or value may hold one (RFC 5545 §3.1). */
const CONTROL = /\p{Cc}+/gu;
/** A media type, as `FMTTYPE` takes one (RFC 4288's names). */
const MEDIA_TYPE = /^[a-z0-9][\w!#$&^.+-]*\/[a-z0-9][\w!#$&^.+-]*$/i;
/** A parameter's name: an iana-token or an x-name (RFC 5545 §3.1). */
const PARAMETER = /^[a-z0-9-]+$/i;
/** The parameters this module writes itself, and those that would change what the value is. */
const OWN = new Set(["filename", "fmttype", "size", "value", "encoding"]);

/** Text for a parameter: no control character; a quote, `;`, `:` and `,` ical.js quotes (RFC 6868). */
const clean = (text: string) => text.replaceAll(CONTROL, " ").trim();

/**
 * Removes the attachments at `remove` (their indexes before) and adds `add`
 * after the rest. What is added is checked first, nothing written when it
 * fails: a link with a control character or space, or a provider's
 * parameter whose name is no token or one written here, is refused
 * (`RangeError`); a name's or a value's control characters become spaces,
 * and a type that is no media type is left out.
 */
export function setAttachments(
  component: ICAL.Component,
  changes: { readonly remove: readonly number[]; readonly add: readonly NewAttachment[] },
): void {
  for (const add of changes.add) {
    if (!add.uri || /[\s\p{Cc}]/u.test(add.uri))
      throw new RangeError(`Not a link to attach: ${JSON.stringify(add.uri)}`);
    for (const name of Object.keys(add.parameters ?? {})) {
      if (!PARAMETER.test(name) || OWN.has(name.toLowerCase()))
        throw new RangeError(`Not a parameter to write: ${JSON.stringify(name)}`);
    }
  }
  const existing = component.getAllProperties("attach");
  for (const index of changes.remove) {
    const property = existing[index];
    if (property) component.removeProperty(property);
  }
  for (const add of changes.add) {
    const property = new ICAL.Property("attach");
    property.setValue(add.uri);
    const type = add.type && clean(add.type);
    if (type && MEDIA_TYPE.test(type)) property.setParameter("fmttype", type);
    const name = add.name && clean(add.name);
    if (name) property.setParameter("filename", name);
    if (
      add.size !== undefined &&
      add.size !== null &&
      Number.isSafeInteger(add.size) &&
      add.size >= 0
    )
      property.setParameter("size", String(add.size));
    for (const [key, value] of Object.entries(add.parameters ?? {}))
      property.setParameter(key.toLowerCase(), clean(value));
    component.addProperty(property);
  }
}

/** The component of the item at `recurrenceId`: its exception, else the series'. */
export function componentAt(
  object: CalendarObject,
  recurrenceId: ItemTime | null,
): ICAL.Component | undefined {
  const { master, exceptions } = object.components;
  const id = recurrenceId && JSON.stringify(recurrenceId);
  const exception =
    id &&
    exceptions.find((component) => {
      const value = component.getFirstPropertyValue("recurrence-id");
      return value instanceof ICAL.Time && JSON.stringify(fromIcalTime(value)) === id;
    });
  return exception || master || exceptions[0];
}

/**
 * The item's `ATTACH`es as written, every parameter and an inline file's
 * bytes: what tells two that read alike apart (an edit's removal found
 * again in the item as stored now, design D233).
 */
export const attachLines = (object: CalendarObject, recurrenceId: ItemTime | null): string[] =>
  (componentAt(object, recurrenceId)?.getAllProperties("attach") ?? []).map((property) =>
    property.toICALString(),
  );
