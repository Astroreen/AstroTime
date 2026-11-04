// The account's files, to attach one (design D234; foundation D231): a
// folder at a time, its folders first, then its files with their kind and
// size; a folder opens, the arrow goes up, a file is picked. The whole
// screen on a phone, a dialog on a wide screen, over the edit dialog. Its
// code, the files' with it (`@astrotime/sync/files`), loads when it is first
// opened (foundation D145).
import type { FileStore, NewAttachment, RemoteFile } from "@astrotime/core";
import type { Account } from "@astrotime/storage";
import { accountFiles } from "@astrotime/sync/files";
import { Dialog } from "@base-ui/react/dialog";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { attachmentText } from "../calendar/attachments.ts";
import { useAccounts } from "./accounts-context.tsx";
import { AttachmentBody } from "./attachments.tsx";
import { DialogBackdrop, DialogPopup, dialogIcon, sheet } from "./dialog-parts.tsx";
import { BackIcon, CloseIcon } from "./icons.tsx";
import { textButton } from "./buttons.ts";

type Listing =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "listed"; readonly files: readonly RemoteFile[] };

const row =
  "flex w-full min-w-0 items-center gap-3 rounded-xl px-2 py-1.5 text-left -outline-offset-2 hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent";

/** The picker over an account's files, opened with its saved credentials. */
export function FilePicker({
  account,
  ...props
}: Omit<Parameters<typeof FileBrowser>[0], "files"> & { account: Account }) {
  const { platform } = useAccounts();
  const files = useCallback(
    () => accountFiles({ http: platform.http, secrets: platform.secrets }, account),
    [account, platform],
  );
  return <FileBrowser {...props} files={files} />;
}

/** The picker over files given: a folder at a time. */
export function FileBrowser({
  open,
  files,
  onPick,
  onClose,
}: {
  open: boolean;
  /** Opens the files, again at each try; none when they cannot be. */
  files: () => Promise<FileStore | null>;
  onPick: (attachment: NewAttachment) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [path, setPath] = useState("/");
  const [listing, setListing] = useState<Listing>({ state: "loading" });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setListing({ state: "loading" });
    // Each listing, "Try again"'s too, opens the files anew and asks the server again.
    files()
      .then((opened) => {
        if (!opened) throw new Error("These files cannot be opened.");
        return opened.list(path);
      })
      .then(
        (list) => current && setListing({ state: "listed", files: list }),
        (error: unknown) => {
          console.error(error);
          if (current) setListing({ state: "failed" });
        },
      );
    return () => {
      current = false;
    };
  }, [open, files, path, tries]);
  const up = path === "/" ? null : `/${path.split("/").filter(Boolean).slice(0, -1).join("/")}`;
  const where = path === "/" ? t("files.top") : path.split("/").findLast(Boolean)!;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <DialogBackdrop className="fixed inset-0 z-[140] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPopup
          className={`${sheet} z-[150] sm:h-[min(36rem,calc(100dvh-2rem-var(--inset-top)-var(--inset-bottom)))] sm:w-[min(28rem,calc(100vw-2rem))]`}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-2">
            <Dialog.Close className={dialogIcon} aria-label={t("lazy.close")}>
              <CloseIcon className="size-5" />
            </Dialog.Close>
            <Dialog.Title className="min-w-0 flex-1 truncate text-title font-medium">
              {t("files.title")}
            </Dialog.Title>
          </div>
          <div className="flex h-12 shrink-0 items-center gap-1 px-2">
            {up !== null && (
              <button
                type="button"
                className={dialogIcon}
                aria-label={t("files.up")}
                onClick={() => setPath(up)}
              >
                <BackIcon className="size-5" />
              </button>
            )}
            <h3 className="min-w-0 truncate px-2 text-body font-medium" aria-live="polite">
              {where}
            </h3>
          </div>
          <div
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-4"
            aria-busy={listing.state === "loading"}
          >
            {listing.state === "failed" ? (
              <div role="alert" className="flex flex-col items-start gap-2 px-2 py-4 text-body">
                <p>{t("files.failed")}</p>
                <button
                  type="button"
                  className={`${textButton} -ml-4`}
                  onClick={() => setTries(tries + 1)}
                >
                  {t("lazy.retry")}
                </button>
              </div>
            ) : listing.state === "loading" ? (
              <p className="px-2 py-4 text-body text-ink-muted">{t("files.loading")}</p>
            ) : listing.files.length === 0 ? (
              <p className="px-2 py-4 text-body text-ink-muted">{t("files.empty")}</p>
            ) : (
              <ul aria-label={where} className="flex flex-col">
                {listing.files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={row}
                      onClick={() => {
                        if (file.folder) setPath(file.path);
                        else if (file.attachment) onPick(file.attachment);
                      }}
                    >
                      {file.folder ? (
                        <>
                          <span
                            aria-hidden="true"
                            className="grid size-9 shrink-0 place-items-center rounded-lg bg-canvas text-ink-muted"
                          >
                            <FolderMark />
                          </span>
                          <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        </>
                      ) : (
                        <FileRow file={file} t={t} language={i18n.language} />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FileRow({
  file,
  t,
  language,
}: {
  file: RemoteFile;
  t: ReturnType<typeof useTranslation>["t"];
  language: string;
}) {
  const attachment = {
    uri: null,
    name: file.name,
    type: file.type,
    size: file.size,
    inline: false,
  };
  const { name, about } = attachmentText(attachment, null, t, language);
  return <AttachmentBody attachment={attachment} name={name} about={about} />;
}

/** A folder (AstroTime's own drawing, design D43). */
const FolderMark = () => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    focusable="false"
  >
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </svg>
);
