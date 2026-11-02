// Editing end to end on the demo data with the clock frozen on Wednesday,
// November 4, 2026, 10:40 in Vilnius (docs/plans/foundation.md#pr-6--editing):
// creating with "+" and on an empty slot, the details and edit dialogs, the
// scope of an occurrence's edit and deletion (D11), tasks, a read-only
// calendar, and the Conflicts list (D6).
import { expect, test, type Locator, type Page } from "@playwright/test";

import { choose, openDemo, PHONE, WIDE } from "./support.ts";

test.use({ viewport: WIDE });

const day = (page: Page, name: string) => page.getByRole("list", { name });
const item = (page: Page, dayName: string, name: string | RegExp) =>
  day(page, dayName).getByRole("listitem", { name });
const opener = (page: Page, dayName: string, name: string | RegExp) =>
  day(page, dayName).getByRole("button", { name });

/** Runs one action of the details' "More actions" menu (design D163). */
async function act(details: Locator, action: string) {
  await details.getByRole("button", { name: "More actions" }).click();
  await details.page().getByRole("menuitem", { name: action }).click();
}

/** Opens an item's details, then its edit dialog. */
async function editItem(page: Page, dayName: string, name: RegExp, title: string) {
  await opener(page, dayName, name).click();
  await page.getByRole("dialog", { name: title }).getByRole("button", { name: "Edit" }).click();
  return page.getByRole("dialog", { name: "Edit event" });
}

test('"+" creates an event on the day shown from the next half hour; it shows in Week, Month and Agenda', async ({
  page,
}) => {
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  // Google's prefill: today, from the next half hour after 10:40, an hour long.
  await expect(dialog.getByLabel("Start date")).toHaveValue("2026-11-04");
  await expect(dialog.getByLabel("Start time")).toHaveText("11:00 AM");
  await expect(dialog.getByLabel("End time")).toHaveText("12:00 PM");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Haircut");
  // A new start keeps the length; Sunday, which has room in the Month view.
  await choose(dialog.getByLabel("Start time"), "5:00 PM");
  await expect(dialog.getByLabel("End time")).toHaveText("6:00 PM");
  await dialog.getByLabel("Start date").fill("2026-11-01");
  await expect(dialog.getByLabel("End date")).toHaveValue("2026-11-01");
  await choose(dialog.getByRole("combobox", { name: "Calendar" }), "Personal");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(item(page, "Sunday, November 1", "Haircut, 5:00 – 6:00 PM")).toBeVisible();
  await page.keyboard.press("m");
  await expect(item(page, "Sunday, November 1", "Haircut, 5:00 – 6:00 PM")).toBeVisible();
  await page.keyboard.press("a");
  await expect(item(page, "Sunday, November 1", "Haircut, 5:00 – 6:00 PM")).toBeAttached();
});

test("a reminder picked from the menu is saved with the item and shown in its details (design D167)", async ({
  page,
}) => {
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Call the bank");
  await dialog.getByRole("button", { name: "Add a reminder" }).click();
  await page.getByRole("menuitem", { name: "10 minutes before" }).click();
  await expect(dialog.getByRole("list", { name: "Reminders" }).getByRole("listitem")).toHaveText([
    "10 minutes before",
  ]);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await opener(page, "Wednesday, November 4", /^Call the bank, /).click();
  const details = page.getByRole("dialog", { name: "Call the bank" });
  await expect(details.getByText("10 minutes before", { exact: true })).toBeVisible();
});

for (const [size, viewport] of [
  ["phone", PHONE],
  ["wide", WIDE],
] as const) {
  test(`every row's icon is level with the middle of its control, labelled or not, on a ${size} (design D205)`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openDemo(page, "week");
    await page.getByRole("button", { name: "Create" }).click();
    const dialog = page.getByRole("dialog", { name: "New event" });
    await dialog.getByRole("button", { name: "Add a reminder" }).click();
    await page.getByRole("menuitem", { name: "10 minutes before" }).click();
    const list = dialog.getByRole("list", { name: "Reminders" });
    const allDay = dialog.getByRole("switch", { name: "All day" });
    // Each control and the box its row's icon is levelled with: the switch's
    // is its 40 px row, "All day" beside it.
    const rows: (readonly [Locator, Locator?])[] = [
      [allDay, allDay.locator("xpath=parent::label")],
      [dialog.getByRole("combobox", { name: "Repeat" })],
      [list.getByRole("listitem").first()],
      [dialog.getByRole("combobox", { name: "Calendar" })],
      [dialog.getByRole("combobox", { name: "Colour" })],
      [dialog.getByRole("combobox", { name: "Location" })],
    ];
    for (const [control, measured = control] of rows) {
      // The row's icon: the hidden one before the column the control is in.
      const icon = control.locator(
        "xpath=ancestor::div[contains(@class, 'items-start')][1]/span[@aria-hidden='true']",
      );
      const box = await measured.boundingBox();
      const drawn = await icon.boundingBox();
      expect(box && drawn).toBeTruthy();
      const middle = box!.y + box!.height / 2;
      expect(Math.abs(drawn!.y + drawn!.height / 2 - middle)).toBeLessThanOrEqual(1);
    }
  });
}

