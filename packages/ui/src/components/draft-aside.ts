// The edit dialog's draft (design D155), made in the editor's chunk: the
// form's item handed to the views, and where the dialog stands on a wide
// screen, so the item shows beside it, as Google Calendar's web app keeps
// its draft beside its dialog.
import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { draftOf, drawn, placementOf } from "../calendar/draft.ts";
import type { Form, Target } from "../calendar/editing.ts";
import type { DrawnDraft } from "../calendar/query.ts";
import { useMediaQuery } from "../hooks.ts";

/**
 * The side of the screen away from the draft, from 1024 px wide, where a
 * dialog and a day's column fit side by side; `null` elsewhere, or with no
 * draft drawn, and the dialog stays in the middle.
 */
export function useDraftAside(open: boolean): "left" | "right" | null {
  const wide = useMediaQuery("(min-width: 1024px)");
  const [side, setSide] = useState<"left" | "right" | null>(null);
  // On every render: the draft moves as the form changes.
  useLayoutEffect(() => {
    const draft = open && wide ? shownDraft() : null;
    if (!draft) {
      setSide(null);
      return;
    }
    const { left, width } = draft.getBoundingClientRect();
    setSide(left + width / 2 < window.innerWidth / 2 ? "right" : "left");
  });
  return side;
}

/** The draft as the view shows it: not a copy in a period drawn beside it for a swipe (design D154). */
function shownDraft(): Element | undefined {
  return [...document.querySelectorAll("main [data-draft]")].find(
    (element) => !element.closest("[inert]"),
  );
}

/**
 * Makes the form's draft and hands it to the views (design D155), here in
 * the editor's chunk, so the draft's code loads with the dialog
 * (foundation D145); brings it into sight when its day or time changes,
 * not with each letter of its title.
 */
export function useDraft(
  target: Target | null,
  form: Form | null,
  onDraft: (draft: DrawnDraft | null) => void,
): void {
  const { t } = useTranslation();
  // Made anew only when where or how it is drawn changes (`placementOf`):
  // typing its title renames it, typing elsewhere does nothing.
  const latest = useRef(form);
  latest.current = form;
  const placement = form ? placementOf(form) : null;
  const made = useMemo(() => {
    const now = latest.current;
    return placement === null || !now
      ? null
      : { draft: draftOf(target, now, t("edit.untitledReminder")), expanded: new Map() };
  }, [target, placement, t]);
  const summary = form?.summary ?? "";
  const draft = useMemo(
    () => (made ? drawn(made.draft, summary, made.expanded) : null),
    [made, summary],
  );
  const handed = useEffectEvent(onDraft);
  useEffect(() => {
    handed(draft);
    return () => handed(null);
  }, [draft]);
  const when = draft?.when ?? null;
  useEffect(() => {
    if (when !== null) shownDraft()?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [when]);
}
