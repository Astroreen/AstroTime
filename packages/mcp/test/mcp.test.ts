// @astrotime/mcp end to end (docs/plans/assistant.md#D307, D308, D311): the
// MCP SDK's own client over HTTP to the endpoint on a port of its own, the
// tools over a store whose account syncs with AstroTime's own server, the log
// and its undo, and who may call.
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { fetchClient } from "@astrotime/caldav";
import { CalDavProvider } from "@astrotime/caldav/provider";
import { CalendarObject } from "@astrotime/core";
import { ASSISTANT_CHANGES_KEPT, Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { syncAccount } from "@astrotime/sync";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, expect, test } from "vite-plus/test";

import { startAstroTime, type CalDavServer } from "../../sync/test/servers.ts";
import { assistantTools, loggedChanges, undoChange } from "../src/index.ts";
import { mcpEndpoint, type ToolAnswer } from "../src/http.ts";

let server: CalDavServer;
let endpoint: Server;
let port = 0;
let token: string | null = "first-token-of-thirty-two-bytes!";
/** Where the tools run: the window's store on the desktop; `null`, no window. */
let runner: ReturnType<typeof assistantTools> | null = null;

/** A device: its store, an account on the server, and its sync. */
async function device() {
  const credentials = { username: server.username, password: server.password };
  const http = fetchClient();
  const { homeUrl } = await CalDavProvider.discover(http, server.url, credentials);
  const provider = new CalDavProvider(http, credentials, homeUrl);
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: server.name,
    serverUrl: server.url,
    username: credentials.username,
  });
  const sync = () => syncAccount(store, provider, account.id);
  await sync();
  const calendar = (await store.calendars(account.id)).find((one) => one.name === "work")!;
  return { store, sync, calendar };
}

let here: Awaited<ReturnType<typeof device>>;

beforeAll(async () => {
  server = await startAstroTime();
  await server.mkcalendar("work");
  here = await device();
  runner = assistantTools({ store: here.store, timeZone: "Europe/Vilnius" });
  const handle = mcpEndpoint({
    port: () => port,
    token: () => token,
    call: async (name, args): Promise<ToolAnswer> => {
      if (!runner) return { refused: "AstroTime must be open." };
      try {
        return { ok: await runner.call(name, args) };
      } catch (error) {
        return { refused: (error as Error).message };
      }
    },
  });
  // As the desktop's main process serves it: node:http on 127.0.0.1.
  endpoint = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (typeof value === "string") headers.set(name, value);
    const response = await handle(
      new Request(`http://127.0.0.1:${port}${req.url}`, {
        method: req.method!,
        headers,
        ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
  port = (endpoint.address() as AddressInfo).port;
});

afterAll(async () => {
  endpoint.closeAllConnections();
  await new Promise((resolve) => endpoint.close(resolve));
  await server.stop();
});

/** An MCP client with `bearer`, as an assistant's would be. */
async function client(bearer: string | null = token) {
  const mcp = new Client({ name: "astrotime-test", version: "1.0.0" });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} },
    }),
  );
  return mcp;
}

/** Calls a tool; its structured result, or its refusal's words. */
async function call(mcp: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await mcp.callTool({ name, arguments: args });
  if (result.isError) {
    const [first] = result.content as { type: string; text: string }[];
    return { refused: first?.text };
  }
  return result.structuredContent as Record<string, unknown>;
}

/** A raw request to the endpoint, every header as given (Host and Origin too). */
function raw(headers: Record<string, string>): Promise<number> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
  return new Promise((resolve, reject) => {
    const sent = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/mcp",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode!);
      },
    );
    sent.on("error", reject);
    sent.end(body);
  });
}

const summaryOf = (ics: string) => CalendarObject.parse(ics).master?.summary;

