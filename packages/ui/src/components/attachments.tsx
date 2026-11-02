// An item's attachments in its details (design D230; foundation D229): each
// with its name, kind and size where its client wrote them. A link opens
// where links open, a new tab or the system's browser; a file inline in the
// object is listed without being decoded, and saved only when asked, where
// the platform saves files (`Platform.saveFile`, Android's), else as the
// browser downloads them (the web's and the desktop's). Loaded with the
// details.
import { inlineFile, type InlineFile } from "@astrotime/core";
import type { Calendar } from "@astrotime/storage";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { attachmentHref, attachmentText } from "../calendar/attachments.ts";
import type { Target } from "../calendar/editing.ts";
import type { Platform } from "../platform.ts";
import { useAccounts } from "./accounts-context.tsx";

/**
 * Saves an inline file, decoded now (D230): through the platform where it
 * saves files, else by a download link of its bytes, attached to the page
 * for its click; its URL is kept in `links` and let go when the list goes,
 * so a download that starts late still finds it.
 */
async function save(
  file: InlineFile,
  name: string,
  platform: Platform,
  links: string[],
): Promise<void> {
  const type = file.type ?? "application/octet-stream";
  if (platform.saveFile) {
    await platform.saveFile({ name, type, bytes: file.bytes });
    return;
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([file.bytes.slice()], { type }));
  link.download = name;
  link.hidden = true;
  links.push(link.href);
  document.body.append(link);
  link.click();
  link.remove();
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
  const { platform } = useAccounts();
  // A file that could not be saved, said under the list (Android's write failed).
  const [failed, setFailed] = useState<string | null>(null);
  // The download links made while the list is shown, let go with it.
  const links = useRef<string[]>([]);
  useEffect(() => {
    const made = links.current;
    return () => made.forEach((link) => URL.revokeObjectURL(link));
  }, []);
  return (
    <>
      <ul className="-mx-2 -my-1.5 flex flex-col">
        {target.item.attachments.map((attachment, index) => {
          const href = attachment.uri ? attachmentHref(attachment.uri, calendar?.url) : null;
          const { name, about } = attachmentText(attachment, href, t, i18n.language);
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
                  onClick={() => {
                    const file = inlineFile(target.object, target.recurrenceId, index);
                    if (!file) return;
                    setFailed(null);
                    save(file, file.name ?? name, platform, links.current).catch((error) => {
                      console.error(error);
                      setFailed(file.name ?? name);
                    });
                  }}
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
      {/* Said at once, with the list it is about (design D230). */}
      <p role="alert" className="text-note text-danger empty:hidden">
        {failed ? t("attachments.saveFailed", { name: failed }) : ""}
      </p>
    </>
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
