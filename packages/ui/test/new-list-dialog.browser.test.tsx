// "+ New list"'s dialog (docs/plans/design.md#D276): the list is made where
// chosen, on the account's server (through the sync, providers D275) or on
// this device, and is the one shown after; when it cannot be, the dialog
// says why in words and stays open.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";

import type { Calendar } from "@astrotime/storage";

import { createI18n } from "../src/i18n/index.ts";

const NEXTCLOUD = { id: "nc", provider: "caldav", name: "Nextcloud" };
let accounts: () => Promise<unknown[]> = async () => [NEXTCLOUD];
const saved: unknown[] = [];
/** The store's listeners, told of a write as the store tells its live queries. */
const listeners = new Set<() => void>();
/** What the sync's `makeCalendar` does next, set by each test. */
let make: (accountId: string, calendar: unknown) => Promise<unknown> = async () => ({});
const asked: unknown[] = [];

vi.mock("@astrotime/sync/calendars", () => ({
  makesCalendars: (account: { provider: string }) => account.provider === "caldav",
  makeCalendar: (_context: unknown, accountId: string, calendar: unknown) => {
    asked.push([accountId, calendar]);
    return make(accountId, calendar);
  },
}));
vi.mock("../src/components/accounts-context.tsx", () => {
  const value = {
    store: {
      accounts: () => accounts(),
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      addAccount: async (account: object) => ({ ...account, id: "device" }),
      saveCalendar: async (calendar: object) => {
        saved.push(calendar);
        return { ...calendar, id: "made-here" };
      },
    },
    platform: { http: async () => ({}), secrets: {} },
  };
  return { useAccounts: () => value };
});

const { NewListDialog } = await import("../src/components/new-list-dialog.tsx");

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  accounts = async () => [NEXTCLOUD];
  saved.length = 0;
  asked.length = 0;
});

function render() {
  const made: Calendar[] = [];
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <>
        <output>{open ? "open" : "closed"}</output>
        <button type="button" onClick={() => setOpen(true)}>
          Open
        </button>
        <NewListDialog
          open={open}
          onClose={() => setOpen(false)}
          onMade={(calendar) => made.push(calendar)}
          near="nc"
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
  return made;
}

const dialog = () => page.getByRole("dialog", { name: "New list" });
const create = () => dialog().getByRole("button", { name: "Create" });
/**
 * A click as the button's own event: the page has no stylesheet, so
 * Base UI's guard against presses outside the dialog lies over it.
 */
const press = async (locator: ReturnType<typeof page.getByRole>) => {
  await expect.element(locator).toBeEnabled();
  (locator.element() as HTMLElement).click();
};

test("made on the account's server, a list of tasks; the list made is the one shown, the dialog closed", async () => {
  make = async (accountId, calendar) => ({ id: "made", accountId, ...(calendar as object) });
  const made = render();
  await expect
    .element(dialog().getByRole("combobox", { name: "Where" }))
    .toHaveTextContent("Nextcloud");
  // No name, nothing to make.
  await expect.element(create()).toBeDisabled();
  await userEvent.fill(dialog().getByRole("textbox", { name: "Name" }), "  Errands ");
  await press(create());
  await expect.element(page.getByRole("status")).toHaveTextContent("closed");
  // As typed: the sync's `makeCalendar` sends it trimmed (`calendarNameOf`, providers D275).
  expect(asked).toEqual([["nc", { name: "  Errands ", color: null, component: "VTODO" }]]);
  expect(made.map((calendar) => calendar.id)).toEqual(["made"]);
});

test("the server cannot be reached, or makes no lists: said, and the dialog stays", async () => {
  make = async () => {
    throw Object.assign(new Error("offline"), { name: "OfflineError" });
  };
  const made = render();
  await userEvent.fill(dialog().getByRole("textbox", { name: "Name" }), "Errands");
  await press(create());
  await expect
    .element(dialog().getByRole("alert"))
    .toHaveTextContent(
      "Nextcloud cannot be reached, so the list was not made. Try again once it can.",
    );
  make = async () => {
    throw Object.assign(new Error("no"), {
      name: "CannotMakeCalendarError",
      reason: "unsupported",
    });
  };
  await press(create());
  await expect
    .element(dialog().getByRole("alert"))
    .toHaveTextContent("The server of Nextcloud does not make lists.");
  expect(made).toEqual([]);
});

test("with no account that makes lists, on this device: no place to choose", async () => {
  accounts = async () => [{ id: "demo", provider: "demo", name: "Demo" }];
  const made = render();
  await userEvent.fill(dialog().getByRole("textbox", { name: "Name" }), "Packing");
  await expect.element(dialog().getByRole("combobox")).not.toBeInTheDocument();
  await press(create());
  await expect.element(page.getByRole("status")).toHaveTextContent("closed");
  expect(asked).toEqual([]);
  expect(saved).toMatchObject([{ name: "Packing", components: ["VTODO"], accountId: "device" }]);
  expect(made.map((calendar) => calendar.id)).toEqual(["made-here"]);
});

