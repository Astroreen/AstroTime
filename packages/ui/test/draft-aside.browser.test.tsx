// Where the edit dialog stands beside its draft (design D187), measured in a
// real browser: a closing dialog keeps its place while it fades, its draft
// gone already.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { page } from "vite-plus/test/browser/context";
import { afterEach, expect, test } from "vite-plus/test";

import { useDraftAside } from "../src/components/draft-aside.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function Dialog({ open }: { open: boolean }) {
  const aside = useDraftAside(open);
  return <output>{aside ? `${aside.side} ${aside.draft}` : "middle"}</output>;
}

test("a closing dialog keeps its aside: its draft is gone, and it fades where it stood", async () => {
  await page.viewport(1000, 800);
  const main = document.createElement("main");
  const draft = document.createElement("div");
  draft.dataset["draft"] = "";
  draft.style.cssText = "position:fixed;top:300px;left:100px;width:130px;height:24px";
  main.append(draft);
  const host = document.createElement("div");
  document.body.append(main, host);
  const root = createRoot(host);
  cleanups.push(() => {
    root.unmount();
    main.remove();
    host.remove();
  });
  flushSync(() => root.render(<Dialog open />));
  await expect.element(page.getByRole("status")).toHaveTextContent("right 100,230");
  // Closed: the views take the draft away, and the dialog renders closed.
  draft.remove();
  flushSync(() => root.render(<Dialog open={false} />));
  expect(host.textContent).toBe("right 100,230");
});