test("the tools are listed with their hints: read-only ones as read-only, delete as destructive", async () => {
  const mcp = await client();
  const { tools } = await mcp.listTools();
  const hints = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]));
  expect(Object.keys(hints).toSorted()).toEqual([
    "add_attachment",
    "change_item",
    "complete_task",
    "create_event",
    "create_task",
    "delete_item",
    "get_item",
    "list_calendars",
    "list_items",
    "search_items",
  ]);
  for (const name of ["list_calendars", "search_items", "list_items", "get_item"])
    expect(hints[name]?.readOnlyHint).toBe(true);
  for (const name of ["create_event", "create_task", "change_item", "complete_task", "delete_item"])
    expect(hints[name]?.readOnlyHint).toBe(false);
  expect(hints["delete_item"]?.destructiveHint).toBe(true);
  expect(hints["change_item"]?.destructiveHint).toBe(false);
  // No path anywhere: an attachment is its content (D308).
  const attach = tools.find((tool) => tool.name === "add_attachment")!;
  expect(Object.keys(attach.inputSchema.properties ?? {}).toSorted()).toEqual([
    "content",
    "id",
    "name",
    "type",
  ]);
  await mcp.close();
});

test("an MCP client lists, creates, changes and deletes; the store holds each change and sync sends it", async () => {
  const mcp = await client();
  const other = await device();
  const { calendars } = (await call(mcp, "list_calendars")) as {
    calendars: { id: string; name: string; holds: string[]; canCreate: boolean }[];
  };
  expect(calendars).toContainEqual(
    expect.objectContaining({ id: here.calendar.id, name: "work", canCreate: true }),
  );

  const created = await call(mcp, "create_event", {
    calendarId: here.calendar.id,
    summary: "Lunch with Masha",
    start: "2026-11-06T13:00",
    location: "Coffeemania",
  });
  expect(created).toMatchObject({
    kind: "event",
    summary: "Lunch with Masha",
    start: "2026-11-06T13:00",
    end: "2026-11-06T14:00",
    timeZone: "Europe/Vilnius",
    allDay: false,
    location: "Coffeemania",
    notSynced: true,
  });
  const id = created["id"] as string;
  const stored = await here.store.object(id);
  expect(stored?.pending).toBe("create");
  expect(summaryOf(stored!.ics)).toBe("Lunch with Masha");
  expect(await here.sync()).toMatchObject({ uploaded: 1 });
  await other.sync();
  expect(
    (await other.store.search([other.calendar.id], "Masha")).map((o) => summaryOf(o.ics)),
  ).toEqual(["Lunch with Masha"]);

  const listed = (await call(mcp, "list_items", { from: "2026-11-06", to: "2026-11-06" })) as {
    occurrences: { id: string; summary: string }[];
  };
  expect(listed.occurrences.map((one) => [one.id, one.summary])).toEqual([
    [id, "Lunch with Masha"],
  ]);
  expect(await call(mcp, "search_items", { text: "masha" })).toMatchObject({
    items: [{ id, summary: "Lunch with Masha" }],
  });

  expect(
    await call(mcp, "change_item", {
      id,
      summary: "Lunch with Masha and Petya",
      start: "2026-11-06T13:30",
    }),
  ).toMatchObject({
    summary: "Lunch with Masha and Petya",
    start: "2026-11-06T13:30",
    end: "2026-11-06T14:30",
  });
  expect(summaryOf((await here.store.object(id))!.ics)).toBe("Lunch with Masha and Petya");
  expect(await here.sync()).toMatchObject({ uploaded: 1 });
  await other.sync();
  expect(summaryOf((await other.store.search([other.calendar.id], "Masha"))[0]!.ics)).toBe(
    "Lunch with Masha and Petya",
  );

  expect(await call(mcp, "delete_item", { id })).toEqual({ deleted: id });
  expect((await here.store.object(id))?.pending).toBe("delete");
  expect(await call(mcp, "get_item", { id })).toEqual({ refused: `No item ${id}.` });
  expect(await here.sync()).toMatchObject({ uploaded: 1 });
  await other.sync();
  expect(await other.store.search([other.calendar.id], "Masha")).toEqual([]);
  await mcp.close();
});

