// "Copy made" (design D164), loaded with the copy, not with the app
// (docs/plans/foundation.md#D145).
import { useEffect, useEffectEvent, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Target } from "../calendar/editing.ts";
import { CloseIcon } from "./icons.tsx";

/** How long the copy's notice stays, as a snackbar does. */
const COPIED_MS = 8000;

/**
 * "Copy made", with Open (design D164): a copy is made at once, and the user
 * may want to change it; it goes by itself after a while, as Google's does,
 * but not while a pointer is over it or the focus in it: then its time
 * starts again once they leave (WCAG 2.2.1, design D119).
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
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  useEffect(() => {
    if (!copied || paused) return;
    const timer = setTimeout(close, COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied, paused]);
  if (!copied) return null;
  return (
    <div
      role="status"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
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
