// The file picker (design D234) over a store of files made here: a folder
// opens, the arrow goes up, a file is picked as its ATTACH; files that
// cannot be reached say so, and try again.
import type { FileStore, NewAttachment, RemoteFile } from "@astrotime/core";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";

import { FileBrowser } from "../src/components/file-picker.tsx";
import { createI18n } from "../src/i18n/index.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The app's stylesheet lifts a dialog above Base UI's own backdrop; these
// tests load no CSS, so a dialog's buttons get the clicks only with this
// (as in app.browser.test.tsx).
const lift = document.createElement("style");
lift.textContent = "[role=dialog] { position: relative; z-index: 1; }";
document.head.append(lift);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const file = (path: string, type: string, size: number): RemoteFile => ({
  path,
  name: path.split("/").at(-1)!,
  folder: false,
  type,
  size,
  attachment: { uri: `https://cloud.example.com/index.php/f/${size}`, name: path, type, size },
});
const folder = (path: string): RemoteFile => ({
  path,
  name: path.split("/").at(-1)!,
  folder: true,
  type: null,
  size: null,
  attachment: null,
});

/** Files kept here; `failing` refuses the first `failing` listings. */
function store(failing = 0): FileStore & { readonly asked: string[] } {
  const asked: string[] = [];
  const tree: Record<string, RemoteFile[]> = {
    "/": [folder("/Calendar"), file("/Readme.md", "text/markdown", 1_200)],
    "/Calendar": [file("/Calendar/Q3 report.pdf", "application/pdf", 482_133)],
  };
  return {
    asked,
    list: async (path) => {
      asked.push(path);
      if (asked.length <= failing) throw new Error("offline");
      return tree[path] ?? [];
    },
  };
}

function render(files: FileStore | (() => Promise<FileStore | null>)) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  const picked: NewAttachment[] = [];
  act(() =>
    root.render(
      <I18nextProvider i18n={createI18n("en")}>
        <FileBrowser
          open
          files={typeof files === "function" ? files : async () => files}
          onPick={(a) => picked.push(a)}
          onClose={() => {}}
        />
      </I18nextProvider>,
    ),
  );
  return picked;
}

test("a folder opens and the arrow goes up; a file is picked as the ATTACH it becomes", async () => {
  const files = store();
  const picked = render(files);
  const dialog = page.getByRole("dialog", { name: "Choose a file" });
  // Each file with its kind and size (the size's space is the language's, a no-break one).
  await expect
    .element(dialog.getByRole("button", { name: /Readme\.md/ }).getByText(/^MD · 1\.2\skB$/))
    .toBeInTheDocument();
  await userEvent.click(dialog.getByRole("button", { name: "Calendar" }));
  const report = dialog.getByRole("button", { name: /Q3 report\.pdf/ });
  await expect.element(report.getByText(/^PDF · 482\skB$/)).toBeInTheDocument();
  await userEvent.click(dialog.getByRole("button", { name: "Up a folder" }));
  await expect.element(dialog.getByRole("button", { name: /Readme\.md/ })).toBeInTheDocument();
  await userEvent.click(dialog.getByRole("button", { name: "Calendar" }));
  await userEvent.click(report);
  expect(picked).toEqual([
    {
      uri: "https://cloud.example.com/index.php/f/482133",
      name: "/Calendar/Q3 report.pdf",
      type: "application/pdf",
      size: 482_133,
    },
  ]);
  expect(files.asked).toEqual(["/", "/Calendar", "/", "/Calendar"]);
});

test("files that cannot be reached say so; trying again lists them", async () => {
  render(store(1));
  const dialog = page.getByRole("dialog", { name: "Choose a file" });
  await expect
    .element(dialog.getByRole("alert").getByText("Your files could not be reached."))
    .toBeInTheDocument();
  await userEvent.click(dialog.getByRole("button", { name: "Try again" }));
  await expect.element(dialog.getByRole("button", { name: "Calendar" })).toBeInTheDocument();
});

test("trying again opens the files anew: an opening that failed is not awaited again", async () => {
  let openings = 0;
  const files = store();
  render(async () => {
    openings += 1;
    if (openings === 1) throw new Error("offline");
    return files;
  });
  const dialog = page.getByRole("dialog", { name: "Choose a file" });
  await expect
    .element(dialog.getByRole("alert").getByText("Your files could not be reached."))
    .toBeInTheDocument();
  await userEvent.click(dialog.getByRole("button", { name: "Try again" }));
  await expect.element(dialog.getByRole("button", { name: "Calendar" })).toBeInTheDocument();
  expect(openings).toBe(2);
});