test("a change keeps every property it does not name, another client's X- lines byte for byte (D7)", async () => {
  const mcp = await client();
  const foreign = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Other//Client//EN",
    "BEGIN:VEVENT",
    "UID:kept-x",
    "DTSTAMP:20261101T080000Z",
    "DTSTART;TZID=Europe/Vilnius:20261109T100000",
    "DTEND;TZID=Europe/Vilnius:20261109T110000",
    "SUMMARY:Standup",
    "X-OTHER-CLIENT;X-PARAM=kept:a value; with: punctuation",
    "X-MOZ-GENERATION:3",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
  const stored = await here.store.saveLocal(here.calendar.id, foreign);
  await call(mcp, "change_item", {
    id: stored.id,
    summary: "Standup, moved",
    start: "2026-11-09T10:30",
  });
  const after = (await here.store.object(stored.id))!.ics;
  expect(after).toContain("\r\nX-OTHER-CLIENT;X-PARAM=kept:a value; with: punctuation\r\n");
  expect(after).toContain("\r\nX-MOZ-GENERATION:3\r\n");
  expect(after).toContain("PRODID:-//Other//Client//EN");
  expect(after).toContain("SUMMARY:Standup\\, moved");
  expect(after).toContain("DTSTART;TZID=Europe/Vilnius:20261109T103000");
  await mcp.close();
});

test("a task: created with a due day, completed, a file attached by its content alone", async () => {
  const mcp = await client();
  const task = await call(mcp, "create_task", {
    calendarId: here.calendar.id,
    summary: "Buy bread",
    due: "2026-11-06",
  });
  expect(task).toMatchObject({ kind: "task", due: "2026-11-06", allDay: true, done: false });
  const id = task["id"] as string;
  expect(await call(mcp, "complete_task", { id })).toMatchObject({ done: true });
  const content = Buffer.from("milk, eggs\n").toString("base64");
  expect(
    await call(mcp, "add_attachment", { id, name: "list.txt", type: "text/plain", content }),
  ).toMatchObject({
    attachments: [{ name: "list.txt", type: "text/plain", size: 11, inline: true }],
  });
  expect((await here.store.object(id))!.ics.replaceAll("\r\n ", "")).toContain(
    `ATTACH;ENCODING=BASE64;FMTTYPE=text/plain;FILENAME=list.txt;VALUE=BINARY:${content}`,
  );
  // Not base64, and no other way to name a file.
  expect(await call(mcp, "add_attachment", { id, name: "x", content: "/etc/passwd" })).toEqual({
    refused: "Not a file's content in base64.",
  });
  // An event is not completed, and a calendar the user may not write is refused.
  expect(await call(mcp, "complete_task", { id: "nope" })).toEqual({ refused: "No item nope." });
  await mcp.close();
});

test("Undo puts each change back: a creation goes, a change returns, a deletion comes back whole (D311)", async () => {
  const mcp = await client();
  const created = await call(mcp, "create_event", {
    calendarId: here.calendar.id,
    summary: "Undo me",
    start: "2026-11-10",
  });
  const id = created["id"] as string;
  const made = (await here.store.object(id))!.ics;
  await call(mcp, "change_item", { id, summary: "Undo me, changed" });
  await call(mcp, "delete_item", { id });

  const [deletion, change, creation] = await loggedChanges(here.store);
  expect([deletion?.tool, change?.tool, creation?.tool]).toEqual([
    "delete_item",
    "change_item",
    "create_event",
  ]);
  // Only the latest is the item as it is now: the others wait for it.
  expect([deletion?.state, change?.state, creation?.state]).toEqual([
    "undoable",
    "changed",
    "changed",
  ]);

  // Never sent, its deletion took the row: it comes back as a new one, by its UID.
  const uid = CalendarObject.parse(made).uid;
  const now = async () => (await here.store.withUids(here.calendar.id, [uid]))[0]?.ics;
  expect(await here.store.object(id)).toBeUndefined();
  expect(await undoChange(here.store, deletion!.id)).toBe("undone");
  expect(summaryOf((await now())!)).toBe("Undo me, changed");
  expect(await undoChange(here.store, change!.id)).toBe("undone");
  expect(await now()).toBe(made);
  expect(await undoChange(here.store, creation!.id)).toBe("undone");
  expect(await now()).toBeUndefined();
  expect((await loggedChanges(here.store)).slice(0, 3).map((entry) => entry.state)).toEqual([
    "undone",
    "undone",
    "undone",
  ]);
  await mcp.close();
});

