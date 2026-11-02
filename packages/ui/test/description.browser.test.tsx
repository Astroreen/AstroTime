// A description's checklist (design D207) as a screen reader meets it:
// each box named by its own line, an empty one named all the same.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test } from "vite-plus/test";

import { Description } from "../src/components/description.tsx";
import { createI18n } from "../src/i18n/index.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function drawn(text: string): HTMLElement {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const i18n = createI18n("en");
  act(() =>
    root.render(
      <I18nextProvider i18n={i18n}>
        <Description text={text} />
      </I18nextProvider>,
    ),
  );
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

/** A box's name, from what names it. */
function nameOf(box: Element): string {
  const by = box.getAttribute("aria-labelledby");
  return by
    ? (document.getElementById(by)?.textContent ?? "")
    : (box.getAttribute("aria-label") ?? "");
}

test("each box is named by its own line, not by the list nested under it; an empty one by its words", () => {
  const host = drawn("- [x] Pack\n  - socks\n- [ ]");
  const boxes = [...host.querySelectorAll('[role="checkbox"]')];
  expect(boxes.map((box) => box.getAttribute("aria-checked"))).toEqual(["true", "false"]);
  expect(boxes.map(nameOf)).toEqual(["Pack", "An empty item"]);
});

test("a code block, which scrolls sideways, is reached by the keyboard and named", () => {
  const host = drawn("```\nconst a = 1;\n```");
  const code = host.querySelector("pre")!;
  expect(code.tabIndex).toBe(0);
  expect(code.getAttribute("aria-label")).toBe("Code");
});