test("the reminder menu offers four, the most added first; Custom… adds any amount before (design D206)", async ({
  page,
}) => {
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Visa appointment");
  // Nothing added on this device yet: Google's defaults.
  await dialog.getByRole("button", { name: "Add a reminder" }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "10 minutes before",
    "30 minutes before",
    "1 hour before",
    "1 day before",
    "Custom…",
  ]);
  await page.getByRole("menuitem", { name: "Custom…" }).click();
  const custom = dialog.getByRole("group", { name: "Custom reminder" });
  await custom.getByRole("spinbutton", { name: "How many" }).fill("2");
  await choose(custom.getByRole("combobox", { name: "Unit" }), "weeks");
  await expect(custom.getByText("2 weeks before", { exact: true })).toBeVisible();
  await custom.getByRole("button", { name: "Add" }).click();
  await expect(custom).toHaveCount(0);
  // Another, by Enter in the amount: it adds, it does not save the item.
  await dialog.getByRole("button", { name: "Add a reminder" }).click();
  await page.getByRole("menuitem", { name: "Custom…" }).click();
  await custom.getByRole("spinbutton", { name: "How many" }).fill("4");
  await choose(custom.getByRole("combobox", { name: "Unit" }), "days");
  await custom.getByRole("spinbutton", { name: "How many" }).press("Enter");
  await expect(dialog.getByRole("list", { name: "Reminders" }).getByRole("listitem")).toHaveText([
    "2 weeks before",
    "4 days before",
  ]);
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await opener(page, "Wednesday, November 4", /^Visa appointment, /).click();
  const details = page.getByRole("dialog", { name: "Visa appointment" });
  await expect(details.getByText("2 weeks before", { exact: true })).toBeVisible();
  await expect(details.getByText("4 days before", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  // The next item, after a reload, offers what this device adds, the latest of a tie first.
  await page.reload();
  await expect(opener(page, "Wednesday, November 4", /^Design review, /)).toBeVisible();
  await page.getByRole("button", { name: "Create" }).click();
  await dialog.getByRole("button", { name: "Add a reminder" }).click();
  await expect(page.getByRole("menuitem")).toHaveText([
    "4 days before",
    "2 weeks before",
    "10 minutes before",
    "30 minutes before",
    "Custom…",
  ]);
  await page.keyboard.press("Escape");
  // An all-day item: days or weeks before, at a time of the day.
  await dialog.getByRole("switch", { name: "All day" }).click();
  await dialog.getByRole("button", { name: "Add a reminder" }).click();
  await page.getByRole("menuitem", { name: "Custom…" }).click();
  await custom.getByRole("spinbutton", { name: "How many" }).fill("2");
  await choose(custom.getByRole("combobox", { name: "Unit" }), "weeks");
  await choose(custom.getByRole("combobox", { name: "Time" }), "6:30 PM");
  await custom.getByRole("button", { name: "Add" }).click();
  await expect(dialog.getByRole("list", { name: "Reminders" }).getByRole("listitem")).toHaveText([
    "2 weeks before at 6:30 PM",
  ]);
  // One the item has already is not added twice, and the picker says so.
  await dialog.getByRole("button", { name: "Add a reminder" }).click();
  await page.getByRole("menuitem", { name: "Custom…" }).click();
  await custom.getByRole("spinbutton", { name: "How many" }).fill("2");
  await choose(custom.getByRole("combobox", { name: "Unit" }), "weeks");
  await choose(custom.getByRole("combobox", { name: "Time" }), "6:30 PM");
  await expect(custom.getByText("The item already has this reminder")).toBeVisible();
  await expect(custom.getByRole("button", { name: "Add" })).toBeDisabled();
  await custom.getByRole("spinbutton", { name: "How many" }).press("Enter");
  await expect(custom).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Reminders" }).getByRole("listitem")).toHaveCount(
    1,
  );
});

