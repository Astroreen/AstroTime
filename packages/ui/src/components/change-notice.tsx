// What the user is told when a change made outside the edit dialog (a
// deletion, a task completed or starred) did not land: the item was gone,
// it is unclear whether it was saved, or it failed (docs/plans/foundation.md#D103);
// and a place's address that could not be copied (docs/plans/design.md#D177).
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useEffect, useEffectEvent } from "react";

import type { Notice, Target } from "../calendar/editing.ts";
import { CloseIcon } from "./icons.tsx";

const KEYS = {
  gone: "edit.problem.gone",
  inDoubt: "edit.problem.inDoubt",
  failed: "edit.failed",
  deleteInDoubt: "notice.deleteInDoubt",
  deleteFailed: "notice.deleteFailed",
  copyFailed: "notice.copyFailed",
} as const satisfies Record<Notice, string>;

export function ChangeNotice({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const { t } = useTranslation();
  if (!notice) return null;
  // On the page's body, beside any dialog open: inside the app's root, an
  // open dialog (the details, over which a copy can fail) hides it from
  // assistive technology along with the rest of the page.
  return createPortal(
    <div
      role="alert"
      className="fixed bottom-4 left-1/2 z-[120] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-2 rounded-2xl bg-danger-soft p-3 text-body text-danger shadow-lg"
    >
      <p className="flex-1 py-1">{t(KEYS[notice])}</p>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("notice.close")}
        className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-danger"
      >
        <CloseIcon className="size-4" />
      </button>
    </div>,
    document.body,
  );
}

/** How long the copy's notice stays, as a snackbar does. */
const COPIED_MS = 8000;

/**
 * "Copy made", with Open (design D164): a copy is made at once, and the user
 * may want to change it; it goes by itself after a while, as Google's does.
 */
export function CopyNotice({
  copied,
  onOpen,
  onClose,
}: {
  copied: Target | null;
  onOpen: (target: Target) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The latest `onClose`, so a parent's render does not start the time again.
  const close = useEffectEvent(() => onClose());
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(close, COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!copied) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-[120] flex w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 items-center gap-2 rounded-2xl bg-ink p-2 pl-4 text-body text-canvas shadow-lg"
    >
      <p className="flex-1 py-1">{t("notice.copied")}</p>
      <button
        type="button"
        onClick={() => onOpen(copied)}
        className="rounded-full px-3 py-1.5 font-semibold text-canvas hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent"
      >
        {t("notice.open")}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={t("notice.close")}
        className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent"
      >
        <CloseIcon className="size-4" />
      </button>
    </div>
  );
}