test("Undo is refused once the item changed since: the later edit stays (D311)", async () => {
  const mcp = await client();
  const created = await call(mcp, "create_event", {
    calendarId: here.calendar.id,
    summary: "Planning",
    start: "2026-11-11T09:00",
  });
  const id = created["id"] as string;
  await call(mcp, "change_item", { id, summary: "Planning, by the assistant" });
  // The user edits it afterwards, as the edit dialog would.
  const current = (await here.store.object(id))!;
  const edited = current.ics.replace(
    "SUMMARY:Planning\\, by the assistant",
    "SUMMARY:Planning\\, mine",
  );
  await here.store.saveLocal(here.calendar.id, edited);

  const [change] = await loggedChanges(here.store);
  expect(change).toMatchObject({ tool: "change_item", state: "changed", objectId: id });
  expect(await undoChange(here.store, change!.id)).toBe("changed");
  expect((await here.store.object(id))!.ics).toBe(edited);
  await mcp.close();
});

test(`the log keeps the latest ${ASSISTANT_CHANGES_KEPT} changes`, async () => {
  const store = await Store.open(nodeDriver());
  await store.addLocalCalendarIfEmpty({
    calendar: "Personal",
    account: "This device",
    color: "#3366cc",
  });
  const [calendar] = await store.calendars();
  let at = 0;
  const tools = assistantTools({ store, timeZone: "UTC", now: () => ++at });
  for (let i = 1; i <= ASSISTANT_CHANGES_KEPT + 3; i++)
    await tools.call("create_task", { calendarId: calendar!.id, summary: `Task ${i}` });
  const kept = await store.assistantChanges();
  expect(kept).toHaveLength(ASSISTANT_CHANGES_KEPT);
  expect(kept[0]?.summary).toBe(`Task ${ASSISTANT_CHANGES_KEPT + 3}`);
  expect(kept.at(-1)?.summary).toBe("Task 4");
  await store.close();
});

test("a call without the token, with another, from a foreign Host or with any Origin is refused", async () => {
  const good = { Authorization: `Bearer ${token}`, Host: `127.0.0.1:${port}` };
  expect(await raw(good)).toBe(200);
  expect(await raw({ ...good, Host: `localhost:${port}` })).toBe(200);
  expect(await raw({ Host: good.Host })).toBe(401);
  expect(await raw({ ...good, Authorization: "Bearer first-token-of-thirty-two-bytes?" })).toBe(
    401,
  );
  expect(await raw({ ...good, Authorization: "Bearer first" })).toBe(401);
  expect(await raw({ ...good, Host: `attacker.example:${port}` })).toBe(403);
  expect(await raw({ ...good, Host: "127.0.0.1:1" })).toBe(403);
  expect(await raw({ ...good, Origin: `http://127.0.0.1:${port}` })).toBe(403);
  expect(await raw({ ...good, Origin: "null" })).toBe(403);
  await expect(client(null)).rejects.toThrow();
});

test("a new token refuses the old one at once; with nowhere to run, a call says AstroTime must be open", async () => {
  const before = token!;
  const mcp = await client();
  token = "second-token-of-thirty-two-byte!";
  await expect(mcp.callTool({ name: "list_calendars", arguments: {} })).rejects.toThrow();
  await expect(client(before)).rejects.toThrow();
  const fresh = await client();
  expect(await call(fresh, "list_calendars")).toHaveProperty("calendars");

  const open = runner;
  runner = null;
  expect(await call(fresh, "list_calendars")).toEqual({ refused: "AstroTime must be open." });
  runner = open;
  await fresh.close();
});
