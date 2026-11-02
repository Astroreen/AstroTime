// A swipe whose listeners are attached again while the finger is down
// (design D152): React's Strict Mode does so after mounting, in development,
// at a moment a busy machine stretches. Here they are attached again at a
// known point, a new ref, so nothing depends on how busy the machine is.
import { createRef, useMemo, type RefObject } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { useSwipe } from "../src/hooks.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function Surface({ generation, onEnd }: { generation: number; onEnd: (dx: number) => void }) {
  // A new ref each generation: the swipe's listeners are attached anew.
  const refs = useMemo(() => new Map<number, RefObject<HTMLDivElement | null>>(), []);
  if (!refs.has(generation)) refs.set(generation, createRef<HTMLDivElement>());
  const ref = refs.get(generation)!;
  useSwipe(ref, { onEnd });
  return <div ref={ref} style={{ width: 400, height: 300 }} data-surface="" />;
}

test("a swipe whose listeners are attached again while the finger is down still ends", () => {
  const onEnd = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });
  flushSync(() => root.render(<Surface generation={0} onEnd={onEnd} />));
  const surface = host.querySelector<HTMLElement>("[data-surface]")!;
  const finger = (type: string, x: number) =>
    surface.dispatchEvent(
      new PointerEvent(type, {
        pointerType: "touch",
        isPrimary: true,
        pointerId: 3,
        clientX: x,
        clientY: 100,
        bubbles: true,
      }),
    );
  finger("pointerdown", 300);
  flushSync(() => root.render(<Surface generation={1} onEnd={onEnd} />));
  // The same element, its listeners new.
  expect(host.querySelector("[data-surface]")).toBe(surface);
  finger("pointerup", 120);
  expect(onEnd).toHaveBeenCalledTimes(1);
  expect(onEnd.mock.calls[0]![0]).toBe(-180);
});
