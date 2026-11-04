// The edit dialog's description with "@" (design D208): the people offered
// are those of the account of the item's calendar now, never another's; a
// name with Markdown's marks reads back as it is.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";

import { createI18n } from "../src/i18n/index.ts";

// Each account's server, as `peopleOf` would ask it.
const PEOPLE: Record<string, { name: string; email: string }[]> = {
  work: [{ name: "Anna Work", email: "anna@work.example" }],
  home: [{ name: "Anna Home", email: "anna@home.example" }],
};
const asked: string[] = [];
/**
 * The "home" server answers when the test lets it: the test sees the field
 * between the switch and that answer, whatever the machine's speed.
 */
let homeAnswers = Promise.resolve();
let homeAsked = () => {};
vi.mock("@astrotime/sync/people", () => ({
  peopleOf: async (_context: unknown, accountId: string, query: string) => {
    asked.push(`${accountId} ${query}`);
    if (accountId === "home") {
      homeAsked();
      await homeAnswers;
    }
    return PEOPLE[accountId] ?? [];
  },
}));
// The platform and store stay one each, as the app's do.
vi.mock("../src/components/accounts-context.tsx", () => {
  const accounts = { platform: { http: async () => ({}), secrets: {} }, store: {} };
  return { useAccounts: () => accounts };
});

const { MentionField } = await import("../src/components/mention-field.tsx");

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  asked.length = 0;
  homeAnswers = Promise.resolve();
  homeAsked = () => {};
});

let switchTo: (accountId: string) => void = () => {};
function Field() {
  const [value, setValue] = useState("");
  const [accountId, setAccountId] = useState("work");
  switchTo = setAccountId;
  return (
    <MentionField
      label="Description"
      value={value}
      onChange={setValue}
      accountId={accountId}
      className=""
    />
  );
}

function render() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(
    <I18nextProvider i18n={createI18n("en")}>
      <Field />
    </I18nextProvider>,
  );
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });
}

test("switched to another account's calendar, its own people are offered, never the first's", async () => {
  render();
  const field = page.getByRole("textbox", { name: "Description" });
  const list = page.getByRole("listbox", { name: "People" });
  // A query on the way, as slow typing asks one ("an", then "ann"): always here.
  await userEvent.type(field, "@an");
  await expect.element(list.getByRole("option", { name: /Anna Work/ })).toBeVisible();
  await userEvent.type(field, "n");
  await expect.element(list.getByRole("option", { name: /Anna Work/ })).toBeVisible();
  expect(asked).toContain("work an");
  let answer = () => {};
  homeAnswers = new Promise((resolve) => (answer = resolve));
  const askedHome = new Promise<void>((resolve) => (homeAsked = resolve));
  switchTo("home");
  // The first account's people go at once; the other's have not answered yet.
  await expect.element(list.getByRole("option", { name: /Anna Work/ })).not.toBeInTheDocument();
  await askedHome;
  expect(document.querySelectorAll('[role="option"]')).toHaveLength(0);
  answer();
  await expect.element(list.getByRole("option", { name: /Anna Home/ })).toBeVisible();
  expect(
    list
      .getByRole("option")
      .elements()
      .map((option) => option.textContent),
  ).toEqual(["Anna Homeanna@home.example"]);
  expect(asked.filter((query) => query.startsWith("home"))).toEqual(["home ann"]);
});

test("Enter picks; Tab leaves the field and picks nothing", async () => {
  render();
  const field = page.getByRole("textbox", { name: "Description" });
  await userEvent.type(field, "@ann");
  await expect.element(page.getByRole("option").first()).toBeVisible();
  await userEvent.keyboard("{Tab}");
  await expect.element(field).toHaveValue("@ann");
  expect(document.activeElement).not.toBe(field.element());
  await userEvent.click(field);
  await userEvent.keyboard("{End}");
  await userEvent.type(field, "a");
  await expect.element(page.getByRole("option").first()).toBeVisible();
  await userEvent.keyboard("{Enter}");
  await expect.element(field).toHaveValue("[@Anna Work](mailto:anna@work.example) ");
});
