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

import type { HttpClient } from "./http.ts";
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
  return {
    async list(path) {
      const folder = `/${path.split("/").filter(Boolean).join("/")}`;
      const url = `${files}${folder === "/" ? "" : folder.split("/").map(encodeURIComponent).join("/")}/`;
      const response = await send(
        http,
        authorization,
        {
          method: "PROPFIND",
          url,
          headers: { Depth: "1", "Content-Type": "application/xml; charset=utf-8" },
          body: PROPS,
        },
        [],
      );
      const base = new URL(response.url);
      const own = new URL(`${files}/`, base).pathname;
      return parseMultistatus(response.body)
        .responses.map((entry) => fileOf(entry, base, own, root))
        .filter((file): file is RemoteFile => file !== null && file.path !== folder)
        .toSorted((a, b) =>
          a.folder === b.folder ? a.name.localeCompare(b.name) : a.folder ? -1 : 1,
        );
    },
  };
}

/** One entry of a folder's listing, its path in the user's files; none outside them. */
function fileOf(entry: DavResponse, base: URL, own: string, root: string): RemoteFile | null {
  const pathname = new URL(entry.href, base).pathname;
  if (!pathname.startsWith(own)) return null;
  const path = `/${decodeURIComponent(pathname.slice(own.length)).replace(/\/$/, "")}`;
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

/** `<oc:share-types><oc:share-type>3</oc:share-type>…`: the types, comma-separated, as Nextcloud Calendar writes them. */
function shareTypes(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const types = (value as Record<string, unknown>)["share-type"];
  const list = (Array.isArray(types) ? types : [types]).map(text).filter(Boolean);
  return list.length > 0 ? list.join(",") : null;
}
