// Pinching the time grid (design D192): two fingers, a trackpad's pinch
// (which the browser sends as a wheel with Ctrl) or Ctrl and a wheel, and
// the keys "+", "-" and "0" change the hour's height to any value from 24
// to 240 px, the time under the fingers or the pointer kept where it is.
// While it goes, only `--hour` on the view and the grid's scroll change, no
// React render; once it stops, the height is handed back and kept. Loaded
// after the view is drawn, in a chunk of its own (foundation D145).
import { HOUR, hourIn } from "./items.tsx";

/** How much a key step changes the height. */
const STEP = 1.25;
/** How long after a wheel's last turn the zoom counts as ended. */
const SETTLE_MS = 250;

/** Whether a key's target is a field, a dialog or a widget with keys of its own. */
function owned(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "input, textarea, select, [contenteditable], [role=dialog], [role=listbox], [role=menu], [role=combobox], [role=tablist], [role=slider], [role=search]",
    ) !== null
  );
}

/**
 * An hour's height as drawn and kept: within the bounds, to a tenth of a
 * pixel. Drawn as it is kept, so the time under the fingers does not move
 * when the zoom ends.
 */
export const keptHour = (px: number) => Math.round(hourIn(px) * 10) / 10;

/** The scroll that keeps the time `offset` px down the grid there, from `from` to `to` px an hour. */
export const anchored = (scrollTop: number, offset: number, from: number, to: number) =>
  ((scrollTop + offset) / from) * to - offset;

/**
 * Lets the time grids in `main` be pinched; `hour` is the height drawn now,
 * `commit` keeps one a zoom ended on, `home` is the one `0` goes back to
 * (`HOUR` at the text size, design D295). Returns what detaches it.
 */
export function zoomable(
  main: HTMLElement,
  hour: () => number,
  commit: (hour: number) => void,
  home: () => number = () => HOUR,
): () => void {
  let live: number | null = null;
  let settle: ReturnType<typeof setTimeout> | undefined;
  // What is drawn: `--hour` on the view, set here while a zoom goes and by
  // React once it is kept, which may render after the next key or wheel.
  const current = () =>
    live ?? (Number.parseFloat(main.style.getPropertyValue("--hour")) || hour());
  const scrollerOf = (target: EventTarget | null) =>
    target instanceof Element ? target.closest<HTMLElement>("[data-scroller]") : null;

  /** Draws `next` px an hour, keeping the time at `y` (a viewport's y) where it is. */
  const zoomTo = (next: number, scroller: HTMLElement, y: number) => {
    const from = current();
    const to = keptHour(next);
    if (to === from) return;
    const offset = y - scroller.getBoundingClientRect().top;
    live = to;
    main.style.setProperty("--hour", `${to}px`);
    scroller.scrollTop = anchored(scroller.scrollTop, offset, from, to);
  };
  const end = () => {
    clearTimeout(settle);
    if (live === null) return;
    const ended = live;
    live = null;
    commit(ended);
  };

  const wheel = (event: WheelEvent) => {
    const scroller = scrollerOf(event.target);
    if (!event.ctrlKey || !scroller) return;
    // Not the page's zoom: the grid's.
    event.preventDefault();
    const lines = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
    zoomTo(current() * Math.exp((-event.deltaY * lines) / 200), scroller, event.clientY);
    clearTimeout(settle);
    settle = setTimeout(end, SETTLE_MS);
  };

  let pinch: { scroller: HTMLElement; spread: number; hour: number } | null = null;
  const spreadOf = (touches: TouchList) =>
    Math.hypot(
      touches[0]!.clientX - touches[1]!.clientX,
      touches[0]!.clientY - touches[1]!.clientY,
    );
  /** Two fingers down on a grid: a pinch from the height drawn and how far apart they are. */
  const begin = (event: TouchEvent, scroller: HTMLElement | null) => {
    pinch = scroller ? { scroller, spread: spreadOf(event.touches), hour: current() } : null;
  };
  // Two fingers begin a pinch; a third ends it where it is, and when one of
  // three lifts, the two left begin anew from there: the zoom never
  // measures one pair of fingers against another.
  const touchStart = (event: TouchEvent) => {
    if (event.touches.length === 2) return begin(event, scrollerOf(event.target));
    if (event.touches.length > 2 && pinch) {
      pinch = null;
      end();
    }
  };
  const touchMove = (event: TouchEvent) => {
    if (!pinch || event.touches.length !== 2) return;
    // A second finger on a grid already scrolling: the browser keeps that
    // touch as its scroll (the move cannot be cancelled), so it is no
    // pinch, rather than a zoom fighting the scroll. Otherwise the two
    // fingers zoom the grid and do not scroll it; the page never zooms
    // there (the grid's `touch-action` is `pan-y`).
    if (!event.cancelable) {
      pinch = null;
      end();
      return;
    }
    event.preventDefault();
    const middle = (event.touches[0]!.clientY + event.touches[1]!.clientY) / 2;
    zoomTo(
      (pinch.hour * spreadOf(event.touches)) / Math.max(1, pinch.spread),
      pinch.scroller,
      middle,
    );
  };
  const touchEnd = (event: TouchEvent) => {
    if (event.touches.length === 2)
      return begin(event, pinch?.scroller ?? scrollerOf(event.target));
    if (!pinch) return;
    pinch = null;
    end();
  };

  // "+" and "-" step the height, "0" brings back the usual one: on the
  // grid shown, about its middle, as the view's other keys (design D88).
  const key = (event: KeyboardEvent) => {
    if (main.hidden || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey || owned(event.target)) return;
    const scale =
      event.key === "+" || event.key === "="
        ? STEP
        : event.key === "-"
          ? 1 / STEP
          : event.key === "0"
            ? 0
            : null;
    const scroller = main.querySelector<HTMLElement>("[data-current] [data-scroller]");
    if (scale === null || !scroller) return;
    event.preventDefault();
    const { top, height } = scroller.getBoundingClientRect();
    zoomTo(scale === 0 ? home() : current() * scale, scroller, top + height / 2);
    end();
  };

  // Said for the tests, which wait for it before they pinch.
  main.dataset["zoomable"] = "";
  main.addEventListener("wheel", wheel, { passive: false });
  main.addEventListener("touchstart", touchStart, { passive: true });
  main.addEventListener("touchmove", touchMove, { passive: false });
  main.addEventListener("touchend", touchEnd);
  main.addEventListener("touchcancel", touchEnd);
  window.addEventListener("keydown", key);
  return () => {
    delete main.dataset["zoomable"];
    // A wheel's zoom still settling is kept, not lost with the view.
    end();
    main.removeEventListener("wheel", wheel);
    main.removeEventListener("touchstart", touchStart);
    main.removeEventListener("touchmove", touchMove);
    main.removeEventListener("touchend", touchEnd);
    main.removeEventListener("touchcancel", touchEnd);
    window.removeEventListener("keydown", key);
  };
}
