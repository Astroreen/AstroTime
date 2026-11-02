// What the UI says of an attachment (design D230; foundation D229): where
// its link goes, its kind and size in words, its name.
import type { Attachment } from "@astrotime/core";
import type { TFunction } from "i18next";

/**
 * Where a link goes: absolute, or relative to the calendar's server, as
 * Nextcloud Calendar writes its users' files (`/index.php/f/123`); only web
 * links open, never `javascript:` or `data:`.
 */
export function attachmentHref(uri: string, base: string | undefined): string | null {
  try {
    const url = new URL(uri, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Whether two attachments' links go to one place: as they resolve against
 * the calendar's server, so Nextcloud Calendar's relative `/index.php/f/<id>`
 * and AstroTime's absolute one are the same file.
 */
export function sameLink(a: string | null, b: string | null, base: string | undefined): boolean {
  if (a === null || b === null) return false;
  return (attachmentHref(a, base) ?? a) === (attachmentHref(b, base) ?? b);
}

/** Formats known by their media type, named as their files' usual extension. */
const FORMATS: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "text/plain": "TXT",
  "text/markdown": "MD",
  "text/csv": "CSV",
  "text/html": "HTML",
  "text/calendar": "ICS",
  "application/json": "JSON",
  "application/zip": "ZIP",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "application/vnd.oasis.opendocument.text": "ODT",
  "application/vnd.oasis.opendocument.spreadsheet": "ODS",
  "application/vnd.oasis.opendocument.presentation": "ODP",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/gif": "GIF",
  "image/webp": "WEBP",
  "image/heic": "HEIC",
  "image/svg+xml": "SVG",
  "audio/mpeg": "MP3",
  "video/mp4": "MP4",
};

/**
 * A file's kind in a word: its name's extension ("DOCX"), else its known
 * type's ("PDF"), else what the type says it is ("Image"); none when
 * nothing says (a subtype such as `plain` or `vnd.…` is no word to a reader).
 */
export function kindOf(attachment: Attachment, t: TFunction): string | null {
  // An extension has a letter: "v1.2" or "3.5" names no kind.
  const extension = /\.([a-z0-9]{1,5})$/i.exec(attachment.name ?? "")?.[1];
  if (extension && /[a-z]/i.test(extension)) return extension.toUpperCase();
  const type = attachment.type?.toLowerCase().split(";")[0]?.trim() ?? "";
  if (FORMATS[type]) return FORMATS[type];
  const general = type.split("/")[0];
  return general === "image" || general === "audio" || general === "video" || general === "text"
    ? t(`attachments.kind.${general}`)
    : null;
}

/** Bytes as the language writes them: 22 B, 47 kB, 3.2 MB; a unit is promoted after rounding, so never "1000 kB". */
export function sizeText(bytes: number, locale: string, t: TFunction): string {
  if (bytes < 1000) return t("attachments.bytes", { count: bytes });
  const units = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
  let value = bytes / 1000;
  let unit = 0;
  const digits = (n: number) => (n < 10 ? 1 : 0);
  const rounded = (n: number) => Number(n.toFixed(digits(n)));
  while (rounded(value) >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: digits(value),
  }).format(value);
}

/** What a row says of an attachment: its name (or its link's host and path), then its kind and size. */
export function attachmentText(
  attachment: Attachment,
  href: string | null,
  t: TFunction,
  locale: string,
): { readonly name: string; readonly about: string } {
  const link = href ? new URL(href) : null;
  const name =
    attachment.name ??
    (link
      ? `${link.host}${link.pathname === "/" ? "" : link.pathname}`
      : (attachment.uri ?? t("attachments.file")));
  const about = [
    kindOf(attachment, t),
    attachment.size === null ? null : sizeText(attachment.size, locale, t),
  ]
    .filter(Boolean)
    .join(" · ");
  return { name, about };
}

/**
 * A web link typed: with `http://` or `https://`, else `https://` before it.
 * Its host has a dot (`example.org`, `192.168.1.10`), is `localhost`, or is
 * a name with its port (`nas:8080`); a number (`1234`), a time (`12:30`)
 * or a bare word is not one, nor another scheme (`javascript:`,
 * `mailto:`) or text with a space.
 */
export function typedLink(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  // A scheme is a name, a colon and no port's digit after it.
  const scheme = /^([a-z][a-z0-9+.-]*):(?!\d)/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return null;
  const host = /^(?:https?:\/\/)?([^/:?#]*)/i.exec(trimmed)?.[1] ?? "";
  // Digits and dots: an address only as four numbers (no "1.5" read as 1.0.0.5).
  if (/^[\d.]+$/.test(host) && !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null;
  try {
    const url = new URL(scheme ? trimmed : `https://${trimmed}`);
    const named =
      url.hostname.includes(".") ||
      url.hostname === "localhost" ||
      (url.port !== "" && /[a-z]/i.test(host));
    return named ? url.href : null;
  } catch {
    return null;
  }
}
