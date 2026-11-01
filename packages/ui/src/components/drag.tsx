// Dragging and resizing items with a pointer, moving them with keys
// (docs/plans/foundation.md#D14, D16; design D111, D112): a press on an item
// drags it (a mouse once it moves, a finger after a long press, so a swipe
// still scrolls), its ghost shows where it goes and when, Escape cancels,
// and the drop saves through the edit dialog's path, asking the scope for an
// occurrence of a series. The original stays where it was until the save is
// written and drawn. A press dragged over an empty column sizes a new event.
// The views say what is under a point (`DragSurface`) and draw the ghost.
import { timesOf, type ItemTimes, type Occurrence } from "@astrotime/core";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useTranslation } from "react-i18next";

import {
  dropped,
  edgeScroll,
  ghostOf,
  keyMove,
  LONG_PRESS,
  moved,
  pressPhase,
  sized,
  type Area,
  type Grip,
  type Held,
  type Spot,
} from "../calendar/drag.ts";
import type { Entry } from "../calendar/query.ts";
import { useCalendar } from "./context.ts";
import { targetOf, useEditing, type Rescheduled } from "./editing.tsx";
import { whenText } from "./item-details.tsx";
import { textButton } from "./sign-in-dialog.tsx";

/** What a view tells a drag: the spot under a point, and what scrolls. */
export interface DragSurface {
  /**
   * The spot under a client point for a drag held by `grip`, picked up on
   * `from` (`null` for the press itself): a resize and a new event's size
   * keep to their column on the time grid. `null` where nothing drops.
   */
  spotAt(x: number, y: number, grip: Grip, from: Spot | null): Spot | null;
  /** The element a drag near its top or bottom edge scrolls, if any. */
  scroller(): HTMLElement | null;
}

/** What the view draws while a drag goes on, or while its drop is saved. */
export type Ghost =
  | {
      readonly kind: "item";
      readonly entry: Entry;
      /** The occurrence with the times it would take; as it was while they would not change. */
      readonly occurrence: Occurrence;
      readonly grip: Grip;
    }
  | { readonly kind: "create"; readonly day: string; readonly at: number; readonly length: number };

/** The handlers that make an item draggable, and the keys its opener takes. */
export interface DragSource {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  /** A press on a block's edge: that end only. */
  readonly onEdgeDown: (grip: "start" | "end") => (event: PointerEvent<HTMLElement>) => void;
  readonly onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  readonly keys: {
    readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
    readonly "aria-keyshortcuts": string;
    readonly "aria-describedby": string;
  };
}

interface DragValue {
  /** How an item drags in `area`, or `null` when it cannot (a read-only calendar's). */
  source(entry: Entry, area: Area): DragSource | null;
  /** The key of the entry being dragged or saved, dimmed where it was. */
  readonly held: string | null;
}

export const DragContext = createContext<DragValue | null>(null);

/** How an item drags, if it can, and whether it is the one held. */
export function useDragSource(
  entry: Entry,
  area: Area,
): { source: DragSource | null; held: boolean } {
  const value = useContext(DragContext);
  if (!value) return { source: null, held: false };
  return { source: value.source(entry, area), held: value.held === entry.key };
}

const SHORTCUTS: Record<Area, string> = {
  grid: "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Alt+Shift+ArrowUp Alt+Shift+ArrowDown",
  strip: "Alt+ArrowLeft Alt+ArrowRight",
  month: "Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown",
};

type Problem = "gone" | "inDoubt" | "failed";
const PROBLEM_KEYS = {
  gone: "edit.problem.gone",
  inDoubt: "edit.problem.inDoubt",
  failed: "edit.failed",
} as const;

/** A press on an item or an empty column, and where it has gone. */
interface Gesture {
  readonly source: { readonly entry: Entry; readonly held: Held } | { readonly day: string };
  readonly grip: Grip;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly element: Element;
  readonly x0: number;
  readonly y0: number;
  readonly t0: number;
  readonly from: Spot;
  /** Pressed, dragging, or dragged and cancelled by Escape (its release still opens nothing). */
  phase: "wait" | "drag" | "cancelled";
  moved: number;
  x: number;
  y: number;
  to: Spot;
  times: ItemTimes | null;
  ghost: Ghost | null;
  stop: () => void;
}