test("the tally counts a saved item's reminders only, each under the kind it was added to (design D206)", async ({
  page,
}) => {
  await openDemo(page, "week");
  const dialog = page.getByRole("dialog", { name: "New event" });
  const custom = dialog.getByRole("group", { name: "Custom reminder" });
  const offers = async (items: readonly string[]) => {
    await dialog.getByRole("button", { name: "Add a reminder" }).click();
    await expect(page.getByRole("menuitem")).toHaveText([...items, "Custom…"]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  };
  const addCustom = async (amount: string, unit: string) => {
    await dialog.getByRole("button", { name: "Add a reminder" }).click();
    await page.getByRole("menuitem", { name: "Custom…" }).click();
    const field = custom.getByRole("spinbutton", { name: "How many" });
    // Emptied, it stays empty while the next amount is typed; nothing to add yet.
    await field.fill("");
    await expect(field).toHaveValue("");
    await expect(custom.getByText("Type how many")).toBeVisible();
    await expect(custom.getByRole("button", { name: "Add" })).toBeDisabled();
    await field.fill(amount);
    await choose(custom.getByRole("combobox", { name: "Unit" }), unit);
    await custom.getByRole("button", { name: "Add" }).click();
  };
  const defaults = ["10 minutes before", "30 minutes before", "1 hour before", "1 day before"];

  // A save refused (the end before the start) and the dialog closed: nothing counted.
  await page.getByRole("button", { name: "Create" }).click();
  await addCustom("5", "hours");
  await dialog.getByLabel("End date").fill("2026-11-03");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The end must be after the start.");
  await dialog.getByRole("button", { name: "Close without saving" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Create" }).click();
  await offers(defaults);

  // Added to a timed item, then "All day" switched on and saved: a timed reminder still.
  await addCustom("3", "hours");
  await dialog.getByRole("switch", { name: "All day" }).click();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Create" }).click();
  await offers(["3 hours before", ...defaults.slice(0, 3)]);
  await dialog.getByRole("switch", { name: "All day" }).click();
  await offers([
    "On the day at 9:00 AM",
    "1 day before at 9:00 AM",
    "2 days before at 9:00 AM",
    "1 week before at 9:00 AM",
  ]);
});

test("the details read the description as Markdown; the editor keeps it as typed (design D207)", async ({
  page,
}) => {
  await openDemo(page, "week");
  await opener(page, "Wednesday, November 4", /^Budget planning, /).click();
  const details = page.getByRole("dialog", { name: "Budget planning" });
  await expect(details.getByRole("heading", { name: "Agenda", level: 4 })).toBeVisible();
  await expect(details.getByRole("checkbox", { name: "Last quarter's actuals" })).toBeChecked();
  await expect(details.getByRole("checkbox", { name: "Next year's draft" })).not.toBeChecked();
  await expect(details.getByRole("checkbox", { name: "Next year's draft" })).toHaveAttribute(
    "aria-readonly",
    "true",
  );
  await expect(details.locator("strong")).toHaveText("actuals");
  await expect(details.locator("code")).toHaveText("travel.ods");
  await expect(details.locator("blockquote")).toHaveText("Bring the numbers, not the slides.");
  const link = details.getByRole("link", { name: "The sheet" });
  await expect(link).toHaveAttribute("href", "https://example.com/budget");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  // The text itself is what was written, Markdown and all.
  await details.getByRole("button", { name: "Edit" }).click();
  await expect(
    page.getByRole("dialog", { name: "Edit event" }).getByRole("textbox", { name: "Description" }),
  ).toHaveValue(
    "## Agenda\n- [x] Last quarter's **actuals**\n- [ ] Next year's *draft*\n- Travel, see `travel.ods`\n\n> Bring the numbers, not the slides.\n\n[The sheet](https://example.com/budget)",
  );
});

test("Enter in the title saves; a tap on an empty slot of the grid creates there", async ({
  page,
}) => {
  await openDemo(page, "day");
  const column = day(page, "Wednesday, November 4");
  // 2:15 PM in a 56-pixel hour: the half hour from 2:00.
  const box = (await column.boundingBox())!;
  await column.click({ position: { x: box.width - 10, y: 14.25 * 56 } });
  const dialog = page.getByRole("dialog", { name: "New event" });
  await expect(dialog.getByLabel("Start time")).toHaveText("2:00 PM");
  await expect(dialog.getByLabel("End time")).toHaveText("3:00 PM");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Call the plumber");
  await dialog.getByRole("textbox", { name: "Title" }).press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(
    item(page, "Wednesday, November 4", "Call the plumber, 2:00 – 3:00 PM"),
  ).toBeVisible();
});

test("an end before the start is refused, in words; Escape closes without saving", async ({
  page,
}) => {
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Create" }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Backwards");
  await choose(dialog.getByLabel("End time"), "10:00 AM");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("The end must be after the start.");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("listitem", { name: /^Backwards/ })).toHaveCount(0);
});

test("the details of an event show where, the description's link, the reminder, the guests and the calendar; edit changes title and time", async ({
  page,
}) => {
  await openDemo(page, "week");
  await opener(page, "Wednesday, November 4", /^Design review, /).click();
  const details = page.getByRole("dialog", { name: "Design review" });
  await expect(details.getByText("Wednesday, November 4 · 10:00 – 11:30 AM")).toBeVisible();
  await expect(details.getByText("Room 4, second floor")).toBeVisible();
  await expect(details.getByRole("link", { name: "https://example.com/review" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await expect(details.getByText("10 minutes before")).toBeVisible();
  await expect(details.getByText("Marta Lind")).toBeVisible();
  await expect(details.getByText("Calendar: Work")).toBeVisible();

  await details.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit event" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("Design review, round 2");
  await choose(dialog.getByLabel("Start time"), "4:00 PM");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(details).toHaveCount(0);
  await expect(
    item(page, "Wednesday, November 4", "Design review, round 2, 4:00 – 5:30 PM"),
  ).toBeVisible();
});

test.describe("an occurrence of a series asks the scope (D11)", () => {
  test("this occurrence: only Thursday's stand-up changes", async ({ page }) => {
    await openDemo(page, "week");
    const dialog = await editItem(page, "Thursday, November 5", /^Stand-up, /, "Stand-up");
    await dialog.getByRole("textbox", { name: "Title" }).fill("Stand-up, short");
    await dialog.getByRole("button", { name: "Save" }).click();
    const scope = page.getByRole("alertdialog", { name: "Edit recurring event" });
    await expect(scope.getByRole("radio", { name: "This occurrence" })).toBeChecked();
    await scope.getByRole("button", { name: "OK" }).click();
    await expect(item(page, "Thursday, November 5", /^Stand-up, short, /)).toBeVisible();
    await expect(item(page, "Friday, November 6", /^Stand-up, 9:00/)).toBeVisible();
    await expect(item(page, "Wednesday, November 4", /^Stand-up, 9:00/)).toBeVisible();
  });

  test("all occurrences: a new time moves the whole series", async ({ page }) => {
    await openDemo(page, "week");
    const dialog = await editItem(page, "Friday, November 6", /^Stand-up, /, "Stand-up");
    await choose(dialog.getByLabel("Start time"), "9:15 AM");
    await dialog.getByRole("button", { name: "Save" }).click();
    const scope = page.getByRole("alertdialog", { name: "Edit recurring event" });
    await scope.getByRole("radio", { name: "All occurrences" }).check();
    await scope.getByRole("button", { name: "OK" }).click();
    for (const name of ["Monday, November 2", "Wednesday, November 4", "Friday, November 6"]) {
      await expect(item(page, name, "Stand-up, 9:15 – 9:45 AM")).toBeVisible();
    }
  });

  test("this and following: the series is split at Thursday", async ({ page }) => {
    await openDemo(page, "week");
    const dialog = await editItem(page, "Thursday, November 5", /^Stand-up, /, "Stand-up");
    await dialog.getByRole("textbox", { name: "Title" }).fill("Daily sync");
    await dialog.getByRole("button", { name: "Save" }).click();
    const scope = page.getByRole("alertdialog", { name: "Edit recurring event" });
    await scope.getByRole("radio", { name: "This and following occurrences" }).check();
    await scope.getByRole("button", { name: "OK" }).click();
    await expect(item(page, "Thursday, November 5", /^Daily sync, 9:00/)).toBeVisible();
    await expect(item(page, "Friday, November 6", /^Daily sync, 9:00/)).toBeVisible();
    await expect(item(page, "Wednesday, November 4", /^Stand-up, 9:00/)).toBeVisible();
    await page.getByRole("button", { name: "Next week" }).click();
    await expect(item(page, "Monday, November 9", /^Daily sync, 9:00/)).toBeVisible();
  });

  test("a new day offers only this occurrence or this and following", async ({ page }) => {
    await openDemo(page, "week");
    const dialog = await editItem(page, "Thursday, November 5", /^Stand-up, /, "Stand-up");
    await dialog.getByLabel("Start date").fill("2026-11-07");
    await dialog.getByRole("button", { name: "Save" }).click();
    const scope = page.getByRole("alertdialog", { name: "Edit recurring event" });
    await expect(scope.getByRole("radio")).toHaveCount(2);
    await expect(scope.getByRole("radio", { name: "All occurrences" })).toHaveCount(0);
    await scope.getByRole("button", { name: "OK" }).click();
    await expect(item(page, "Saturday, November 7", /^Stand-up, 9:00/)).toBeVisible();
    await expect(item(page, "Thursday, November 5", /^Stand-up/)).toHaveCount(0);
  });

  test("deleting asks too: this occurrence leaves the others", async ({ page }) => {
    await openDemo(page, "week");
    await opener(page, "Friday, November 6", /^Stand-up, /).click();
    await act(page.getByRole("dialog", { name: "Stand-up" }), "Delete");
    const scope = page.getByRole("alertdialog", { name: "Delete recurring event" });
    await scope.getByRole("button", { name: "Delete" }).click();
    await expect(item(page, "Friday, November 6", /^Stand-up/)).toHaveCount(0);
    await expect(item(page, "Thursday, November 5", /^Stand-up, 9:00/)).toBeVisible();
  });

  test("the scope question keeps its keys: a view's key does nothing behind it", async ({
    page,
  }) => {
    await openDemo(page, "week");
    await opener(page, "Friday, November 6", /^Stand-up, /).click();
    await act(page.getByRole("dialog", { name: "Stand-up" }), "Delete");
    const scope = page.getByRole("alertdialog", { name: "Delete recurring event" });
    await expect(scope.getByRole("button", { name: "Delete" })).toBeFocused();
    await page.keyboard.press("m");
    await page.keyboard.press("n");
    await scope.getByRole("button", { name: "Cancel" }).click();
    await expect(scope).toHaveCount(0);
    const details = page.getByRole("dialog", { name: "Stand-up" });
    await details.press("Escape");
    await expect(details).toHaveCount(0);
    // Still the Week, the same week.
    await expect(page.getByRole("heading", { name: "Friday, November 6" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sunday, November 1" })).toBeVisible();
  });

  test("saving a series with nothing changed asks nothing", async ({ page }) => {
    await openDemo(page, "week");
    const dialog = await editItem(page, "Thursday, November 5", /^Stand-up, /, "Stand-up");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
  });

  test("deleting this and following ends the series", async ({ page }) => {
    await openDemo(page, "week");
    await opener(page, "Thursday, November 5", /^Stand-up, /).click();
    await act(page.getByRole("dialog", { name: "Stand-up" }), "Delete");
    const scope = page.getByRole("alertdialog", { name: "Delete recurring event" });
    await scope.getByRole("radio", { name: "This and following occurrences" }).check();
    await scope.getByRole("button", { name: "Delete" }).click();
    await expect(item(page, "Thursday, November 5", /^Stand-up/)).toHaveCount(0);
    await expect(item(page, "Friday, November 6", /^Stand-up/)).toHaveCount(0);
    await expect(item(page, "Wednesday, November 4", /^Stand-up, 9:00/)).toBeVisible();
  });
});

test("an event that does not repeat is deleted once confirmed", async ({ page }) => {
  await openDemo(page, "week");
  await opener(page, "Tuesday, November 3", /^Cinema, /).click();
  await act(page.getByRole("dialog", { name: "Cinema" }), "Delete");
  const confirm = page.getByRole("alertdialog", { name: "Delete this event?" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(item(page, "Tuesday, November 3", /^Cinema/)).toHaveCount(0);
});

test("the details' menu: Make a copy saves one at once and opens it from its notice (design D163, D164)", async ({
  page,
}) => {
  await openDemo(page, "week");
  await opener(page, "Tuesday, November 3", /^Cinema, /).click();
  const details = page.getByRole("dialog", { name: "Cinema" });
  await details.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Delete", "Make a copy", "Copy to…"]);
  await page.getByRole("menuitem", { name: "Make a copy" }).click();
  await expect(details).toHaveCount(0);
  const notice = page.getByRole("status").filter({ hasText: "Copy made" });
  await expect(notice).toBeVisible();
  await expect(item(page, "Tuesday, November 3", /^Cinema, /)).toHaveCount(2);
  await notice.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("dialog", { name: "Cinema" })).toBeVisible();
});

test("Copy to opens a new item filled from this one, in another calendar if chosen", async ({
  page,
}) => {
  await openDemo(page, "week");
  await opener(page, "Tuesday, November 3", /^Cinema, /).click();
  await act(page.getByRole("dialog", { name: "Cinema" }), "Copy to…");
  const dialog = page.getByRole("dialog", { name: "New event" });
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("Cinema");
  await expect(dialog.getByLabel("Start date")).toHaveValue("2026-11-03");
  // A copy keeps its kind.
  await expect(dialog.getByRole("radio", { name: "Task" })).toHaveCount(0);
  await choose(dialog.getByRole("combobox", { name: "Calendar" }), "Work");
  await dialog.getByLabel("Start date").fill("2026-11-05");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(item(page, "Tuesday, November 3", /^Cinema, /)).toHaveCount(1);
  await expect(item(page, "Thursday, November 5", /^Cinema, /)).toBeVisible();
});

test("Copy to clears the copy's notice, so its Open cannot leave the dialog", async ({ page }) => {
  await openDemo(page, "week");
  await opener(page, "Tuesday, November 3", /^Cinema, /).click();
  await act(page.getByRole("dialog", { name: "Cinema" }), "Make a copy");
  await expect(page.getByRole("status").filter({ hasText: "Copy made" })).toBeVisible();
  await opener(page, "Thursday, November 5", /^Dentist, /).click();
  await act(page.getByRole("dialog", { name: "Dentist" }), "Copy to…");
  await expect(page.getByRole("dialog", { name: "New event" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Copy made" })).toHaveCount(0);
});

test("an occurrence of a series is copied alone, as an item that does not repeat", async ({
  page,
}) => {
  await openDemo(page, "week");
  await opener(page, "Thursday, November 5", /^Stand-up, /).click();
  await act(page.getByRole("dialog", { name: "Stand-up" }), "Make a copy");
  await expect(item(page, "Thursday, November 5", /^Stand-up, /)).toHaveCount(2);
  await expect(item(page, "Friday, November 6", /^Stand-up, /)).toHaveCount(1);
});

test("a read-only calendar's item opens without edit or delete; it can only be copied elsewhere", async ({
  page,
}) => {
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Next week" }).click();
  await page
    .getByRole("list", { name: "All day" })
    .getByRole("button", { name: "Town festival, All day" })
    .click();
  const details = page.getByRole("dialog", { name: "Town festival" });
  await expect(
    details.getByText("Holidays is read-only: this item cannot be changed here."),
  ).toBeVisible();
  await expect(details.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await details.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Copy to…"]);
});

test("the tasks screen adds a task to its list, today, and completes it", async ({ page }) => {
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  const panel = page.getByRole("region", { name: "Tasks" });
  const tab = panel.getByRole("tab", { name: /^Tasks/ });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await panel
    .getByRole("tabpanel", { name: /^Tasks/ })
    .getByRole("button", { name: "Add a task" })
    .click();
  const dialog = page.getByRole("dialog", { name: "New task" });
  await expect(dialog.getByLabel("List")).toHaveText(/.+/);
  // A start always, today, all day; no due until one is added (design D159).
  await expect(dialog.getByLabel("Start date")).toHaveValue("2026-11-04");
  await expect(dialog.getByRole("switch", { name: "All day" })).toBeChecked();
  await expect(dialog.getByRole("button", { name: "Add due" })).toBeVisible();
  await dialog.getByRole("textbox", { name: "Title" }).fill("Buy stamps");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);
  const list = panel.getByRole("list", { name: "Tasks" });
  await list.getByRole("checkbox", { name: "Buy stamps" }).click();
  await panel.getByRole("button", { name: /^Completed/ }).click();
  await expect(
    panel
      .getByRole("list", { name: "Completed tasks" })
      .getByRole("checkbox", { name: "Buy stamps" }),
  ).toBeChecked();
});

test("a task made on a tapped slot starts there, a chip at its start; its due is a field of its own (design D159)", async ({
  page,
}) => {
  await openDemo(page, "week");
  const column = day(page, "Thursday, November 5");
  const box = (await column.boundingBox())!;
  await column.click({ position: { x: box.width - 10, y: 14.25 * 56 } });
  const dialog = page.getByRole("dialog", { name: "New event" });
  await dialog.getByRole("radio", { name: "Task" }).click();
  const task = page.getByRole("dialog", { name: "New task" });
  // The slot's day and time, no switch on the start, no due.
  await expect(task.getByLabel("Start date")).toHaveValue("2026-11-05");
  await expect(task.getByLabel("Start time")).toHaveText("2:00 PM");
  await expect(task.getByRole("switch")).toHaveCount(1);
  await expect(task.getByLabel("Due date")).toHaveCount(0);
  await task.getByRole("textbox", { name: "Title" }).fill("Pack the bags");
  await task.getByRole("button", { name: "Add due" }).click();
  await expect(task.getByLabel("Due date")).toHaveValue("2026-11-05");
  await expect(task.getByLabel("Due time")).toHaveText("3:00 PM");
  // A due before the start is refused, in words.
  await choose(task.getByLabel("Due time"), "1:00 PM");
  await task.getByRole("button", { name: "Save" }).click();
  await expect(task.getByRole("alert")).toHaveText("The due date cannot be before the start.");
  await task.getByLabel("Due date").fill("2026-11-07");
  await task.getByRole("button", { name: "Save" }).click();
  await expect(task).toHaveCount(0);
  // A 30-minute chip at its start, not a block to its due; not on the due's day.
  const chip = item(page, "Thursday, November 5", "Task: Pack the bags, 2:00 PM");
  await expect(chip).toBeVisible();
  expect(Math.round((await chip.boundingBox())!.height)).toBeLessThan(30);
  await expect(item(page, "Saturday, November 7", /Pack the bags/)).toHaveCount(0);
  await opener(page, "Thursday, November 5", "Task: Pack the bags, 2:00 PM").click();
  await expect(
    page
      .getByRole("dialog", { name: "Pack the bags" })
      .getByText("Thursday, November 5, 2:00 PM · Due Saturday, November 7, 1:00 PM"),
  ).toBeVisible();
});

test("an all-day task shows in the strip on its day; its due can be cleared (design D159)", async ({
  page,
}) => {
  await openDemo(page, "week");
  await page.getByRole("button", { name: "Create" }).click();
  await page
    .getByRole("dialog", { name: "New event" })
    .getByRole("radio", { name: "Task" })
    .click();
  const task = page.getByRole("dialog", { name: "New task" });
  await task.getByRole("textbox", { name: "Title" }).fill("Plan the trip");
  await task.getByRole("switch", { name: "All day" }).click();
  await expect(task.getByLabel("Start time")).toHaveCount(0);
  await task.getByLabel("Start date").fill("2026-11-06");
  await task.getByRole("button", { name: "Add due" }).click();
  await expect(task.getByLabel("Due date")).toHaveValue("2026-11-06");
  await expect(task.getByLabel("Due time")).toHaveCount(0);
  await task.getByRole("button", { name: "Remove due" }).click();
  await expect(task.getByRole("button", { name: "Add due" })).toBeVisible();
  await task.getByRole("button", { name: "Save" }).click();
  await expect(task).toHaveCount(0);
  await expect(
    page.getByRole("list", { name: "All day" }).getByRole("listitem", {
      name: "Task: Plan the trip, All day",
    }),
  ).toBeVisible();
});

test("a task has no status, priority, progress or tags in its details or its edit dialog (design D162)", async ({
  page,
}) => {
  await openDemo(page, "week");
  await opener(page, "Wednesday, November 4", "Task: Send the report, 3:00 PM").click();
  const details = page.getByRole("dialog", { name: "Send the report" });
  await expect(details.getByText("Not started")).toHaveCount(0);
  await expect(details.getByRole("button", { name: "Mark completed" })).toBeVisible();
  await details.getByRole("button", { name: "Edit" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit task" });
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("Send the report");
  for (const name of ["Status", "Priority", "Progress, %", "Tags, separated by commas"]) {
    await expect(dialog.getByLabel(name, { exact: true })).toHaveCount(0);
  }
});

test("a task's details complete it and star it", async ({ page }) => {
  await openDemo(page, "week");
  await opener(page, "Wednesday, November 4", "Task: Send the report, 3:00 PM").click();
  const details = page.getByRole("dialog", { name: "Send the report" });
  await expect(details.getByText("Due Wednesday, November 4, 3:00 PM")).toBeVisible();
  await details.getByRole("button", { name: "Mark completed" }).click();
  await expect(details.getByRole("button", { name: "Mark not completed" })).toBeVisible();
  await details.getByRole("button", { name: "Star" }).click();
  await expect(details.getByRole("button", { name: "Remove star" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(
    item(page, "Wednesday, November 4", "Completed task: Send the report, 3:00 PM"),
  ).toBeVisible();
});

test.describe("the Conflicts list (D6)", () => {
  async function openConflicts(page: Page) {
    await openDemo(page, "week");
    await page.getByRole("button", { name: /^Accounts/ }).click();
    const accounts = page.getByRole("dialog", { name: "Accounts" });
    await expect(accounts.getByText("1 change of yours was refused by the server")).toBeVisible();
    await accounts.getByRole("button", { name: "Review" }).click();
    return page.getByRole("dialog", { name: "Conflicts" });
  }

  test("applying mine again saves it over the server's version", async ({ page }) => {
    const conflicts = await openConflicts(page);
    const conflict = conflicts.getByRole("listitem", { name: "Dentist, check-up" });
    await expect(conflict.getByText("Differs in: title, time")).toBeVisible();
    await expect(conflict.getByRole("region", { name: "Yours" })).toContainText("4:00 – 5:00 PM");
    await expect(conflict.getByRole("region", { name: "On the server" })).toContainText(
      "3:00 – 4:00 PM",
    );
    await conflict.getByRole("button", { name: "Apply mine again" }).click();
    await expect(conflicts.getByText("No conflicts left.")).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "Accounts" })
      .getByRole("button", { name: "Close" })
      .click();
    await expect(
      item(page, "Thursday, November 5", "Dentist, check-up, 4:00 – 5:00 PM"),
    ).toBeVisible();
  });

  test("keeping the server's drops mine", async ({ page }) => {
    const conflicts = await openConflicts(page);
    await conflicts
      .getByRole("listitem", { name: "Dentist, check-up" })
      .getByRole("button", { name: "Keep the server's" })
      .click();
    await expect(conflicts.getByText("No conflicts left.")).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .getByRole("dialog", { name: "Accounts" })
      .getByRole("button", { name: "Close" })
      .click();
    await expect(item(page, "Thursday, November 5", "Dentist, 3:00 – 4:00 PM")).toBeVisible();
    await expect(page.getByRole("button", { name: "Accounts" })).toBeVisible();
  });
});

test.describe("on a phone, in Russian", () => {
  test.use({ viewport: PHONE, locale: "ru-RU" });

  test("a task from «+» starts as an event would, with «Добавить срок» for its due (design D159)", async ({
    page,
  }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Создать" }).click();
    await page
      .getByRole("dialog", { name: "Новое мероприятие" })
      .getByRole("radio", { name: "Задача" })
      .click();
    const task = page.getByRole("dialog", { name: "Новая задача" });
    await expect(task.getByLabel("Дата начала")).toHaveValue("2026-11-04");
    await expect(task.getByLabel("Время начала")).toHaveText("11:00");
    await expect(task.getByRole("button", { name: "Добавить срок" })).toBeVisible();
    await task.getByRole("textbox", { name: "Название" }).fill("Купить марки");
    await task.getByRole("button", { name: "Сохранить" }).click();
    await expect(task).toHaveCount(0);
    await expect(
      page
        .getByRole("list", { name: "среда, 4 ноября" })
        .getByRole("listitem", { name: "Задача: Купить марки, 11:00" }),
    ).toBeVisible();
  });

  test("the edit dialog covers the screen and speaks Russian; a weekly rule reads in words", async ({
    page,
  }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Создать" }).click();
    const dialog = page.getByRole("dialog", { name: "Новое мероприятие" });
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBe(PHONE.width);
    await dialog.getByRole("textbox", { name: "Название" }).fill("Бассейн");
    await choose(dialog.getByLabel("Повтор"), "Настроить…");
    await dialog.getByLabel("Интервал").fill("2");
    await dialog.getByRole("button", { name: "Понедельник" }).click();
    await expect(dialog.getByRole("combobox", { name: "Повтор" })).toHaveText(
      "Каждые 2 недели в понедельник, среду",
    );
    await dialog.getByRole("button", { name: "Сохранить" }).click();
    await expect(dialog).toHaveCount(0);
    await page
      .getByRole("list", { name: "среда, 4 ноября" })
      .getByRole("button", { name: /^Бассейн, / })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: "Бассейн" })
        .getByText("Каждые 2 недели в понедельник, среду"),
    ).toBeVisible();
  });
});
