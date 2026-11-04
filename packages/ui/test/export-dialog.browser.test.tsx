// The export dialog (docs/plans/import.md#D274) says what became of the
// file: not saved when the platform's dialog was turned away, the error
// when saving failed, nothing to export for an empty calendar; and a save
// still on its way when the dialog closed says nothing in its next opening.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";

import type { Calendar } from "@astrotime/storage";

import { createI18n } from "../src/i18n/index.ts";

const EVENT = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//x//EN",
  "BEGIN:VEVENT",
  "UID:meeting",
  "DTSTAMP:20261101T080000Z",
  "DTSTART:20261105T090000Z",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

/** What the platform's next save answers, set by each test. */
let answer: () => Promise<boolean> = async () => true;
const saved: string[] = [];
vi.mock("../src/components/accounts-context.tsx", () => {
  const accounts = {
    store: {
      objectsBetween: async (ids: string[]) => (ids[0] === "work" ? [{ ics: EVENT }] : []),
      undated: async () => [],
    },
    platform: {
      saveFile: (file: { name: string }) => {
        saved.push(file.name);
        return answer();
      },
    },
  };
  return { useAccounts: () => accounts };
});

const { ExportDialog } = await import("../src/components/export-dialog.tsx");

const CALENDARS = [
  { id: "work", name: "Work" },
  { id: "home", name: "Home" },
] as unknown as Calendar[];

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  answer = async () => true;
  saved.length = 0;
});

function render(calendars = CALENDARS) {
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <ExportDialog
          open={open}
          onClose={() => setOpen(false)}
          calendars={calendars}
          colorOf={() => "#4f8fd6"}
        />
      </>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <I18nextProvider i18n={createI18n("en")}>
      <Host />
    </I18nextProvider>,
  );
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });
}

const dialog = () => page.getByRole("dialog", { name: "Export to a file" });
const exportButton = () => dialog().getByRole("button", { name: "Export", exact: true });
/**
 * A click as the button's own event: the page has no stylesheet, so
 * Base UI's guard against presses outside the dialog lies over it.
 */
const press = async (locator: ReturnType<typeof page.getByRole>) => {
  await expect.element(locator).toBeEnabled();
  (locator.element() as HTMLElement).click();
};

test("the platform's dialog turned away: not saved", async () => {
  answer = async () => false;
  render();
  await press(exportButton());
  await expect
    .element(dialog().getByRole("status"))
    .toHaveTextContent("Not saved: the file's place was not chosen.");
  expect(saved).toEqual(["Work.ics"]);
});

test("saving failed: the reason, as an alert", async () => {
  answer = async () => {
    throw new Error("The disk is full.");
  };
  render();
  await press(exportButton());
  await expect
    .element(dialog().getByRole("alert"))
    .toHaveTextContent("The file was not saved: The disk is full.");
});

test("a calendar with nothing in it: nothing to export, and no file", async () => {
  render([CALENDARS[1]!, CALENDARS[0]!]);
  await press(exportButton());
  await expect
    .element(dialog().getByRole("status"))
    .toHaveTextContent("Nothing to export: Home holds no event or task.");
  expect(saved).toEqual([]);
});

test("a save still on its way when the dialog closed says nothing in its next opening", async () => {
  let release: (written: boolean) => void = () => {};
  const asked = new Promise<void>((resolve) => {
    answer = () =>
      new Promise<boolean>((done) => {
        release = done;
        resolve();
      });
  });
  render();
  await press(exportButton());
  // The platform holds the file now; the dialog closes and opens again.
  await asked;
  await press(dialog().getByRole("button", { name: "Close" }).first());
  await expect.element(dialog()).not.toBeInTheDocument();
  await press(page.getByRole("button", { name: "Open" }));
  await expect.element(exportButton()).toBeEnabled();
  release(true);
  // The save's answer has come back by the next event the page takes.
  await userEvent.keyboard("{Shift}");
  expect(document.querySelector("[role=status]")).toBeNull();
});
