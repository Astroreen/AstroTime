// An assistant in the desktop app (docs/plans/assistant.md#D308, D310, D311):
// Settings → Assistants turns the MCP endpoint on; the MCP SDK's own client,
// as an assistant's would, creates, changes and deletes through it; the
// window shows each change at once and its sync sends it to Radicale; Undo
// in the log puts it back; a configuration copies with the address and the
// token; "New token" refuses the old one. The uploads are seen as they
// leave the main process (its HTTP session's `webRequest`), not waited for.
import { test as base, expect, type ElectronApplication, type Page } from "@playwright/test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { startRadicale, type CalDavServer } from "../../../packages/sync/test/servers.ts";
import { keepPassword, launch, profile, signInByPassword } from "./support.ts";

const test = base.extend<{ radicale: CalDavServer }>({
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies from it
  radicale: async ({}, use) => {
    const server = await startRadicale();
    await use(server);
    await server.stop();
  },
});

/** Resolves with the next upload (`PUT` or `DELETE`) the app's HTTP sends, and its answer. */
function nextUpload(app: ElectronApplication) {
  return app.evaluate(
    ({ session }) =>
      new Promise<{ method: string; url: string; status: number }>((resolve) => {
        const { webRequest } = session.fromPartition("astrotime-http");
        webRequest.onCompleted({ urls: ["*://*/*"] }, (details) => {
          if (details.method !== "PUT" && details.method !== "DELETE") return;
          webRequest.onCompleted(null);
          resolve({ method: details.method, url: details.url, status: details.statusCode });
        });
      }),
  );
}

async function openSettings(page: Page) {
  await page
    .getByRole("navigation", { name: "Main menu" })
    .getByRole("button", { name: "Settings" })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  await expect(settings).toBeVisible();
  return settings;
}

async function connect(url: string, token: string) {
  const client = new Client({ name: "astrotime-e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError ?? false).toBe(false);
  return result.structuredContent as Record<string, unknown>;
}

test("an assistant creates, changes and deletes through the app; the window shows it, sync sends it, Undo puts it back", async ({
  radicale,
}) => {
  await radicale.mkcalendar("Work");
  const { app, page } = await launch(profile());
  await signInByPassword(page, radicale);
  await keepPassword(page, "Keep until AstroTime quits");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // The first sync brought the server's calendar (Settings lists it).
  const settings = await openSettings(page);
  await expect(
    settings
      .getByRole("region", { name: `astro@${new URL(radicale.url).host}` })
      .getByText("Work", { exact: true }),
  ).toBeVisible();
  // Off by default; on, its address and token show.
  const enable = settings.getByRole("switch", { name: "Let AI assistants in (MCP)" });
  await expect(enable).not.toBeChecked();
  await enable.click();
  const address = settings.getByRole("group", { name: "Address" });
  const url = await address.getByText(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/).textContent();
  const token = await settings
    .getByRole("group", { name: "Token" })
    .getByText(/^[\w-]{43}$/)
    .textContent();
  expect(
    await settings.getByRole("region", { name: "Changed by an assistant" }).textContent(),
  ).toContain("Nothing yet");

  // A configuration copies with them: Cursor's.
  await settings.getByRole("button", { name: "Copy a configuration for…" }).click();
  await page.getByRole("menuitem", { name: "Cursor" }).click();
  await expect(settings.getByRole("status")).toHaveText(
    "Copied for Cursor: add it to ~/.cursor/mcp.json.",
  );
  expect(JSON.parse(await app.evaluate(({ clipboard }) => clipboard.readText()))).toEqual({
    mcpServers: { astrotime: { url, headers: { Authorization: `Bearer ${token}` } } },
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const client = await connect(url!, token!);
  const { tools } = await client.listTools();
  expect(tools.find((tool) => tool.name === "delete_item")?.annotations?.destructiveHint).toBe(
    true,
  );
  const { calendars } = (await call(client, "list_calendars")) as {
    calendars: { id: string; name: string }[];
  };
  const work = calendars.find((calendar) => calendar.name === "Work")!;

  const wednesday = page.getByRole("list", { name: "Wednesday, November 4" });
  let upload = nextUpload(app);
  const created = await call(client, "create_event", {
    calendarId: work.id,
    summary: "Planned by an assistant",
    start: "2026-11-04T16:00",
  });
  await expect(
    wednesday.getByRole("listitem", { name: "Planned by an assistant, 4:00 – 5:00 PM" }),
  ).toBeVisible();
  const put = await upload;
  expect(put).toMatchObject({ method: "PUT", status: 201 });
  const onServer = () =>
    fetch(put.url, {
      headers: { Authorization: `Basic ${btoa(`${radicale.username}:${radicale.password}`)}` },
    }).then((response) => response.text());
  expect(await onServer()).toContain("SUMMARY:Planned by an assistant\r\n");

  upload = nextUpload(app);
  await call(client, "change_item", { id: created["id"], summary: "Renamed by an assistant" });
  await expect(
    wednesday.getByRole("listitem", { name: "Renamed by an assistant, 4:00 – 5:00 PM" }),
  ).toBeVisible();
  expect(await upload).toMatchObject({ method: "PUT", status: 204 });
  expect(await onServer()).toContain("SUMMARY:Renamed by an assistant\r\n");

  // Undo in the log: the change goes, and the sync sends that too.
  const log = (await openSettings(page)).getByRole("region", { name: "Changed by an assistant" });
  await expect(log.getByRole("listitem")).toHaveCount(2);
  upload = nextUpload(app);
  await log.getByRole("button", { name: "Undo: Renamed by an assistant" }).click();
  await expect(log.getByText("Undone")).toBeVisible();
  // The creation is undoable again: the item is what the assistant made.
  await expect(log.getByRole("button", { name: "Undo: Planned by an assistant" })).toBeVisible();
  expect(await upload).toMatchObject({ method: "PUT", status: 204 });
  expect(await onServer()).toContain("SUMMARY:Planned by an assistant\r\n");
  await page.keyboard.press("Escape");
  await expect(
    wednesday.getByRole("listitem", { name: "Planned by an assistant, 4:00 – 5:00 PM" }),
  ).toBeVisible();

  upload = nextUpload(app);
  expect(await call(client, "delete_item", { id: created["id"] })).toEqual({
    deleted: created["id"],
  });
  await expect(wednesday.getByRole("listitem", { name: /^Planned by an assistant/ })).toHaveCount(
    0,
  );
  expect(await upload).toMatchObject({ method: "DELETE" });

  // "New token": the old one is refused at once, the new one let in.
  const again = await openSettings(page);
  await again.getByRole("button", { name: "New token" }).click();
  const fresh = again.getByRole("group", { name: "Token" }).getByText(/^[\w-]{43}$/);
  await expect(fresh).not.toHaveText(token!);
  await expect(client.listTools()).rejects.toThrow();
  await expect(connect(url!, token!)).rejects.toThrow();
  await (await connect(url!, (await fresh.textContent())!)).close();

  // Off: nothing listens.
  await again.getByRole("switch", { name: "Let AI assistants in (MCP)" }).click();
  await expect(again.getByRole("group", { name: "Address" })).toHaveCount(0);
  await expect(fetch(url!)).rejects.toThrow();
  await app.close();
});
