// The edit dialog's attachments (design D233): each with its name, kind and
// size and a button that takes it off, then "Add a link" and, for an account
// whose server keeps files (Nextcloud's), "From your files" (design D234).
// The others stay as written (foundation D229). Loaded with the edit dialog;
// the file picker with its first opening.
import type { Attachment, NewAttachment } from "@astrotime/core";
import type { Account, Calendar } from "@astrotime/storage";
import { hasFiles } from "@astrotime/sync";
import { useEffect, useId, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import type { AttachmentChoice } from "../calendar/editing.ts";
import { attachmentHref, attachmentText, typedLink } from "../calendar/attachments.ts";
import { AttachmentBody } from "./attachments.tsx";
import { useAccounts } from "./accounts-context.tsx";
import { CloseIcon } from "./icons.tsx";
import { deferred } from "./lazy.tsx";
import { textButton } from "./sign-in-dialog.tsx";

/** A new attachment as a row shows it: its `FILENAME`'s last part. */
const shown = (attachment: NewAttachment): Attachment => ({
  uri: attachment.uri,
  name: attachment.name?.split("/").findLast((part) => part.length > 0) ?? null,
  type: attachment.type ?? null,
  size: attachment.size ?? null,
  inline: false,
});

const FilePicker = deferred(
  () => import("./file-picker.tsx"),
  (module) => module.FilePicker,
  (props: ComponentProps<typeof import("./file-picker.tsx").FilePicker>) => props.open,
);

/**
 * The account a calendar is in, where it may have files (foundation D231):
 * one that syncs with a server that keeps them. Asking makes no request.
 */
function useFilesAccount(calendar: Calendar | undefined): Account | null {
  const { store } = useAccounts();
  const [found, setFound] = useState<Account | null>(null);
  const accountId = calendar?.accountId;
  useEffect(() => {
    if (!accountId) return;
    let current = true;
    store.accounts().then(
      (accounts) => {
        const account = accounts.find((a) => a.id === accountId);
        if (current) setFound(account && hasFiles(account) ? account : null);
      },
      (error: unknown) => console.error(error),
    );
    return () => {
      current = false;
    };
  }, [accountId, store]);
  return found?.id === accountId ? found : null;
}

export function AttachmentsField({
  value,
  calendar,
  onChange,
  field,
}: {
  value: readonly AttachmentChoice[];
  calendar: Calendar | undefined;
  onChange: (attachments: readonly AttachmentChoice[]) => void;
  /** The form's text field's looks. */
  field: string;
}) {
  const { t, i18n } = useTranslation();
  const account = useFilesAccount(calendar);
  const [browsing, setBrowsing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  const inputId = useId();
  const typed = typedLink(link);
  const add = () => {
    if (!typed) return;
    onChange([...value, { kind: "new", attachment: { uri: typed } }]);
    setLink("");
    setAdding(false);
  };
  return (
    <div className="flex flex-col gap-1">
      {value.length > 0 && (
        <ul aria-label={t("attachments.title")} className="flex flex-col">
          {value.map((choice, index) => {
            const attachment =
              choice.kind === "existing" ? choice.attachment : shown(choice.attachment);
            const href = attachment.uri ? attachmentHref(attachment.uri, calendar?.url) : null;
            const { name, about } = attachmentText(attachment, href, t, i18n.language);
            return (
              <li key={choice.kind === "existing" ? `e${choice.index}` : `n${index}`}>
                <div className="flex min-w-0 items-center gap-3 py-1">
                  <AttachmentBody attachment={attachment} name={name} about={about} />
                  <button
                    type="button"
                    className="grid size-10 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent"
                    aria-label={t("attachments.remove", { name })}
                    onClick={() => onChange(value.filter((_, i) => i !== index))}
                  >
                    <CloseIcon className="size-5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            {t("attachments.link")}
          </label>
          <input
            id={inputId}
            type="url"
            inputMode="url"
            autoFocus
            placeholder="https://"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds the link here, not the dialog's save; Escape leaves it.
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setAdding(false);
              }
            }}
            className={field}
          />
          <button type="button" className={textButton} disabled={!typed} onClick={add}>
            {t("attachments.add")}
          </button>
        </div>
      ) : (
        <div className="-ml-4 flex flex-wrap">
          <button type="button" className={textButton} onClick={() => setAdding(true)}>
            {t("attachments.addLink")}
          </button>
          {account && (
            <button type="button" className={textButton} onClick={() => setBrowsing(true)}>
              {t("attachments.fromFiles")}
            </button>
          )}
        </div>
      )}
      {account && (
        <FilePicker
          open={browsing}
          account={account}
          onClose={() => setBrowsing(false)}
          onPick={(attachment) => {
            setBrowsing(false);
            // A file attached already is not attached twice.
            const there = value.some((choice) => choice.attachment.uri === attachment.uri);
            if (!there) onChange([...value, { kind: "new", attachment }]);
          }}
        />
      )}
    </div>
  );
}
