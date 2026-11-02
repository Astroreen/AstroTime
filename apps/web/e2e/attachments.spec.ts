// An item's attachments in its details (design D230, foundation D229) on the
// demo data: a file of the account's by its link, a web link, a file inline;
// and in the edit dialog, one taken off and a link added (design D233).
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { openDemo, PHONE, WIDE } from "./support.ts";

for (const [size, viewport] of [
  ["wide", WIDE],
  ["phone", PHONE],
] as const) {
  test(`the details list the attachments; a link opens, an inline file is saved (${size})`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openDemo(page, "day");
    await page
      .getByRole("list", { name: "Wednesday, November 4" })
      .getByRole("button", { name: /^Budget planning, / })
      .click();
    const details = page.getByRole("dialog", { name: "Budget planning" });
    const list = details.getByRole("definition").filter({ has: page.getByText("figures.txt") });
    // Each with its name, kind and size where its client wrote them.
    const file = list.getByRole("link", { name: /Budget 2027\.pdf/ });
    await expect(file).toContainText("PDF · 482 kB");
    await expect(file).toHaveAttribute("href", "https://example.com/index.php/f/241");
    await expect(file).toHaveAttribute("target", "_blank");
    const link = list.getByRole("link", { name: "example.com/budget/sheet" });
    await expect(link).toHaveAttribute("href", "https://example.com/budget/sheet");

    // The inline file is decoded only when saved.
    const save = list.getByRole("button", { name: /^Save figures\.txt / });
    await expect(save).toContainText("TXT · 22 B");
    const [download] = await Promise.all([page.waitForEvent("download"), save.click()]);
    expect(download.suggestedFilename()).toBe("figures.txt");
    expect(readFileSync(await download.path(), "utf8")).toBe("Q1: 12 000\nQ2: 14 500\n");
  });
}

test("the edit dialog takes one off and adds a link; the details show what was saved", async ({
  page,
}) => {
  await page.setViewportSize(WIDE);
  await openDemo(page, "day");
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Budget planning, / })
    .click();
  await page
    .getByRole("dialog", { name: "Budget planning" })
    .getByRole("button", { name: "Edit" })
    .click();
  const edit = page.getByRole("dialog", { name: "Edit event" });
  const list = edit.getByRole("list", { name: "Attachments" });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await list.getByRole("button", { name: "Remove example.com/budget/sheet" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);

  await edit.getByRole("button", { name: "Add a link" }).click();
  const link = edit.getByRole("textbox", { name: "Link" });
  // Not a web link: nothing to add.
  await link.fill("not a link");
  await expect(edit.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  // Enter adds it, without the scheme typed, and does not save the dialog.
  await link.fill("example.org/minutes");
  await link.press("Enter");
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(list).toContainText("example.org/minutes");
  await expect(edit).toBeVisible();

  await edit.getByRole("button", { name: "Save" }).click();
  await expect(edit).toHaveCount(0);
  const details = page.getByRole("dialog", { name: "Budget planning" });
  // Saved, the dialogs close; the item opened again shows what was written.
  await expect(details).toHaveCount(0);
  await page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Budget planning, / })
    .click();
  await expect(details.getByRole("link", { name: "example.org/minutes" })).toHaveAttribute(
    "href",
    "https://example.org/minutes",
  );
  await expect(details.getByRole("link", { name: "example.com/budget/sheet" })).toHaveCount(0);
  await expect(details.getByRole("button", { name: /^Save figures\.txt / })).toBeVisible();
});
