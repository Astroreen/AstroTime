// Import from a file (docs/plans/import.md#D265–#D271): Settings' "Data"
// group picks a file, the dialog shows what it holds and where it goes,
// asks about the items already there that differ, and writes them through
// the store; the views show them. On a wide screen in English and on a
// phone in Russian.
import { expect, test } from "@playwright/test";

import { HOLIDAYS, importFile, TEAM } from "./import-files.ts";
import { choose, openDemo, PHONE, WIDE } from "./support.ts";

test("wide, English: a file's events and a task, one already there, into Work and a new list", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "week");
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings.getByRole("heading", { name: "Data" })).toBeVisible();
  await importFile(page, /^Import from a file/, "team.ics", TEAM);

  const dialog = page.getByRole("dialog", { name: "Import" });
  const team = dialog.getByRole("region", { name: "Team" });
  await expect(team).toContainText("2 events · 1 task · Nov 4 – 6, 2026");
  // No calendar is called Team: the ones new items go to are offered first (D269).
  await expect(team.getByRole("combobox", { name: "Events go to" })).toContainText("Personal");
  await choose(team.getByRole("combobox", { name: "Events go to" }), "Work");
  await choose(
    team.getByRole("combobox", { name: "Tasks go to" }),
    "New list on this device: Team",
  );
  await dialog.getByRole("button", { name: "Import", exact: true }).click();

  // The demo's design review is in Work already, and differs: asked once (D270).
  await expect(dialog.getByRole("alert")).toContainText(
    "1 entry of the file is already in the calendar it goes to",
  );
  await dialog.getByRole("button", { name: "Update them" }).click();
  const done = dialog.getByRole("status");
  await expect(done).toContainText("Imported");
  await expect(done).toContainText("2 events · 1 task");
  await expect(done).toContainText("1 updated");
  await dialog.getByRole("button", { name: "Close" }).last().click();
  await expect(dialog).toBeHidden();

  // The new list is on this device, beside the demo's account (D269).
  await expect(settings.getByRole("region", { name: "On this device" })).toContainText("Team");
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();

  // In the views, as if made here.
  await expect(
    page.getByRole("list", { name: "Thursday, November 5" }).getByRole("listitem", {
      name: /^Planning poker/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("list", { name: "Wednesday, November 4" }).getByRole("listitem", {
      name: /^Design review \(moved\)/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main menu" }).getByRole("checkbox", { name: "Team" }),
  ).toBeChecked();
});

test.describe("on a phone, in Russian", () => {
  test.use({ locale: "ru-RU", hasTouch: true, isMobile: true });

  test("a broken file says what it mended and what it could not import, then lands in a new calendar", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await openDemo(page, "agenda");
    await page.getByRole("button", { name: "Главное меню" }).click();
    await page
      .getByRole("dialog", { name: "Главное меню" })
      .getByRole("button", { name: "Настройки" })
      .click();
    const settings = page.getByRole("dialog", { name: "Настройки" });
    await expect(settings.getByRole("heading", { name: "Данные" })).toBeVisible();

    // Not a calendar at all: said so, nothing else.
    await importFile(page, /^Импорт из файла/, "вход.ics", "<html><body>Войти</body></html>");
    const dialog = page.getByRole("dialog", { name: "Импорт" });
    await expect(dialog.getByRole("alert")).toContainText("вход.ics — не календарь");
    await dialog.getByRole("button", { name: "Закрыть" }).last().click();
    await expect(dialog).toBeHidden();

    await importFile(page, /^Импорт из файла/, "отпуск.ics", HOLIDAYS);
    const trip = dialog.getByRole("region", { name: "Отпуск" });
    await expect(trip).toContainText("2 события");
    await expect(trip).toContainText(
      "1 запись не удаётся импортировать · 1 запись исправлена для импорта",
    );
    await trip.getByText("1 запись не удаётся импортировать").click();
    await expect(trip.getByRole("listitem")).toHaveText([
      "trip-1: строка была разорвана: соединена",
      "trip-2: не читается",
    ]);
    await choose(
      trip.getByRole("combobox", { name: "События — в" }),
      "Новый календарь на этом устройстве: Отпуск",
    );
    // The whole screen, its bars in sight (design D235).
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBe(PHONE.width);
    await dialog.getByRole("button", { name: "Импортировать" }).click();
    await expect(dialog.getByRole("status")).toContainText("2 события");
    await dialog.getByRole("button", { name: "Закрыть" }).last().click();
    await expect(settings.getByRole("region", { name: "На этом устройстве" })).toContainText(
      "Отпуск",
    );
    await settings.getByRole("button", { name: "Закрыть настройки" }).click();
    await expect(page.getByRole("listitem", { name: /Поездка в Ригу/ }).first()).toBeVisible();
  });
});
