// The pager's swipe (design D154), driven by a finger's pointer events: it
// waits on the track's own animations, never on a clock.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { Pager, type Page } from "../src/components/pager.tsx";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const page = (day: string): Page => ({ key: day, days: [day] });

/** A pager over three days, 400 px wide, whose steps go to `onStep`. */
function render(options: { next: Page | null; onStep: (direction: 1 | -1) => void }) {
  const draw = (current: string, view = "day") => (
    <Pager
      view={view}
      current={page(current)}
      previous={page("2026-11-03")}
      next={options.next}
      render={(shown) => <p>{shown.days[0]}</p>}
      onStep={options.onStep}
    />
  );
  const host = document.createElement("div");
  host.style.cssText = "width: 400px; height: 300px; display: flex;";
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => root.render(draw("2026-11-04")));
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });
  const track = host.querySelector<HTMLElement>("[data-track]")!;
  /** Draws another period, as a key or Today would. */
  const show = (current: string, view?: string) =>
    flushSync(() => root.render(draw(current, view)));
  return { track, viewport: track.parentElement!, show };
}

/** A finger's swipe of `dx` pixels to the right over `element`, in moves of 20 px. */
function swipe(element: HTMLElement, dx: number) {
  const at = (type: string, x: number) =>
    element.dispatchEvent(
      new PointerEvent(type, {
        pointerType: "touch",
        isPrimary: true,
        pointerId: 7,
        clientX: x,
        clientY: 150,
        bubbles: true,
      }),
    );
  at("pointerdown", 200);
  const steps = Math.abs(dx) / 20;
  for (let step = 1; step <= steps; step++) at("pointermove", 200 + Math.sign(dx) * step * 20);
  at("pointerup", 200 + dx);
}

test("a swipe whose step moves nothing gives the track back, and the next swipe follows the finger", async () => {
  const onStep = vi.fn();
  const { track, viewport } = render({ next: page("2026-11-05"), onStep });
  swipe(viewport, -200);
  const [settle] = track.getAnimations();
  expect(settle).toBeDefined();
  // Its `finish` event, after the pager's own handler (its promise settles before both).
  await new Promise((resolve) => settle!.addEventListener("finish", resolve));
  expect(onStep).toHaveBeenCalledWith(1);
  // The parent kept the period: the track is where it was, not at the next one.
  expect(track.getAnimations()).toEqual([]);
  expect(track.style.transform).toBe("");
  // And it is free: a finger moves it again.
  const at = (type: string, x: number) =>
    viewport.dispatchEvent(
      new PointerEvent(type, {
        pointerType: "touch",
        isPrimary: true,
        pointerId: 8,
        clientX: x,
        clientY: 150,
        bubbles: true,
      }),
    );
  at("pointerdown", 200);
  at("pointermove", 170);
  at("pointermove", 140);
  expect(track.style.transform).toBe("translateX(-60px)");
});

test("with no period drawn beside it, a swipe steps at once, with no settle", () => {
  const onStep = vi.fn();
  const { track, viewport } = render({ next: null, onStep });
  swipe(viewport, -200);
  expect(onStep).toHaveBeenCalledWith(1);
  expect(track.getAnimations()).toEqual([]);
  expect(track.style.transform).toBe("");
});

test("a tap is no swipe: nothing settles, and a swipe right after follows the finger", () => {
  const onStep = vi.fn();
  const { track, viewport } = render({ next: page("2026-11-05"), onStep });
  const at = (type: string, x: number, pointerId: number) =>
    viewport.dispatchEvent(
      new PointerEvent(type, {
        pointerType: "touch",
        isPrimary: true,
        pointerId,
        clientX: x,
        clientY: 150,
        bubbles: true,
      }),
    );
  at("pointerdown", 200, 4);
  at("pointerup", 202, 4);
  expect(onStep).not.toHaveBeenCalled();
  expect(track.getAnimations()).toEqual([]);
  at("pointerdown", 200, 5);
  at("pointermove", 170, 5);
  at("pointermove", 140, 5);
  expect(track.style.transform).toBe("translateX(-60px)");
});

test("a period that comes during a settle, not the swipe's own, ends the settle and slides in", () => {
  const onStep = vi.fn();
  const { track, viewport, show } = render({ next: page("2026-11-05"), onStep });
  swipe(viewport, -200);
  expect(track.getAnimations()).toHaveLength(1);
  // Today pressed while the track still settles on the 5th.
  show("2026-11-01");
  expect(track.getAnimations()).toEqual([]);
  expect(track.style.transform).toBe("");
  const shown = track.querySelector<HTMLElement>("[data-current]")!;
  const [slide] = shown.getAnimations() as CSSAnimation[];
  expect((slide!.effect as KeyframeEffect).getKeyframes()[0]!["transform"]).toBe(
    "translateX(-40px)",
  );
  expect(onStep).not.toHaveBeenCalled();
});

test("another view during a settle fades in, the settle given up", () => {
  const { track, viewport, show } = render({ next: page("2026-11-05"), onStep: vi.fn() });
  swipe(viewport, -200);
  show("2026-11-04", "week");
  expect(track.getAnimations()).toEqual([]);
  const shown = track.querySelector<HTMLElement>("[data-current]")!;
  expect(
    shown
      .getAnimations()
      .map((animation) => (animation.effect as KeyframeEffect).getKeyframes()[0]!["opacity"]),
  ).toEqual(["0"]);
});
