// Colours (design D168, D170, D172, D173): the user's own colours made,
// renamed, recoloured and deleted in Settings, each named from its colour
// until the user names it; a default colour for new events; the colour
// dropdown of the edit dialog with a dot left of each name.
import { expect, test, type Locator, type Page } from "@playwright/test";

import { choose, openDemo, WIDE } from "./support.ts";

test.use({ viewport: WIDE });

async function openSettings(page: Page): Promise<Locator> {
  await page
    .getByRole("navigation", { name: /^(Main menu|Главное меню)$/ })
    .getByRole("button", { name: /^(Settings|Настройки)$/ })
    .click();
  return page.getByRole("dialog", { name: /^(Settings|Настройки)$/ });
}

test("an own colour is named from its colour until named by hand, and a generated name comes back on asking", async ({
  page,
}) => {
  await openDemo(page, "week");
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Add a colour" }).click();
  const editor = page.getByRole("dialog", { name: "New colour" });
  const name = editor.getByRole("textbox", { name: "Name" });
  const hex = editor.getByRole("textbox", { name: "Hex code" });
  await hex.fill("#c48b9f");
  await expect(name).toHaveValue("Dusty rose");
  // Every change of the colour names it anew while the name is generated.
  await hex.fill("#00585e");
  await expect(name).toHaveValue("Deep teal");
  const swatch = editor.getByRole("radio").first();
  await swatch.click();
  await expect(swatch).toHaveAttribute("aria-checked", "true");
  await expect(name).toHaveValue((await swatch.getAttribute("aria-label"))!);
  await expect(hex).toHaveValue(/^#[0-9a-f]{6}$/);
  // A hex that is none says so, and nothing can be saved.
  await hex.fill("#12");
  await expect(editor.getByText("Six hex digits after #, such as #3f7be0")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Save" })).toBeDisabled();
  await hex.fill("#c48b9f");
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(editor).toHaveCount(0);
  const row = settings.getByRole("button", { name: "Dusty rose", exact: true });
  await expect(row).toBeVisible();

  // Named by hand: the name stays when the colour changes, until asked for a generated one.
  await row.click();
  const editing = page.getByRole("dialog", { name: "Edit colour" });
  // Spaces typed stay as typed: the generated name does not snap back mid-word.
  await editing.getByRole("textbox", { name: "Name" }).fill(" ");
  await expect(editing.getByRole("textbox", { name: "Name" })).toHaveValue(" ");
  await editing.getByRole("textbox", { name: "Name" }).fill("Lipstick");
  await editing.getByRole("textbox", { name: "Hex code" }).fill("#b22222");
  await expect(editing.getByRole("textbox", { name: "Name" })).toHaveValue("Lipstick");
  await editing.getByRole("button", { name: "Save" }).click();
  await settings.getByRole("button", { name: "Lipstick", exact: true }).click();
  await editing.getByRole("button", { name: "Name it from the colour" }).click();
  await expect(editing.getByRole("textbox", { name: "Name" })).toHaveValue("Red");
  await editing.getByRole("button", { name: "Save" }).click();

  // A generated name speaks the UI's language; kept on this device.
  await choose(settings.getByLabel("Language"), "Русский");
  await expect(settings.getByRole("button", { name: "Красный", exact: true })).toBeVisible();
  await page.reload();
  const again = await openSettings(page);
  await again.getByRole("button", { name: "Красный", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Изменить цвет" })
    .getByRole("button", { name: "Удалить" })
    .click();
  await expect(again.getByRole("button", { name: "Красный", exact: true })).toHaveCount(0);
});

test("a default colour for events is a new event's own colour, chosen with a dot by its name (D168, D172)", async ({
  page,
}) => {
  await openDemo(page, "week");
  const settings = await openSettings(page);
  await settings.getByRole("button", { name: "Add a colour" }).click();
  const editor = page.getByRole("dialog", { name: "New colour" });
  await editor.getByRole("textbox", { name: "Hex code" }).fill("#c48b9f");
  await editor.getByRole("button", { name: "Save" }).click();
  // The dropdown: the calendar's colour first, the palette, then the user's own.
  const events = settings.getByRole("combobox", { name: "Colour of new events" });
  await expect(events).toHaveText("The calendar's colour");
  await events.click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options.first()).toHaveText("The calendar's colour");
  await expect(options.last()).toHaveText("Dusty rose");
  await options.last().click();
  await expect(events).toHaveText("Dusty rose");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Create" }).click();
  // Its title says the kind: "New event", "New task".
  const dialog = page.getByRole("dialog", { name: /^New (event|task)$/ });
  const colour = dialog.getByRole("combobox", { name: "Colour" });
  await expect(colour).toHaveText("Dusty rose");
  // A task starts in the calendar's colour: its own default is unset.
  await dialog.getByRole("radio", { name: "Task" }).click();
  await expect(colour).toHaveText("The calendar's colour");
  await dialog.getByRole("radio", { name: "Event" }).click();
  await expect(colour).toHaveText("Dusty rose");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Pottery");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  const drawn = page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("listitem", { name: /^Pottery, / });
  await expect(drawn).toHaveAttribute("style", /--item: #c48b9f/);

  // Its edit dialog shows the colour by its name; a palette colour replaces it.
  // Opened as the editing tests open an item: its button, its details, then Edit.
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Pottery, / })
    .click();
  const details = page.getByRole("dialog", { name: "Pottery" });
  await expect(details).toBeVisible();
  await details.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  await expect(edit.getByRole("combobox", { name: "Colour" })).toHaveText("Dusty rose");
  await choose(edit.getByRole("combobox", { name: "Colour" }), "Pink");
  await edit.getByRole("button", { name: "Save" }).click();
  await expect(drawn).toHaveAttribute("style", /--item: palevioletred/);

  // Recoloured, the own colour is still the default: by its id, not its hex.
  const again = await openSettings(page);
  await again.getByRole("button", { name: "Dusty rose", exact: true }).click();
  const recolour = page.getByRole("dialog", { name: "Edit colour" });
  await recolour.getByRole("textbox", { name: "Hex code" }).fill("#00585e");
  await recolour.getByRole("button", { name: "Save" }).click();
  await expect(again.getByRole("combobox", { name: "Colour of new events" })).toHaveText(
    "Deep teal",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Create" }).click();
  await expect(dialog.getByRole("combobox", { name: "Colour" })).toHaveText("Deep teal");
});

test("a colour chosen in the dialog stays through a switch of kind, the default's own too; two own colours of one hex are two entries (D168, D172)", async ({
  page,
}) => {
  await openDemo(page, "week");
  const settings = await openSettings(page);
  for (const name of ["Rose one", "Rose two"]) {
    await settings.getByRole("button", { name: "Add a colour" }).click();
    const editor = page.getByRole("dialog", { name: "New colour" });
    await editor.getByRole("textbox", { name: "Hex code" }).fill("#c48b9f");
    // Spaces around a hand-written name are not kept (design D170).
    await editor.getByRole("textbox", { name: "Name" }).fill(`  ${name} `);
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(editor).toHaveCount(0);
  }
  // Stored without the spaces typed around them.
  const stored = await page.evaluate(() =>
    (
      JSON.parse(localStorage.getItem("astrotime.settings") ?? "{}") as {
        colors?: { name: string | null }[];
      }
    ).colors?.map((color) => color.name),
  );
  expect(stored).toEqual(["Rose one", "Rose two"]);
  await choose(settings.getByRole("combobox", { name: "Colour of new events" }), "Rose one");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: /^New (event|task)$/ });
  const colour = dialog.getByRole("combobox", { name: "Colour" });
  await expect(colour).toHaveText("Rose one");
  await colour.click();
  const options = page.getByRole("listbox").getByRole("option");
  await expect(options.filter({ hasText: /^Rose (one|two)$/ })).toHaveText([
    "Rose one",
    "Rose two",
  ]);
  // Chosen by hand, the very colour the default gave: a switch of kind keeps it.
  await page.getByRole("option", { name: "Rose one", exact: true }).click();
  await dialog.getByRole("radio", { name: "Task" }).click();
  await expect(colour).toHaveText("Rose one");
});
