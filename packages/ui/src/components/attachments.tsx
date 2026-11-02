// An item's attachments in its details (design D230; foundation D229): each
// with its name, kind and size where its client wrote them. A link opens
// where links open, a new tab or the system's browser; a file inline in the
// object is listed without being decoded, and saved only when asked. Loaded
// with the details.
import { inlineFile, type Attachment } from "@astrotime/core";
import type { Calendar } from "@astrotime/storage";
import { useTranslation } from "react-i18next";

import type { Target } from "../calendar/editing.ts";

/**
 * Where a link goes: absolute, or relative to the calendar's server, as
 * Nextcloud Calendar writes its users' files (`/index.php/f/123`); only web
 * links open, never `javascript:` or `data:`.
 */
function attachmentHref(uri: string, base: string | undefined): string | null {
  try {
    const url = new URL(uri, base);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** A file's kind in a word: its name's extension, else its type's subtype ("PDF", "PNG"). */
function kindOf(attachment: Attachment): string | null {
  const extension = /\.([a-z0-9]{1,5})$/i.exec(attachment.name ?? "")?.[1];
  if (extension) return extension.toUpperCase();
  const subtype = attachment.type?.split("/")[1]?.split(/[+;.]/)[0];
  return subtype && subtype.length <= 5 ? subtype.toUpperCase() : null;
}

/** Bytes from a kilobyte up as the language writes them: 47 kB, 3.2 MB (less: `attachments.bytes`). */
function sizeText(bytes: number, locale: string): string {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
  }).format(value);
}

/** A link with no name, as a reader recognises it: its host and path. */
const shortLink = (href: string) => {
  const url = new URL(href);
  return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
};

/** Saves an inline file through a link of its bytes, decoded now (D230). */
function save(target: Target, index: number, fallback: string): void {
  const file = inlineFile(target.object, target.recurrenceId, index);
  if (!file) return;
  const blob = new Blob([file.bytes.slice()], { type: file.type ?? "application/octet-stream" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = file.name ?? fallback;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

const row =
  "flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left -outline-offset-2 hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent";

export function AttachmentList({
  target,
  calendar,
}: {
  target: Target;
  calendar: Calendar | undefined;
}) {
  const { t, i18n } = useTranslation();
  return (
    <ul className="-mx-2 -my-1.5 flex flex-col">
      {target.item.attachments.map((attachment, index) => {
        const href = attachment.uri ? attachmentHref(attachment.uri, calendar?.url) : null;
        const name =
          attachment.name ?? (href ? shortLink(href) : (attachment.uri ?? t("attachments.file")));
        const about = [
          kindOf(attachment),
          attachment.size === null
            ? null
            : attachment.size < 1000
              ? t("attachments.bytes", { count: attachment.size })
              : sizeText(attachment.size, i18n.language),
        ]
          .filter(Boolean)
          .join(" · ");
        const content = (
          <>
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-canvas text-ink-muted"
            >
              {attachment.uri && !attachment.name ? <LinkMark /> : <FileMark />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{name}</span>
              {about && <span className="block truncate text-note text-ink-muted">{about}</span>}
            </span>
          </>
        );
        return (
          <li key={index}>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer" className={row}>
                {content}
              </a>
            ) : attachment.uri === null ? (
              <button
                type="button"
                className={row}
                aria-label={t("attachments.save", { name })}
                onClick={() => save(target, index, name)}
              >
                {content}
              </button>
            ) : (
              // A link of another kind (not the web's) is shown, never followed.
              <div className="flex min-w-0 items-center gap-3 px-2 py-1.5">{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const mark = {
  viewBox: "0 0 24 24",
  width: 20,
  height: 20,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  focusable: "false",
} as const;

/** A sheet with its corner folded: a file (AstroTime's own drawing, design D43). */
const FileMark = () => (
  <svg {...mark}>
    <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
    <path d="M14 3.5V8h4.5" />
  </svg>
);

/** Two links of a chain: a link. */
const LinkMark = () => (
  <svg {...mark}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);

/** A paperclip: the details' row of attachments. */
export const AttachmentsIcon = ({ className }: { className?: string }) => (
  <svg {...mark} className={className} aria-hidden="true">
    <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7-7l8.3-8.4a3.4 3.4 0 0 1 4.8 4.8l-8.2 8.3a1.7 1.7 0 0 1-2.4-2.4l7.4-7.4" />
  </svg>
);
