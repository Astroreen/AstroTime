// An account's files where its server keeps them beside its calendars
// (docs/plans/foundation.md#D231): Nextcloud's WebDAV files, at
// `/remote.php/dav/files/<user>/` beside the calendars' home at
// `/remote.php/dav/calendars/<user>/`. A folder is listed with one
// `PROPFIND`; a file becomes the `ATTACH` Nextcloud Calendar writes for it
// (its `src/store/calendarObjectInstance.js`, `addAttachmentWithProperty`):
// a link to the file by its id, `/index.php/f/<id>`, here absolute so other
// clients open it too; `FILENAME`, its path; `FMTTYPE`; `X-NC-FILE-ID`;
// `X-NC-HAS-PREVIEW`; and `X-NC-SHARED-TYPES` when it is shared. A module
// of its own (`@astrotime/caldav/files`): the UI loads it, through
// `@astrotime/sync/files`, with the file picker.
import type { FileStore, NewAttachment, RemoteFile } from "@astrotime/core";

import type { HttpClient, HttpRequest } from "./http.ts";
import { basic, NEXTCLOUD_HOME, send, type Credentials } from "./provider.ts";
import { children, parseMultistatus, text, type DavResponse } from "./xml.ts";

const PROPS = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns"><d:prop><d:resourcetype/><d:getcontenttype/><d:getcontentlength/><oc:size/><oc:fileid/><oc:share-types/><nc:has-preview/></d:prop></d:propfind>`;

/** An account's files from its calendar home, where its server keeps them: Nextcloud's; none elsewhere. */
export function filesOf(
  http: HttpClient,
  credentials: Credentials,
  homeUrl: string,
): FileStore | null {
  const authorization = basic(credentials);
  const match = NEXTCLOUD_HOME.exec(homeUrl);
  if (!match) return null;
  const [, root = "", user = ""] = match;
  const files = `${root}/remote.php/dav/files/${user}`;
  /** A path's URL in the user's files, each part encoded. */
  const urlOf = (path: string) =>
    `${files}${path === "/" ? "" : path.split("/").map(encodeURIComponent).join("/")}`;
  const request = (
    method: string,
    url: string,
    accept: number[],
    extra: Partial<HttpRequest> = {},
  ) => send(http, authorization, { method, url, headers: {}, ...extra }, accept);
  const list = async (path: string, depth: "0" | "1") => {
    const folder = `/${path.split("/").filter(Boolean).join("/")}`;
    const response = await request("PROPFIND", `${urlOf(folder)}${depth === "1" ? "/" : ""}`, [], {
      headers: { Depth: depth, "Content-Type": "application/xml; charset=utf-8" },
      body: PROPS,
    });
    const base = new URL(response.url);
    const own = new URL(`${files}/`, base).pathname;
    return parseMultistatus(response.body)
      .responses.map((entry) => fileOf(entry, base, own, root))
      .filter(
        (file): file is RemoteFile => file !== null && (depth === "0" || file.path !== folder),
      );
  };
  return {
    async list(path) {
      return (await list(path, "1")).toSorted((a, b) =>
        a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder ? -1 : 1,
      );
    },
    async upload(name, type, bytes) {
      // Where Nextcloud Calendar keeps what is uploaded for an item, made if it is not there (405: it is).
      await request("MKCOL", urlOf(ATTACHMENTS), [405]);
      // A name taken is never written over: "Q3.pdf", then "Q3 (2).pdf"…
      const safe = safeName(name);
      const dot = safe.lastIndexOf(".");
      const [stem, extension] = dot > 0 ? [safe.slice(0, dot), safe.slice(dot)] : [safe, ""];
      for (let n = 1; n <= 20; n++) {
        const path = `${ATTACHMENTS}/${n === 1 ? safe : `${stem} (${n})${extension}`}`;
        const put = await request("PUT", urlOf(path), [412], {
          headers: { "Content-Type": type || "application/octet-stream", "If-None-Match": "*" },
          body: bytes,
        });
        if (put.status === 412) continue;
        const [file] = await list(path, "0");
        if (!file) throw new Error(`${path} was uploaded but is not listed.`);
        return file;
      }
      throw new Error(`No free name for ${safe} in ${ATTACHMENTS}.`);
    },
  };
}

