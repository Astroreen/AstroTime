// AstroTime's own dropdowns (design D167): `Select` says "Not chosen" for a
// value no option has, never a blank button; `MenuButton` runs the action
// chosen and keeps no value; the colour dropdown names an item's own colour
// that is none of its entries (D168).
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";

import { ColorSelect } from "../src/components/color-select.tsx";
import { MenuButton, Select } from "../src/components/select.tsx";
import { createI18n } from "../src/i18n/index.ts";
import { DEFAULT_SETTINGS, SettingsContext } from "../src/settings.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(<I18nextProvider i18n={createI18n("en")}>{node}</I18nextProvider>);
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });
}

const CALENDARS = [
  { value: "work", label: "Work" },
  { value: "home", label: "Home" },
];

test("a value no option has reads 'Not chosen'; choosing an option gives its value", async () => {
  function Host() {
    const [value, setValue] = useState("gone");
    return (
      <>
        <Select label="Calendar" value={value} onChange={setValue} options={CALENDARS} />
        <output>{value}</output>
      </>
    );
  }
  render(<Host />);
  const field = page.getByRole("combobox", { name: "Calendar" });
  await expect.element(field).toHaveTextContent("Not chosen");
  await field.click();
  await page.getByRole("option", { name: "Home" }).click();
  await expect.element(field).toHaveTextContent("Home");
  await expect.element(page.getByRole("status")).toHaveTextContent("home");
});

test("a menu button runs the chosen action with its value and keeps its own label", async () => {
  const chosen: string[] = [];
  render(
    <MenuButton
      label="Add a reminder"
      options={[
        { value: "600", label: "10 minutes before" },
        { value: "3600", label: "1 hour before" },
      ]}
      onChoose={(value) => chosen.push(value)}
    />,
  );
  const button = page.getByRole("button", { name: "Add a reminder" });
  await button.click();
  await page.getByRole("menuitem", { name: "1 hour before" }).click();
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  expect(chosen).toEqual(["3600"]);
  await expect.element(button).toHaveTextContent("Add a reminder");
  // By keys too: Enter opens it, arrows move, Enter runs.
  (button.element() as HTMLElement).focus();
  await userEvent.keyboard("{Enter}");
  await expect
    .element(page.getByRole("menuitem", { name: "10 minutes before" }))
    .toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
  expect(chosen).toEqual(["3600", "600"]);
});

test("an item's own CSS name outside the palette is named from its hex, in the UI's language (D168)", async () => {
  render(
    <SettingsContext.Provider value={{ settings: DEFAULT_SETTINGS, change: () => {} }}>
      <ColorSelect label="Colour" value="darkkhaki" onChange={() => {}} calendarColor="#4f8fd6" />
    </SettingsContext.Provider>,
  );
  const field = page.getByRole("combobox", { name: "Colour" });
  // #bdb76b, named by D170 as a yellow, never "Its own colour".
  await expect.element(field).toHaveTextContent("Yellow");
  await field.click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect.element(options.last()).toHaveTextContent("Yellow");
  expect(options.elements().map((option) => option.textContent)).toContain("The calendar's colour");
  await userEvent.keyboard("{Escape}");
});

test("a default naming an own colour that is gone reads as the calendar's colour (D172)", async () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    defaultColors: { event: "own:gone", task: null },
    colors: [{ id: "kept", hex: "#00585e", name: "Sea" }],
  };
  render(
    <SettingsContext.Provider value={{ settings, change: () => {} }}>
      <ColorSelect
        label="Colour of new events"
        value={settings.defaultColors.event}
        onChange={() => {}}
        calendarColor={null}
        ownById
      />
    </SettingsContext.Provider>,
  );
  const field = page.getByRole("combobox", { name: "Colour of new events" });
  await expect.element(field).toHaveTextContent("The calendar's colour");
  await field.click();
  const options = page.getByRole("listbox").getByRole("option");
  // The own colour still there is offered; nothing stands for the one gone.
  await expect.element(options.last()).toHaveTextContent("Sea");
  expect(options.elements().map((option) => option.textContent)).not.toContain("Its own colour");
  await userEvent.keyboard("{Escape}");
});
