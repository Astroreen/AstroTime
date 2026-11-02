// The tasks screen's motion (design D197) on a list drawn by hand: a change
// that completes one task and deletes another in one read (a sync's) sends
// only the completed one toward "Completed"; the deleted one fades where it
// was. The animations are read from the elements, so nothing waits.
import { afterEach, expect, test } from "vite-plus/test";

import { measure, play } from "../src/components/task-motion.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/** A stage as the tasks screen draws it: a card of rows, "Completed" below, the motion layer. */
function stage(tasks: readonly string[]) {
  const root = document.createElement("div");
  root.style.cssText = "position:relative;width:360px";
  root.innerHTML = `
    <div data-card="undone"><div data-card-background></div>
      ${tasks.map((task) => `<div data-task="${task}" style="height:48px">${task}</div>`).join("")}
    </div>
    <div data-card="completed" style="height:56px"><div data-card-background></div>
      <button>Completed (<span data-completed-count>3</span>)</button>
    </div>
    <div data-motion-layer inert aria-hidden="true" style="position:absolute;inset:0"></div>`;
  document.body.append(root);
  cleanups.push(() => root.remove());
  return root;
}

/** Where a leaving row's animation ends, by its task. */
const leaving = (root: HTMLElement) =>
  Object.fromEntries(
    [...root.querySelectorAll<HTMLElement>("[data-motion-layer] [data-task]")].map((row) => {
      const frames = row.getAnimations()[0]!.effect as KeyframeEffect;
      return [row.dataset["task"], String(frames.getKeyframes().at(-1)!["transform"])];
    }),
  );

test("of two rows that left in one read, only the one now done goes toward Completed", () => {
  const root = stage(["report", "olga", "plants"]);
  const before = measure(root);
  // One read: "report" completed (Completed folded), "olga" deleted.
  root.querySelector('[data-task="report"]')!.remove();
  root.querySelector('[data-task="olga"]')!.remove();
  root.querySelector("[data-completed-count]")!.textContent = "4";
  play(root, before, 0, new Set(["report"]));

  const ends = leaving(root);
  expect(Object.keys(ends).toSorted()).toEqual(["olga", "report"]);
  // Down to the count, which is below the list.
  expect(ends["report"]).toMatch(/^translateY\((\d+(\.\d+)?)px\) scale\(0\.96\)$/);
  expect(Number(/translateY\(([\d.]+)px\)/.exec(ends["report"]!)![1])).toBeGreaterThan(40);
  // Where it was.
  expect(ends["olga"]).toBe("translateY(0px) scale(0.96)");
});