/** The longest name uploaded, in UTF-8 bytes: Nextcloud takes 255, and " (20)" may follow. */
const MAX_NAME_BYTES = 200;

/**
 * A name Nextcloud takes, which stays in its folder: the characters its
 * clients refuse (backslash, slash, colon, star, question mark, quote,
 * angle brackets, bar) and control characters made `_`, spaces and dots
 * trimmed from its ends (no `.` or `..`, no hidden `.htaccess`), its
 * refused endings `.part` and `.filepart` made `_part`, `_filepart`, at
 * most 200 bytes with its extension kept, "file" when nothing is left
 * (foundation D232).
 */
export function safeName(name: string): string {
  // Its ends made safe: again after a cut, which may leave a dot, a space or ".part" last.
  const ends = (part: string) =>
    part
      .replace(/^[\s.]+/, "")
      .replace(/[\s.]+$/, "")
      .replace(/\.(file)?part$/i, (ending) => `_${ending.slice(1)}`);
  const cleaned = ends(name.replaceAll(/[\\/:*?"<>|\p{Cc}]/gu, "_")) || "file";
  const bytes = (value: string) => new TextEncoder().encode(value).length;
  if (bytes(cleaned) <= MAX_NAME_BYTES) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  // An extension is kept only when it is short, as a file's is.
  const extension = dot > 0 && cleaned.length - dot <= 16 ? cleaned.slice(dot) : "";
  // By code points, so no character is cut in half.
  const stem = Array.from(cleaned.slice(0, cleaned.length - extension.length));
  while (stem.length > 1 && bytes(stem.join("") + extension) > MAX_NAME_BYTES) stem.pop();
  return ends(stem.join("") + extension) || "file";
}

/** Nextcloud Calendar's attachments folder, where it uploads a file from the device (its `attachmentsFolder` setting's default). */
const ATTACHMENTS = "/Calendar";

/** One entry of a folder's listing, its path in the user's files; none outside them. */
function fileOf(entry: DavResponse, base: URL, own: string, root: string): RemoteFile | null {
  const pathname = new URL(entry.href, base).pathname;
  if (!pathname.startsWith(own)) return null;
  const path = `/${pathname
    .slice(own.length)
    .split("/")
    .map(decoded)
    .join("/")
    .replace(/\/$/, "")}`;
  const folder = children(entry.props["resourcetype"]).includes("collection");
  const type = folder ? null : text(entry.props["getcontenttype"]);
  const sizeText = text(entry.props["getcontentlength"]) ?? text(entry.props["size"]);
  const size = sizeText !== null && /^\d+$/.test(sizeText) ? Number(sizeText) : null;
  const id = text(entry.props["fileid"]);
  const shared = shareTypes(entry.props["share-types"]);
  const attachment: NewAttachment | null =
    folder || !id
      ? null
      : {
          uri: `${new URL(root, base).href.replace(/\/$/, "")}/index.php/f/${id}`,
          name: path,
          type,
          ...(size === null ? {} : { size }),
          parameters: {
            "X-NC-FILE-ID": id,
            "X-NC-HAS-PREVIEW": text(entry.props["has-preview"]) === "true" ? "true" : "false",
            ...(shared ? { "X-NC-SHARED-TYPES": shared } : {}),
          },
        };
  return {
    path,
    name: path.split("/").findLast(Boolean) ?? "/",
    folder,
    type,
    size: folder ? null : size,
    attachment,
  };
}

/** A path's part decoded; as it came when it is no percent-encoding (a stray `%`). */
function decoded(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** `<oc:share-types><oc:share-type>3</oc:share-type>…`: the types, comma-separated, as Nextcloud Calendar writes them. */
function shareTypes(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const types = (value as Record<string, unknown>)["share-type"];
  const list = (Array.isArray(types) ? types : [types]).map(text).filter(Boolean);
  return list.length > 0 ? list.join(",") : null;
}
