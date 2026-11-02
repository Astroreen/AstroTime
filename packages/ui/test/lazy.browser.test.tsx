// Dialogs that load with their first opening (docs/plans/foundation.md#D145):
// nothing drawn before, drawn after, the code fetched once, and code that did
// not arrive asked for again.
import { useState, type ComponentType } from "react";
import { I18nextProvider } from "react-i18next";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";

import { deferred } from "../src/components/lazy.tsx";
import { createI18n } from "../src/i18n/index.ts";

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** The dialog the loader gives: a button that closes it, drawn only while open. */
function Dialog({ open, onClose }: Props) {
  return open ? (
    <button type="button" onClick={onClose}>
      The dialog
    </button>
  ) : null;
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Draws `Deferred` behind an "Open" button, its first `failures` loads
 * failing; `loads.count` counts the loader's calls, `loads.reached(n)`
 * settles at the nth.
 */
function render(failures: number) {
  const waiting: [number, () => void][] = [];
  const loads = {
    count: 0,
    reached: (n: number) =>
      new Promise<void>((resolve) => (loads.count >= n ? resolve() : waiting.push([n, resolve]))),
  };
  const Deferred = deferred<Props, ComponentType<Props>>(
    async () => {
      loads.count++;
      for (const [n, resolve] of waiting) if (loads.count >= n) resolve();
      if (loads.count <= failures)
        throw new TypeError("Failed to fetch dynamically imported module");
      return Dialog;
    },
    (component) => component,
    (props) => props.open,
  );
  function Host() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <Deferred open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  root.render(
    <I18nextProvider i18n={createI18n("en")}>
      <Host />
    </I18nextProvider>,
  );
  cleanups.push(() => {
    root.unmount();
    container.remove();
  });
  return loads;
}

test("draws nothing until first open, then the dialog; its code is fetched once", async () => {
  const loads = render(0);
  // Fetched once the page is idle, before any opening.
  await loads.reached(1);
  await expect.element(page.getByRole("button", { name: "The dialog" })).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Open" }));
  await userEvent.click(page.getByRole("button", { name: "The dialog" }));
  await expect.element(page.getByRole("button", { name: "The dialog" })).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Open" }));
  await expect.element(page.getByRole("button", { name: "The dialog" })).toBeVisible();
  expect(loads.count).toBe(1);
});

test("code that did not arrive is asked for again: Try again", async () => {
  // The idle fetch and the opening's both fail; the third, "Try again", arrives.
  const loads = render(2);
  await loads.reached(1);
  await userEvent.click(page.getByRole("button", { name: "Open" }));
  const failed = page.getByRole("alertdialog", { name: /Could not load this part of AstroTime/ });
  await expect.element(failed).toBeVisible();
  expect(loads.count).toBe(2);
  await userEvent.click(failed.getByRole("button", { name: "Try again" }));
  await expect.element(page.getByRole("button", { name: "The dialog" })).toBeVisible();
  expect(loads.count).toBe(3);
});

test("closed after a failure, the next opening asks again", async () => {
  const loads = render(2);
  await loads.reached(1);
  await userEvent.click(page.getByRole("button", { name: "Open" }));
  const failed = page.getByRole("alertdialog", { name: /Could not load/ });
  await userEvent.click(failed.getByRole("button", { name: "Close" }));
  await expect.element(failed).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Open" }));
  await expect.element(page.getByRole("button", { name: "The dialog" })).toBeVisible();
  expect(loads.count).toBe(3);
});
