// `useNow` while the page is hidden (docs/plans/foundation.md#D182): no timer
// runs, and the time is right at once when the page is shown again. The
// clock is vitest's, moved by hand; the page is hidden as the browser does.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";

import { useNow } from "../src/hooks.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

/** Hides or shows the page, its re-render done before this returns. */
function setShown(shown: boolean) {
  Object.defineProperty(document, "visibilityState", {
    value: shown ? "visible" : "hidden",
    configurable: true,
  });
  flushSync(() => document.dispatchEvent(new Event("visibilitychange")));
}

function Clock() {
  const { today, minutes } = useNow("UTC");
  return <output>{`${today} ${minutes}`}</output>;
}

test("the clock stops while the page is hidden and is right at once when shown", () => {
  vi.useFakeTimers({
    now: new Date("2026-11-04T10:40:00Z"),
    toFake: ["Date", "setInterval", "clearInterval"],
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => {
    root.unmount();
    host.remove();
    setShown(true);
  });
  flushSync(() => root.render(<Clock />));
  const shown = () => host.querySelector("output")!.textContent;
  expect(shown()).toBe("2026-11-04 640");
  expect(vi.getTimerCount()).toBe(1);

  setShown(false);
  // No timer while hidden: ten minutes pass, and nothing runs.
  expect(vi.getTimerCount()).toBe(0);
  flushSync(() => vi.advanceTimersByTime(10 * 60_000));
  expect(shown()).toBe("2026-11-04 640");

  setShown(true);
  expect(shown()).toBe("2026-11-04 650");
  expect(vi.getTimerCount()).toBe(1);
});
