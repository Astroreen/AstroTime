// Editing end to end on the demo data with the clock frozen on Wednesday,
// November 4, 2026, 10:40 in Vilnius (docs/plans/foundation.md#pr-6--editing):
// creating with "+" and on an empty slot, the details and edit dialogs, the
// scope of an occurrence's edit and deletion (D11), tasks, a read-only
// calendar, and the Conflicts list (D6).
import { expect, test, type Page } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

test.use({ viewport: WIDE });

const day = (page: Page, name: string) => page.getByRole("list", { name });
const item = (page: Page, dayName: string, name: string | RegExp) =>
  day(page, dayName).getByRole("listitem", { name });
const opener = (page: Page, dayName: string, name: string | RegExp) =>
  day(page, dayName).getByRole("button", { name });

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
  await expect(dialog.getByLabel("Start time")).toHaveValue("11:00");
  await expect(dialog.getByLabel("End time")).toHaveValue("12:00");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Haircut");
  // A new start keeps the length; Sunday, which has room in the Month view.
  await dialog.getByLabel("Start time").selectOption("17:00");
  await expect(dialog.getByLabel("End time")).toHaveValue("18:00");
  await dialog.getByLabel("Start date").fill("2026-11-01");
  await expect(dialog.getByLabel("End date")).toHaveValue("2026-11-01");
  await dialog.getByRole("combobox", { name: "Calendar" }).selectOption({ label: "Personal" });
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(item(page, "Sunday, November 1", "Haircut, 5:00 – 6:00 PM")).toBeVisible();
  await page.keyboard.press("m");
  await expect(item(page, "Sunday, November 1", "Haircut, 5:00 – 6:00 PM")).toBeVisible();
  await page.keyboard.press("a");
  await expect(item(page, "Sunday, November 1", "Haircut, 5:00 – 6:00 PM")).toBeAttached();
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
  await expect(dialog.getByLabel("Start time")).toHaveValue("14:00");
  await expect(dialog.getByLabel("End time")).toHaveValue("15:00");
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
  await dialog.getByLabel("End time").selectOption("10:00");
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
  await dialog.getByLabel("Start time").selectOption("16:00");
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
    await dialog.getByLabel("Start time").selectOption("09:15");
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
    await page
      .getByRole("dialog", { name: "Stand-up" })
      .getByRole("button", { name: "Delete" })
      .click();
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
    await page
      .getByRole("dialog", { name: "Stand-up" })
      .getByRole("button", { name: "Delete" })
      .click();
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
    await page
      .getByRole("dialog", { name: "Stand-up" })
      .getByRole("button", { name: "Delete" })
      .click();
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
  await page
    .getByRole("dialog", { name: "Cinema" })
    .getByRole("button", { name: "Delete" })
    .click();
  const confirm = page.getByRole("alertdialog", { name: "Delete this event?" });
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(item(page, "Tuesday, November 3", /^Cinema/)).toHaveCount(0);
});

test("a read-only calendar's item opens without edit or delete", async ({ page }) => {
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
  await expect(details.getByRole("button", { name: "Delete" })).toHaveCount(0);
});

test("the tasks screen adds a task to its list, undated, and completes it", async ({ page }) => {
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
  await expect(dialog.getByLabel("List")).toHaveValue(/.+/);
  await expect(dialog.getByRole("switch", { name: "Due date" })).not.toBeChecked();
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

  test("the edit dialog covers the screen and speaks Russian; a weekly rule reads in words", async ({
    page,
  }) => {
    await openDemo(page, "day");
    await page.getByRole("button", { name: "Создать" }).click();
    const dialog = page.getByRole("dialog", { name: "Новое мероприятие" });
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBe(PHONE.width);
    await dialog.getByRole("textbox", { name: "Название" }).fill("Бассейн");
    await dialog.getByLabel("Повтор").selectOption({ label: "Настроить…" });
    await dialog.getByLabel("Интервал").fill("2");
    await dialog.getByRole("button", { name: "Понедельник" }).click();
    await expect(dialog.getByLabel("Повтор").locator("option:checked")).toHaveText(
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
