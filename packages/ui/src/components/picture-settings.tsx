// The user's own pictures in Settings (design D222, D223): their words, each
// with a picture an item whose title has it is drawn over, and their own
// banner for any month. Each word is made, changed or deleted in a dialog of
// its own, as own colours are (D173); the pictures are kept on this device
// (`pictures/own.ts`), the settings hold their ids. Loaded with Settings.
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { addPictureStrings } from "../i18n/pictures.ts";
import { MONTH_ART } from "../pictures/art.ts";
import { addPicture, NotAPictureError, removePicture, usePictureUrl } from "../pictures/own.ts";
import { useSettings, type OwnWord } from "../settings.ts";
import { useCalendar } from "./context.ts";
import { CloseIcon, PlusIcon } from "./icons.tsx";
import { primaryButton, textButton } from "./buttons.ts";
import { DialogBackdrop, DialogPopup, dialogIcon } from "./dialog-parts.tsx";

const row =
  "flex min-h-11 w-full items-center gap-3 px-4 text-left text-body hover:bg-raised-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent";

/** A picture's thumbnail, 3:2, its ground while it is read. */
function Thumb({ url }: { url: string | null }) {
  return (
    <span className="relative h-8 w-12 shrink-0 overflow-hidden rounded-md bg-pill">
      {url && <img src={url} alt="" className="size-full object-cover" />}
    </span>
  );
}

function OwnThumb({ id }: { id: string }) {
  return <Thumb url={usePictureUrl(id)} />;
}

/** A picture chosen from the device, kept as it is chosen; its id, or the error it gave. */
function PicturePicker({
  label,
  onPicked,
  onFailed,
  className,
  children,
}: {
  label: string;
  onPicked: (id: string) => void;
  onFailed: (error: unknown) => void;
  className: string;
  children: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={label}
        onClick={() => input.current?.click()}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) addPicture(file).then(onPicked, onFailed);
        }}
      />
    </>
  );
}

