// How the views move from one period to the next (design D154): on a touch
// screen the periods before and after the one shown are drawn beside it, and
// a sideways swipe carries them under the finger, then settles on one; a
// step by a button, a key or a picked day slides the new period in from the
// side it comes from; another view fades in. Only `transform` and `opacity`
// move, on the compositor, and a finger's move renders nothing.
// `prefers-reduced-motion` swaps at once.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { flushSync } from "react-dom";

import { swipeOutcome, useSwipe } from "../hooks.ts";

/** A period a view draws: its days, under a key that names it. */
export interface Page {
  readonly key: string;
  readonly days: readonly string[];
}

/** Material 3's emphasized decelerate: quick out of the gate, a soft landing. */
const SETTLE = "cubic-bezier(0.05, 0.7, 0.1, 1)";
const SLIDE = "cubic-bezier(0.2, 0, 0, 1)";
/** Milliseconds: a swipe let go settles in at most this, a step slides in, a view fades in. */
const SETTLE_MS = 260;
const SLIDE_MS = 220;
const FADE_MS = 160;
/** Pixels a stepped period slides in from. */
const SLIDE_PX = 40;

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Pager<P extends Page>({
  view,
  current,
  previous,
  next,
  render,
  onStep,
}: {
  /** The view drawn: another one fades in. */
  readonly view: string;
  readonly current: P;
  /** Drawn beside it on a touch screen, when its items are read. */
  readonly previous: P | null;
  readonly next: P | null;
  readonly render: (page: P, current: boolean) => ReactNode;
  readonly onStep: (direction: 1 | -1) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const shown = useRef<HTMLDivElement>(null);
  /** The track's settling after a swipe, which a step it makes ends. */
  const settling = useRef<{ animation: Animation; step: 1 | -1 | 0 } | null>(null);
  /** The finger's last offset, where a settle starts from. */
  const offset = useRef(0);
  const last = useRef<{ view: string; first: string } | null>(null);

  // A new period or view: after a swipe, the track is back under it at once
  // (the period it settled on is now the one shown, in the same frame);
  // otherwise it slides in from the side it comes from, or fades in.
  useLayoutEffect(() => {
    const was = last.current;
    const first = current.days[0]!;
    last.current = { view, first };
    const swiped = settling.current;
    if (swiped && swiped.step !== 0) {
      settling.current = null;
      swiped.animation.cancel();
      return;
    }
    const element = shown.current;
    if (!was || !element || reduced()) return;
    if (was.view !== view) {
      element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
    } else if (was.first !== first) {
      const from = first > was.first ? SLIDE_PX : -SLIDE_PX;
      element.animate(
        [
          { transform: `translateX(${from}px)`, opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: SLIDE_MS, easing: SLIDE },
      );
    }
  }, [view, current.key]);

  const move = (dx: number) => {
    offset.current = dx;
    // No period that side: the finger pulls against a stop.
    const free = (dx < 0 ? next : previous) !== null;
    const x = free ? dx : dx / 4;
    if (track.current) track.current.style.transform = `translateX(${x}px)`;
  };

  const settle = (step: 1 | -1 | 0) => {
    const element = track.current;
    const width = root.current?.clientWidth ?? 0;
    const neighbour = step === 1 ? next : step === -1 ? previous : null;
    if (!element || (step !== 0 && !neighbour) || reduced()) {
      if (element) element.style.transform = "";
      if (step !== 0) onStep(step);
      return;
    }
    const from = element.style.transform || "none";
    element.style.transform = "";
    const to = step === 0 ? 0 : -step * width;
    const distance = Math.abs(to - offset.current);
    const animation = element.animate([{ transform: from }, { transform: `translateX(${to}px)` }], {
      duration: Math.max(120, (SETTLE_MS * distance) / Math.max(1, width)),
      easing: SETTLE,
      fill: "forwards",
    });
    settling.current = { animation, step };
    animation.onfinish = () => {
      // The step drawn at once, so the track is back under the new period
      // in this frame; a step that changed no period (a parent that would
      // not move) puts the track back where it was, and the swipe is free.
      if (step !== 0) flushSync(() => onStep(step));
      if (settling.current?.animation === animation) {
        settling.current = null;
        animation.cancel();
      }
    };
  };

  useSwipe(root, {
    onStart() {
      // The grid's scroll is the same on every period, so none jumps as it comes in.
      const scrollers = root.current?.querySelectorAll<HTMLElement>("[data-scroller]") ?? [];
      const top = shown.current?.querySelector<HTMLElement>("[data-scroller]")?.scrollTop;
      if (top !== undefined) for (const scroller of scrollers) scroller.scrollTop = top;
    },
    onMove(dx) {
      if (!settling.current && !reduced()) move(dx);
    },
    onEnd(dx, dy, velocity) {
      if (settling.current) return;
      const width = root.current?.clientWidth ?? 0;
      settle(swipeOutcome(dx, dy, velocity, width));
    },
    onCancel() {
      if (!settling.current) settle(0);
    },
  });

  const pages = [
    previous && { page: previous, at: "-100%" },
    { page: current, at: null },
    next && { page: next, at: "100%" },
  ];
  return (
    <div ref={root} className="relative flex min-h-0 flex-1 touch-pan-y overflow-hidden">
      <div ref={track} data-track="" className="absolute inset-0">
        {/* In time order, so a step adds or drops one at an end and moves none (each keeps its scroll). */}
        {pages.map((entry) =>
          !entry ? null : entry.at === null ? (
            <div
              key={entry.page.key}
              ref={shown}
              data-current=""
              className="absolute inset-0 flex flex-col"
            >
              {render(entry.page, true)}
            </div>
          ) : (
            <div
              key={entry.page.key}
              inert
              aria-hidden="true"
              className="absolute inset-0 flex flex-col"
              style={{ transform: `translateX(${entry.at})` }}
            >
              {render(entry.page, false)}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
