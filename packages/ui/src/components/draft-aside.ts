// The edit dialog's draft (design D155), made in the editor's chunk: the
// form's item handed to the views, and where the dialog stands on a wide
// screen, so the item shows beside it, as Google Calendar's web app keeps
// its draft beside its dialog.
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";

import { draftOf, drawn, placementOf } from "../calendar/draft.ts";
import type { Form, Target } from "../calendar/editing.ts";
import type { DrawnDraft } from "../calendar/query.ts";
import { useMediaQuery } from "../hooks.ts";

/**
 * From this wide, in rem, the dialog floats (Tailwind's `sm:`,
 * `dialog-parts.tsx`'s `sheet`); narrower it is the whole screen. A media
 * query counts rem from the browser's own font size, not the root's; the
 * page sets no root size of its own, so the two are one.
 */
const FLOATS_REM = 40;
/** The dialog's widest in rem, as the sheet's `sm:w-[min(36rem,…)]` in the middle: larger with the user's larger font. */
const WIDEST_REM = 36;
/** The narrowest it stands beside the draft: a phone's width, which the form is made for. */
const NARROWEST = 360;
/** Its margin from the screen's edge, and from the draft. */
const MARGIN = 24;
const GAP = 8;

/** Where the dialog stands beside the draft, and how wide. */
export interface Aside {
  readonly side: "left" | "right";
  readonly width: number;
}

/** An aside with the draft's edges it was worked out for, rounded: the dialog says them (`data-aside-for`). */
export interface Placed extends Aside {
  readonly draft: string;
}

/**
 * The side of the screen with more room beside the draft, wherever the
 * dialog floats, the dialog narrowed to that room down to a phone's width
 * (design D155, D187); `null` elsewhere, with no draft drawn, or with no
 * such room, and the dialog stays in the middle. Measured after each
 * render, as the draft moves with the form.
 */
export function useDraftAside(open: boolean): Placed | null {
  // Heard for its changes: a window made narrower or wider renders anew.
  const floating = useMediaQuery(`(min-width: ${FLOATS_REM}rem)`);
  const [aside, setAside] = useState<Placed | null>(null);
  // The view's size changed (a window resized, the drawer opened): the
  // draft's edges move with no render of the dialog's own, so it renders.
  const [, setResized] = useState(0);
  useEffect(() => {
    const main = open && floating ? document.querySelector("main") : null;
    if (!main) return;
    const observer = new ResizeObserver(() => setResized((count) => count + 1));
    observer.observe(main);
    return () => observer.disconnect();
  }, [open, floating]);
  // On every render: the draft moves as the form changes. Nothing moves it
  // sideways while the dialog is open: the views behind it are inert (no
  // swipe, no keys), and none scrolls sideways; a scroll moves it up or
  // down only, which leaves its sides, and so the aside, as they are.
  useLayoutEffect(() => {
    // Closing, the dialog fades where it stood: its draft is gone already,
    // and measuring now would put it in the middle for its last frames.
    if (!open) return;
    const draft = floating ? shownDraft() : null;
    const rect = draft?.getBoundingClientRect();
    const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const beside = rect ? besideOf(rect, window.innerWidth, rem) : null;
    const next =
      beside && rect
        ? { ...beside, draft: `${Math.round(rect.left)},${Math.round(rect.right)}` }
        : null;
    setAside((known) =>
      known?.side === next?.side && known?.width === next?.width && known?.draft === next?.draft
        ? known
        : next,
    );
  });
  // Not floating is the middle at once, with no render at the old place.
  return floating ? aside : null;
}

/** Where a dialog fits beside `draft` on a screen `screen` wide, with the root font `rem` px (design D187). */
export function besideOf(
  draft: { left: number; right: number },
  screen: number,
  rem = 16,
): Aside | null {
  if (screen < FLOATS_REM * rem) return null;
  const left = draft.left - MARGIN - GAP;
  const right = screen - draft.right - MARGIN - GAP;
  // A tie goes right, as the dialog reads from the left edge of the screen otherwise.
  const side = right >= left ? "right" : "left";
  const width = Math.floor(Math.min(WIDEST_REM * rem, side === "right" ? right : left));
  return width >= NARROWEST ? { side, width } : null;
}

/** The dialog's place and width beside the draft, over the sheet's middle (design D187). */
export function asideStyle({ side, width }: Aside): CSSProperties {
  // Its outer edge clear of a system bar at that side too (design D235),
  // narrower by it, so its inner edge stays beside the draft.
  const inset = `var(--inset-${side})`;
  return {
    width: `calc(${width}px - ${inset})`,
    [side]: `calc(${MARGIN}px + ${inset})`,
    [side === "left" ? "right" : "left"]: "auto",
    translate: "0 -50%",
  };
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
