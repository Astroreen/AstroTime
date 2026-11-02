// The edit dialog's attachments (design D233): each with its name, kind and
// size and a button that takes it off, then "Add a link" and, for an account
// whose server keeps files (Nextcloud's), "From your files" (design D234).
// The others stay as written (foundation D229). Loaded with the edit dialog,
// the file picker with it: a chunk of its own, loaded from the editor's,
// split the app's first chunks and cost the first load 0.3 KiB.
import type { Attachment, NewAttachment } from "@astrotime/core";
import type { Account, Calendar } from "@astrotime/storage";
import { hasFiles } from "@astrotime/sync";
import { accountFiles } from "@astrotime/sync/files";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AttachmentChoice } from "../calendar/editing.ts";
import {
  attachmentHref,
  attachmentText,
  bareName,
  typedLink,
  withAttached,
} from "../calendar/attachments.ts";
import { AttachmentBody } from "./attachments.tsx";
import { useAccounts } from "./accounts-context.tsx";
import { CloseIcon } from "./icons.tsx";
import { FilePicker } from "./file-picker.tsx";
import { textButton } from "./sign-in-dialog.tsx";

/** A new attachment as a row shows it: its `FILENAME`'s last part. */
const shown = (attachment: NewAttachment): Attachment => ({
  uri: attachment.uri,
  name: attachment.name?.split("/").findLast((part) => part.length > 0) ?? null,
  type: attachment.type ?? null,
  size: attachment.size ?? null,
  inline: false,
});

/** The largest file uploaded from the device: Android's bridge carries it in base64, in memory. */
const MAX_UPLOAD = 50_000_000;

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
  const { platform } = useAccounts();
  // A file from the device on its way to the account's files (design D232).
  const [uploading, setUploading] = useState<
    | { readonly state: "sending"; readonly name: string }
    | { readonly state: "failed"; readonly name: string; readonly tooBig: boolean }
    | null
  >(null);
  // Files uploaded while the item's calendar moved to another account: held,
  // each with its alert, attached if the item comes back to the account it
  // went to; none is dropped by the next upload (foundation D232).
  const [held, setHeld] = useState<
    readonly { readonly name: string; readonly from: string; readonly attachment: NewAttachment }[]
  >([]);
  const picker = useRef<HTMLInputElement>(null);
  // The form as it is now, read when an upload ends (it takes a while, and
  // what the user changed meanwhile stays); null once the dialog closed,
  // which an upload that ends after it leaves alone (foundation D232).
  const latest = useRef<{
    readonly value: readonly AttachmentChoice[];
    readonly onChange: (attachments: readonly AttachmentChoice[]) => void;
    readonly calendar: Calendar | undefined;
  } | null>(null);
  useEffect(() => {
    latest.current = { value, onChange, calendar };
  });
  useEffect(
    () => () => {
      latest.current = null;
    },
    [],
  );
  /** Attaches files to the form as it is now, all in one change (design D233). */
  const attach = (attachments: readonly NewAttachment[], base: string | undefined) => {
    const now = latest.current;
    if (!now) return;
    const next = withAttached(now.value, attachments, base);
    if (next !== now.value) now.onChange(next);
  };
  const upload = async (file: File) => {
    if (!account) return;
    if (file.size > MAX_UPLOAD) {
      setUploading({ state: "failed", name: file.name, tooBig: true });
      return;
    }
    setUploading({ state: "sending", name: file.name });
    const from = account.id;
    try {
      const files = await accountFiles({ http: platform.http, secrets: platform.secrets }, account);
      if (!files) throw new Error("This account's files cannot be opened.");
      const sent = await files.upload(
        file.name,
        file.type,
        new Uint8Array(await file.arrayBuffer()),
      );
      if (!sent.attachment) throw new Error("The file uploaded has no link.");
      const now = latest.current;
      if (!now) return;
      // The item moved to another account's calendar meanwhile: a link to
      // this account's file would not open there. Not attached, and said so.
      if (now.calendar?.accountId !== from) {
        const { attachment } = sent;
        setHeld((list) => [...list, { name: sent.name, from, attachment }]);
        setUploading(null);
        return;
      }
      attach([sent.attachment], now.calendar.url);
      setUploading(null);
    } catch (error) {
      console.error(error);
      if (latest.current) setUploading({ state: "failed", name: file.name, tooBig: false });
    }
  };
  // The item back in the account the file went to: attached after all, and
  // the alert gone. Another calendar of another account changes nothing.
  useEffect(() => {
    const back = held.filter((file) => file.from === calendar?.accountId);
    if (back.length === 0) return;
    attach(
      back.map((file) => file.attachment),
      calendar?.url,
    );
    setHeld((list) => list.filter((file) => !back.includes(file)));
  }, [held, calendar]);
  const [adding, setAdding] = useState(false);
  const [link, setLink] = useState("");
  // The user tried to add what they typed (Enter, or left the field): only
  // then does a bare name say what makes it a link (design D233).
  const [tried, setTried] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const typed = typedLink(link);
  const add = () => {
    if (!typed) {
      setTried(true);
      return;
    }
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
            onChange={(event) => {
              setLink(event.target.value);
              setTried(false);
            }}
            onBlur={() => setTried(true)}
            aria-describedby={hintId}
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
            {t("alarm.custom.add")}
          </button>
        </div>
      ) : (
        <div className="-ml-4 flex flex-wrap">
          <button type="button" className={textButton} onClick={() => setAdding(true)}>
            {t("attachments.addLink")}
          </button>
          {account && (
            <>
              <button type="button" className={textButton} onClick={() => setBrowsing(true)}>
                {t("attachments.fromFiles")}
              </button>
              <button
                type="button"
                className={textButton}
                disabled={uploading?.state === "sending"}
                onClick={() => picker.current?.click()}
              >
                {t("attachments.upload")}
              </button>
              {/* The system's file dialog, Android's picker in the WebView. */}
              <input
                ref={picker}
                type="file"
                hidden
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void upload(file);
                }}
              />
            </>
          )}
        </div>
      )}
      {/* Not a web link yet: what makes it one, said to the field it describes (design D233). */}
      <p id={hintId} aria-live="polite" className="text-note text-ink-muted empty:hidden">
        {adding && tried && bareName(link) ? t("attachments.notLink") : ""}
      </p>
      {held.map((file) => (
        <p key={file.attachment.uri} role="alert" className="text-note text-danger">
          {t("attachments.moved", { name: file.name })}
        </p>
      ))}
      {uploading && (
        <p
          role={uploading.state === "sending" ? "status" : "alert"}
          className={`text-note ${uploading.state === "sending" ? "text-ink-muted" : "text-danger"}`}
        >
          {uploading.state === "sending"
            ? t("attachments.uploading", { name: uploading.name })
            : uploading.tooBig
              ? t("attachments.tooBig", { name: uploading.name })
              : t("attachments.uploadFailed", { name: uploading.name })}
        </p>
      )}
      {account && (
        <FilePicker
          open={browsing}
          account={account}
          onClose={() => setBrowsing(false)}
          onPick={(attachment) => {
            setBrowsing(false);
            attach([attachment], calendar?.url);
          }}
        />
      )}
    </div>
  );
}
