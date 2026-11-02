// Where the edit dialog stands on a wide screen, so the item it makes shows
// beside it in the views (design D155), as Google Calendar's web app keeps
// its draft beside its dialog.
import { useLayoutEffect, useState } from "react";

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
export function shownDraft(): Element | undefined {
  return [...document.querySelectorAll("main [data-draft]")].find(
    (element) => !element.closest("[inert]"),
  );
}