test("closed while the list is made: opened again it is still being made, no second one; it is shown when made", async () => {
  let finish: (calendar: unknown) => void = () => {};
  make = (accountId, calendar) =>
    new Promise((resolve) => {
      finish = () => resolve({ id: "made", accountId, ...(calendar as object) });
    });
  const made = render();
  await userEvent.fill(dialog().getByRole("textbox", { name: "Name" }), "Errands");
  await press(create());
  await expect
    .element(dialog().getByRole("status"))
    .toHaveTextContent("Making the list on Nextcloud…");
  await press(dialog().getByRole("button", { name: "Cancel" }));
  await expect.element(page.getByText("closed")).toBeInTheDocument();
  await press(page.getByRole("button", { name: "Open" }));
  // Still on its way: said, and "Create" off, so no second list is made.
  await expect
    .element(dialog().getByRole("status"))
    .toHaveTextContent("Making the list on Nextcloud…");
  await expect.element(create()).toBeDisabled();
  finish(null);
  await expect.element(page.getByText("closed")).toBeInTheDocument();
  expect(asked).toHaveLength(1);
  expect(made.map((calendar) => calendar.id)).toEqual(["made"]);
});

test("tried again after a failure: one list made", async () => {
  make = async () => {
    throw Object.assign(new Error("offline"), { name: "OfflineError" });
  };
  const made = render();
  await userEvent.fill(dialog().getByRole("textbox", { name: "Name" }), "Errands");
  await press(create());
  await expect.element(dialog().getByRole("alert")).toBeInTheDocument();
  make = async (accountId, calendar) => ({ id: "made", accountId, ...(calendar as object) });
  await press(create());
  await expect.element(page.getByText("closed")).toBeInTheDocument();
  expect(asked).toHaveLength(2);
  expect(made.map((calendar) => calendar.id)).toEqual(["made"]);
});

test("the accounts not read: said, and the list can still be made on this device", async () => {
  // Not read when the dialog opens (a moment's failure), read again when the list is made.
  accounts = () => {
    accounts = async () => [];
    return Promise.reject(new Error("no store"));
  };
  const made = render();
  await expect
    .element(dialog().getByRole("alert"))
    .toHaveTextContent(
      "The accounts could not be read, so the list can be made on this device only.",
    );
  await userEvent.fill(dialog().getByRole("textbox", { name: "Name" }), "Packing");
  await press(create());
  await expect.element(page.getByText("closed")).toBeInTheDocument();
  expect(saved).toMatchObject([{ name: "Packing", components: ["VTODO"] }]);
  expect(made.map((calendar) => calendar.id)).toEqual(["made-here"]);
});

test("an account added while the dialog is open is offered at once", async () => {
  accounts = async () => [];
  render();
  await expect.element(dialog().getByRole("textbox", { name: "Name" })).toBeVisible();
  await expect.element(dialog().getByRole("combobox")).not.toBeInTheDocument();
  accounts = async () => [NEXTCLOUD];
  for (const listener of listeners) listener();
  await expect
    .element(dialog().getByRole("combobox", { name: "Where" }))
    .toHaveTextContent("Nextcloud");
});

test("a failure said goes once the name is changed", async () => {
  make = async () => {
    throw Object.assign(new Error("offline"), { name: "OfflineError" });
  };
  render();
  const field = dialog().getByRole("textbox", { name: "Name" });
  await userEvent.fill(field, "Errands");
  await press(create());
  await expect.element(dialog().getByRole("alert")).toBeInTheDocument();
  await userEvent.fill(field, "Errands 2");
  await expect.element(dialog().getByRole("alert")).not.toBeInTheDocument();
});

test("a failure said goes once the place changes", async () => {
  make = async () => {
    throw Object.assign(new Error("offline"), { name: "OfflineError" });
  };
  render();
  await userEvent.fill(dialog().getByRole("textbox", { name: "Name" }), "Errands");
  await press(create());
  await expect.element(dialog().getByRole("alert")).toBeInTheDocument();
  const where = dialog().getByRole("combobox", { name: "Where" });
  (where.element() as HTMLElement).focus();
  await userEvent.keyboard("{ArrowDown}");
  const device = page.getByRole("option", { name: "On this device" });
  await expect.element(device).toBeVisible();
  (device.element() as HTMLElement).click();
  await expect.element(where).toHaveTextContent("On this device");
  await expect.element(dialog().getByRole("alert")).not.toBeInTheDocument();
});