/** The own pictures' rows, in Settings' "Pictures" group. */
export function PictureSettings() {
  const { t, i18n } = useTranslation();
  addPictureStrings(i18n);
  const { settings, change } = useSettings();
  const [editing, setEditing] = useState<OwnWord | "new" | null>(null);
  const [banners, setBanners] = useState(false);
  const wordsId = useId();
  return (
    <>
      <h3 id={wordsId} className="px-4 pt-3 pb-1 text-note text-ink-muted">
        {t("ownPictures.words")}
      </h3>
      <ul aria-labelledby={wordsId} className="flex flex-col">
        {settings.ownWords.map((own) => (
          <li key={own.id}>
            <button type="button" onClick={() => setEditing(own)} className={row}>
              <OwnThumb id={own.picture} />
              <span className="min-w-0 flex-1 truncate">{own.word}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => setEditing("new")} className={`${row} text-accent`}>
        <PlusIcon className="size-5" />
        {t("ownPictures.add")}
      </button>
      <button type="button" onClick={() => setBanners(true)} className={row}>
        <span className="min-w-0 flex-1">
          {t("ownPictures.banners")}
          <span className="block text-note text-ink-muted">{t("ownPictures.bannersHint")}</span>
        </span>
      </button>
      <WordEditor
        editing={editing}
        onClose={() => setEditing(null)}
        onSave={(own, before) => {
          const at = settings.ownWords.findIndex((w) => w.id === own.id);
          change({
            ownWords:
              at < 0
                ? [...settings.ownWords, own]
                : settings.ownWords.map((w, i) => (i === at ? own : w)),
          });
          // The picture it had before, replaced, is kept no more.
          if (before && before !== own.picture) void removePicture(before);
          setEditing(null);
        }}
        onDelete={(own) => {
          change({ ownWords: settings.ownWords.filter((w) => w.id !== own.id) });
          void removePicture(own.picture);
          setEditing(null);
        }}
      />
      <BannerEditor open={banners} onClose={() => setBanners(false)} />
    </>
  );
}

const popup =
  "centred z-[150] w-[min(26rem,calc(100vw-2rem))] rounded-3xl bg-raised p-4 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";
const backdrop =
  "fixed inset-0 z-[140] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0";

function WordEditor({
  editing,
  onClose,
  onSave,
  onDelete,
}: {
  editing: OwnWord | "new" | null;
  onClose: () => void;
  /** The word as saved, and the picture it had before. */
  onSave: (own: OwnWord, before: string | null) => void;
  onDelete: (own: OwnWord) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <DialogBackdrop className={backdrop} />
        <DialogPopup className={popup}>
          {editing !== null && (
            <WordForm
              key={editing === "new" ? "new" : editing.id}
              own={editing === "new" ? null : editing}
              onSave={onSave}
              onDelete={onDelete}
            />
          )}
          <Dialog.Close
            className={`${dialogIcon} absolute top-3 right-3`}
            aria-label={t("ownPictures.close")}
          >
            <CloseIcon className="size-5" />
          </Dialog.Close>
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function WordForm({
  own,
  onSave,
  onDelete,
}: {
  own: OwnWord | null;
  onSave: (own: OwnWord, before: string | null) => void;
  onDelete: (own: OwnWord) => void;
}) {
  const { t } = useTranslation();
  const [word, setWord] = useState(own?.word ?? "");
  const [picture, setPicture] = useState<string | null>(own?.picture ?? null);
  const [failed, setFailed] = useState(false);
  const url = usePictureUrl(picture);
  // A picture picked here and not saved is forgotten as the dialog closes,
  // and one that arrives after it closed at once (design D222).
  const unsaved = useRef<string | null>(null);
  const open = useRef(true);
  useEffect(() => {
    // Open again after React's second mounting in development (StrictMode).
    open.current = true;
    return () => {
      open.current = false;
      if (unsaved.current) void removePicture(unsaved.current);
      unsaved.current = null;
    };
  }, []);
  const wordId = useId();
  const hintId = useId();
  const errorId = useId();
  const ready = word.trim() !== "" && picture !== null;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        unsaved.current = null;
        onSave(
          { id: own?.id ?? crypto.randomUUID(), word: word.trim(), picture },
          own?.picture ?? null,
        );
      }}
      className="flex flex-col gap-4"
    >
      <Dialog.Title className="pr-10 text-title font-medium">
        {t(own ? "ownPictures.edit" : "ownPictures.new")}
      </Dialog.Title>
      <div className="flex flex-col gap-1">
        <label htmlFor={wordId} className="text-small text-ink-muted">
          {t("ownPictures.word")}
        </label>
        <input
          id={wordId}
          value={word}
          aria-describedby={hintId}
          onChange={(event) => setWord(event.target.value)}
          className="h-10 w-full rounded-lg bg-canvas px-3 text-input text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
        />
        <p id={hintId} className="text-note text-ink-muted">
          {t("ownPictures.wordHint")}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <span className="relative aspect-[3/1] w-40 shrink-0 overflow-hidden rounded-lg bg-pill">
          {url && <img src={url} alt="" className="size-full object-cover" />}
        </span>
        <PicturePicker
          label={t("ownPictures.choose")}
          className={textButton}
          onPicked={(id) => {
            if (!open.current) return void removePicture(id);
            setFailed(false);
            // A picture chosen and then another: the first is kept no more.
            if (unsaved.current) void removePicture(unsaved.current);
            unsaved.current = id;
            setPicture(id);
          }}
          onFailed={(error) => {
            if (!(error instanceof NotAPictureError)) console.error(error);
            setFailed(true);
          }}
        >
          {t("ownPictures.choose")}
        </PicturePicker>
      </div>
      {failed && (
        <p id={errorId} role="alert" className="text-note text-danger">
          {t("ownPictures.notAPicture")}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {own && (
          <button
            type="button"
            className={`${textButton} mr-auto text-danger`}
            onClick={() => onDelete(own)}
          >
            {t("ownPictures.delete")}
          </button>
        )}
        <button type="submit" className={primaryButton} disabled={!ready}>
          {t("ownPictures.save")}
        </button>
      </div>
    </form>
  );
}

/** The twelve months, each with AstroTime's banner or the user's own, to choose or reset. */
function BannerEditor({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { formats } = useCalendar();
  const { settings, change } = useSettings();
  const [failed, setFailed] = useState(false);
  const year = new Date().getFullYear();
  const set = (month: number, id: string | null) => {
    const before = settings.ownBanners[String(month)];
    // Not a destructuring with a computed key, which the React Compiler
    // cannot compile: the editor would be left unmemoized (design D194).
    const others = Object.fromEntries(
      Object.entries(settings.ownBanners).filter(([key]) => key !== String(month)),
    );
    change({ ownBanners: id ? { ...others, [String(month)]: id } : others });
    if (before) void removePicture(before);
  };
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <DialogBackdrop className={backdrop} />
        <DialogPopup className={popup}>
          <Dialog.Title className="pr-10 pb-2 text-title font-medium">
            {t("ownPictures.banners")}
          </Dialog.Title>
          {failed && (
            <p role="alert" className="pb-2 text-note text-danger">
              {t("ownPictures.notAPicture")}
            </p>
          )}
          <ul className="flex flex-col">
            {MONTH_ART.map((art, index) => {
              const month = index + 1;
              const day = `${year}-${String(month).padStart(2, "0")}-01`;
              const name = formats.period(day, day, String(year));
              const own = settings.ownBanners[String(month)];
              return (
                <li key={month} className="flex min-h-12 items-center gap-3 py-1">
                  {own ? <OwnThumb id={own} /> : <Thumb url={art.url} />}
                  <span className="min-w-0 flex-1 truncate text-body">{name}</span>
                  {own && (
                    <button
                      type="button"
                      className={dialogIcon}
                      aria-label={t("ownPictures.reset", { month: name })}
                      title={t("ownPictures.reset", { month: name })}
                      onClick={() => set(month, null)}
                    >
                      <CloseIcon className="size-5" />
                    </button>
                  )}
                  <PicturePicker
                    label={t("ownPictures.chooseFor", { month: name })}
                    className={dialogIcon}
                    onPicked={(id) => {
                      setFailed(false);
                      set(month, id);
                    }}
                    onFailed={(error) => {
                      if (!(error instanceof NotAPictureError)) console.error(error);
                      setFailed(true);
                    }}
                  >
                    <PlusIcon className="size-5" />
                  </PicturePicker>
                </li>
              );
            })}
          </ul>
          <Dialog.Close
            className={`${dialogIcon} absolute top-3 right-3`}
            aria-label={t("ownPictures.close")}
          >
            <CloseIcon className="size-5" />
          </Dialog.Close>
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