type Shown =
  | { readonly phase: "drag"; readonly ghost: Ghost }
  | {
      readonly phase: "saving" | "saved";
      readonly ghost: Extract<Ghost, { kind: "item" }>;
    };

const heldOf = (entry: Entry): Held => ({
  kind: entry.occurrence.item.kind,
  times: timesOf(entry.object, entry.occurrence.recurrenceId),
});

/** Swallows the click a drag's release makes, so it opens nothing. */
function swallowClick() {
  const swallow = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", swallow, { capture: true, once: true });
  // The click comes with the release, before any timer; none came: nothing to swallow.
  setTimeout(() => window.removeEventListener("click", swallow, true), 0);
}

/**
 * The drag of a view. `find` gives the entry drawn under a key now, so a
 * saved move's ghost goes once the item is drawn anew; `root` is the view's
 * element, where a finger's drag stops the page from scrolling.
 */
export function useDrag({
  surface,
  root,
  find,
}: {
  surface: DragSurface;
  root: RefObject<HTMLElement | null>;
  find: (key: string) => Entry | undefined;
}) {
  const { t } = useTranslation();
  const { formats, timeZone } = useCalendar();
  const editing = useEditing();
  const hint = useId();
  const [shown, setShown] = useState<Shown | null>(null);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  // The item a key moved, focused again once it is drawn where it went.
  const [refocus, setRefocus] = useState<{ key: string; entry: Entry } | null>(null);
  const live = useRef<Gesture | null>(null);
  const busy = useRef(false);

  // A saved move's ghost stays until the item is drawn anew (its object parsed again) or is gone.
  useEffect(() => {
    if (shown?.phase !== "saved") return;
    const { entry } = shown.ghost;
    if (find(entry.key)?.object !== entry.object) setShown(null);
  });
  useEffect(() => {
    if (!refocus) return;
    const now = find(refocus.key);
    if (now?.object === refocus.entry.object) return;
    setRefocus(null);
    const opener = root.current?.querySelector(`[data-key="${CSS.escape(refocus.key)}"] button`);
    if (opener instanceof HTMLElement) opener.focus();
  });

  // A finger's drag holds the page still: the listener must be there before
  // the touch starts for the browser to wait for it.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const hold = (event: TouchEvent) => {
      if (live.current?.phase === "drag") event.preventDefault();
    };
    element.addEventListener("touchmove", hold, { passive: false });
    return () => element.removeEventListener("touchmove", hold);
  }, [root]);

  const report = (entry: Entry, grip: Grip, times: ItemTimes, outcome: Rescheduled) => {
    if (outcome === "saved") {
      const { item } = entry.occurrence;
      const allDay = (times.start ?? times.end)?.type === "date";
      const when = whenText(item.kind === "task" ? item : null, times, allDay, {
        t,
        formats,
        timeZone,
      });
      const title = item.summary?.trim() || t("item.untitled");
      setMessage(t(grip === "move" ? "drag.moved" : "drag.resized", { title, when }));
    } else if (outcome === "cancelled") setMessage(t("drag.cancelled"));
    else if (outcome !== "unchanged") setProblem(outcome);
  };

  const commit = async (entry: Entry, grip: Grip, times: ItemTimes): Promise<Rescheduled> => {
    busy.current = true;
    setProblem(null);
    const target = targetOf(
      { id: entry.objectId, calendarId: entry.calendarId },
      entry.object,
      entry.occurrence.recurrenceId,
      entry.occurrence.item,
    );
    const outcome = await editing.reschedule(target, times);
    busy.current = false;
    report(entry, grip, times, outcome);
    return outcome;
  };

  const ghostFor = (gesture: Gesture): Ghost => {
    const { source, grip, from, to } = gesture;
    if (!("entry" in source))
      return { kind: "create", day: source.day, ...sized(from.minutes!, to.minutes!) };
    let times: ItemTimes | null = null;
    try {
      times = dropped(source.held, grip, from, to, timeZone);
    } catch (error) {
      // A zone `Intl` does not know: the item stays where it is.
      console.error(error);
    }
    gesture.times = times;
    const occurrence = times ? ghostOf(source.entry.occurrence, times) : source.entry.occurrence;
    return { kind: "item", entry: source.entry, occurrence, grip };
  };

  const press = (source: Gesture["source"], grip: Grip, event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || live.current || busy.current) return;
    const from = surface.spotAt(event.clientX, event.clientY, grip, null);
    if (!from) return;
    setRefocus(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const gesture: Gesture = {
      source,
      grip,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      element: event.currentTarget,
      x0: event.clientX,
      y0: event.clientY,
      t0: event.timeStamp,
      from,
      phase: "wait",
      moved: 0,
      x: event.clientX,
      y: event.clientY,
      to: from,
      times: null,
      ghost: null,
      stop: () => {
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        window.removeEventListener("pointercancel", onCancel, true);
        window.removeEventListener("keydown", onKey, true);
        delete document.documentElement.dataset["dragging"];
        if (live.current === gesture) live.current = null;
      },
    };
    live.current = gesture;

    const follow = () => {
      const to = surface.spotAt(gesture.x, gesture.y, grip, from) ?? gesture.to;
      if (gesture.ghost && to.day === gesture.to.day && to.minutes === gesture.to.minutes) return;
      gesture.to = to;
      gesture.ghost = ghostFor(gesture);
      setShown({ phase: "drag", ghost: gesture.ghost });
    };
    // Near the grid's top or bottom, it scrolls, and the spot under the pointer moves.
    const scroll = () => {
      const scroller = surface.scroller();
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const by = edgeScroll(gesture.y, gesture.y0, rect.top, rect.bottom);
        if (by !== 0) {
          scroller.scrollTop += by;
          follow();
        }
      }
      frame = requestAnimationFrame(scroll);
    };
    const begin = () => {
      gesture.phase = "drag";
      try {
        gesture.element.setPointerCapture(gesture.pointerId);
      } catch {
        // Released already: the window's listeners still follow it.
      }
      document.documentElement.dataset["dragging"] = grip === "move" ? "move" : "resize";
      follow();
      frame = requestAnimationFrame(scroll);
    };
    const drop = () => {
      const ghost = gesture.ghost;
      if (!("entry" in source)) {
        setShown(null);
        // A press that never left its slot is a tap: the half hour, an hour long.
        const options =
          gesture.to.minutes === from.minutes
            ? { day: source.day, at: Math.floor(from.minutes! / 30) * 30 }
            : { day: source.day, ...sized(from.minutes!, gesture.to.minutes!) };
        editing.create("event", options);
        return;
      }
      const times = gesture.times;
      // A drop that changes nothing writes nothing.
      if (!times || ghost?.kind !== "item") {
        setShown(null);
        return;
      }
      setShown({ phase: "saving", ghost });
      void commit(source.entry, grip, times).then((outcome) =>
        setShown(outcome === "saved" ? { phase: "saved", ghost } : null),
      );
    };

    function onMove(other: globalThis.PointerEvent) {
      if (other.pointerId !== gesture.pointerId) return;
      gesture.x = other.clientX;
      gesture.y = other.clientY;
      if (gesture.phase === "cancelled") return;
      if (gesture.phase === "wait") {
        const distance = Math.hypot(other.clientX - gesture.x0, other.clientY - gesture.y0);
        gesture.moved = Math.max(gesture.moved, distance);
        const phase = pressPhase(gesture.pointerType, gesture.moved, other.timeStamp - gesture.t0);
        if (phase === "scroll") gesture.stop();
        else if (phase === "drag") begin();
        return;
      }
      follow();
    }
    function onUp(other: globalThis.PointerEvent) {
      if (other.pointerId !== gesture.pointerId) return;
      const { phase } = gesture;
      gesture.stop();
      if (phase === "wait") return;
      // Not a swipe to the next period, nor a click on what is under it.
      other.stopPropagation();
      swallowClick();
      if (phase === "drag") drop();
    }
    function onCancel(other: globalThis.PointerEvent) {
      if (other.pointerId !== gesture.pointerId) return;
      gesture.stop();
      setShown(null);
    }
    function onKey(other: globalThis.KeyboardEvent) {
      if (other.key !== "Escape" || gesture.phase !== "drag") return;
      other.preventDefault();
      other.stopPropagation();
      gesture.phase = "cancelled";
      cancelAnimationFrame(frame);
      delete document.documentElement.dataset["dragging"];
      setShown(null);
      setMessage(t("drag.cancelled"));
    }
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("keydown", onKey, true);
    // A finger held still drags; nothing moves meanwhile to say so.
    if (event.pointerType === "touch") {
      timer = setTimeout(() => {
        if (gesture.phase === "wait" && pressPhase("touch", gesture.moved, LONG_PRESS) === "drag") {
          begin();
        }
      }, LONG_PRESS);
    }
  };

  const keyDown = (entry: Entry, area: Area) => (event: KeyboardEvent<HTMLElement>) => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return;
    const step = keyMove(area, event.key, event.shiftKey);
    if (!step) return;
    // Alt with an arrow is the browser's back and forward: not on an item.
    event.preventDefault();
    event.stopPropagation();
    if (busy.current || live.current) return;
    let times: ItemTimes | null = null;
    try {
      times = moved(heldOf(entry), step.grip, step.minutes, timeZone);
    } catch (error) {
      console.error(error);
    }
    if (!times) return;
    void commit(entry, step.grip, times).then((outcome) => {
      if (outcome === "saved") setRefocus({ key: entry.key, entry });
    });
  };

  const value: DragValue = {
    source(entry, area) {
      if (!editing.canChange(entry.calendarId)) return null;
      const item = (grip: Grip) => (event: PointerEvent<HTMLElement>) =>
        press({ entry, held: heldOf(entry) }, grip, event);
      return {
        onPointerDown: item("move"),
        onEdgeDown: item,
        // A long press is a drag, not the browser's menu.
        onContextMenu: (event) => {
          if (live.current) event.preventDefault();
        },
        keys: {
          onKeyDown: keyDown(entry, area),
          "aria-keyshortcuts": SHORTCUTS[area],
          "aria-describedby": `${hint}-${area}`,
        },
      };
    },
    held: shown?.ghost.kind === "item" ? shown.ghost.entry.key : null,
  };

  /** A press on an empty column of the time grid: dragged, it sizes a new event there. */
  const pressEmpty = (day: string) => (event: PointerEvent<HTMLElement>) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!editing.canCreate || target?.closest("[role=listitem], button")) return;
    press({ day }, "end", event);
  };

  const overlay: ReactNode = (
    <>
      {(["grid", "strip", "month"] as const).map((area) => (
        <span key={area} id={`${hint}-${area}`} hidden>
          {t(`drag.hint.${area}`)}
        </span>
      ))}
      <p role="status" className="sr-only">
        {message}
      </p>
      {problem && (
        <div
          role="alert"
          className="absolute bottom-4 left-4 z-[70] flex max-w-sm items-start gap-3 rounded-2xl bg-raised px-4 py-3 text-sm text-ink shadow-lg shadow-black/30"
        >
          <p className="flex-1 pt-1.5">{t(PROBLEM_KEYS[problem])}</p>
          <button type="button" className={textButton} onClick={() => setProblem(null)}>
            {t("drag.dismiss")}
          </button>
        </div>
      )}
    </>
  );

  return { value, ghost: shown?.ghost ?? null, pressEmpty, overlay };
}
