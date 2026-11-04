// Google (docs/plans/providers.md#D252) against a fake Tasks API that keeps
// what the real one keeps: lists, tasks with their etags, PATCH of named
// fields only, updatedMin and deleted tasks; and the composite provider
// sending each call to the API whose address it names. Through the sync
// engine and a real store: a task list synced both ways, what Google
// cannot keep said.
import type { HttpClient, HttpRequest, TokenSource } from "@astrotime/caldav";
import type { Provider } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { syncAccount } from "@astrotime/sync";
import { expect, test } from "vite-plus/test";

import {
  GoogleProvider,
  GoogleTasks,
  taskFieldsOf,
  TASKS_API,
  vtodoOf,
  type GoogleTask,
} from "../src/index.ts";

const tokens: TokenSource = { token: async () => "t", renew: async () => false };

/** The Tasks API, in memory, with the one list "Inbox". */
function tasksApi() {
  let version = 0;
  let clock = Date.UTC(2026, 10, 4, 9);
  const tasks = new Map<string, Record<string, unknown>>();
  const asked: HttpRequest[] = [];
  const put = (task: Record<string, unknown>) => {
    version += 1;
    clock += 1000;
    const kept = { ...task, etag: `"e${version}"`, updated: new Date(clock).toISOString() };
    tasks.set(String(task["id"]), kept);
    return kept;
  };
  const json = (status: number, body: unknown) => ({
    status,
    url: "",
    header: () => "application/json",
    body: body === null ? "" : JSON.stringify(body),
  });
  const http: HttpClient = async (request) => {
    asked.push(request);
    if (request.headers["Authorization"] !== "Bearer t")
      return json(401, { error: "unauthorized" });
    const url = new URL(request.url);
    const path = url.pathname.replace("/tasks/v1/", "");
    if (path === "users/@me/lists") return json(200, { items: [{ id: "inbox", title: "Inbox" }] });
    const [, list, , id] = path.split("/");
    if (list !== "inbox") return json(404, { error: { code: 404 } });
    if (!id && request.method === "GET") {
      const since = url.searchParams.get("updatedMin");
      const items = [...tasks.values()].filter((task) => !since || String(task["updated"]) > since);
      return json(200, { items: since ? items : items.filter((task) => !task["deleted"]) });
    }
    if (!id && request.method === "POST") {
      const body = JSON.parse(String(request.body)) as Record<string, unknown>;
      return json(
        200,
        put({ ...body, id: `t${tasks.size + 1}`, position: "00000000000000000001" }),
      );
    }
    const task = tasks.get(decodeURIComponent(id!));
    if (!task || task["deleted"]) return json(404, { error: { code: 404 } });
    if (request.method === "GET") return json(200, task);
    if (request.method === "PATCH")
      return json(200, put({ ...task, ...(JSON.parse(String(request.body)) as object) }));
    if (request.method === "DELETE") {
      put({ ...task, deleted: true });
      return json(204, null);
    }
    return json(405, null);
  };
  return { http, asked, tasks, put, now: () => clock };
}

const LIST = `${TASKS_API}lists/inbox/tasks/`;

test("a task as a VTODO, and back as the fields Google keeps; what it cannot keep is named", () => {
  const task: GoogleTask = {
    id: "abc",
    etag: '"1"',
    title: "Buy milk, eggs; bread",
    notes: "two lines\nhere",
    due: "2026-11-10T00:00:00.000Z",
    status: "completed",
    completed: "2026-11-09T18:00:00.000Z",
    parent: "p1",
    position: "00000000000000000003",
    updated: "2026-11-09T18:00:00.000Z",
  };
  const ics = vtodoOf(task);
  expect(ics).toContain("SUMMARY:Buy milk\\, eggs\\; bread\r\n");
  expect(ics).toContain("DUE;VALUE=DATE:20261110\r\n");
  expect(ics).toContain("RELATED-TO:p1\r\n");
  expect(taskFieldsOf(ics)).toEqual({
    fields: {
      title: "Buy milk, eggs; bread",
      notes: "two lines\nhere",
      due: "2026-11-10T00:00:00.000Z",
      status: "completed",
    },
    dropped: [],
  });
  // An item made elsewhere, with what Google Tasks has no place for.
  const richer = ics
    .replace("DUE;VALUE=DATE:20261110", "DUE:20261110T170000Z\r\nPRIORITY:1\r\nCATEGORIES:home")
    .replace(
      "END:VTODO",
      "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VTODO",
    );
  expect(taskFieldsOf(richer).dropped.toSorted()).toEqual([
    "CATEGORIES",
    "DUE time",
    "PRIORITY",
    "VALARM",
  ]);
  expect(taskFieldsOf(richer).fields["due"]).toBe("2026-11-10T00:00:00.000Z");
});

test("a task list syncs both ways through the engine; a PATCH names only what Google keeps", async () => {
  const api = tasksApi();
  api.put({ id: "t1", title: "From the phone", status: "needsAction", position: "1" });
  const provider = new GoogleTasks(api.http, tokens, api.now);
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "g",
    serverUrl: TASKS_API,
    username: null,
  });
  await syncAccount(store, provider, account.id);
  const [list] = await store.calendars(account.id);
  expect(list).toMatchObject({ url: LIST, name: "Inbox", components: ["VTODO"] });
  const [first] = await store.tasks([list!.id]);
  expect(first?.ics).toContain("SUMMARY:From the phone");

  // Done here: one PATCH of title, notes, due and status, never its position.
  await store.saveLocal(
    list!.id,
    first!.ics.replace("STATUS:NEEDS-ACTION", "STATUS:COMPLETED"),
    first!.href!,
  );
  const report = await syncAccount(store, provider, account.id);
  expect(report).toMatchObject({ uploaded: 1, errors: [] });
  const patch = api.asked.find((request) => request.method === "PATCH")!;
  expect(Object.keys(JSON.parse(String(patch.body))).toSorted()).toEqual([
    "due",
    "notes",
    "status",
    "title",
  ]);
  expect(api.tasks.get("t1")).toMatchObject({ status: "completed", position: "1" });

  // Made here with a priority Google cannot keep: inserted, and that said.
  const made = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//EN\r\nBEGIN:VTODO\r\nUID:local-1\r\nDTSTAMP:20261104T080000Z\r\nSUMMARY:Call the bank\r\nPRIORITY:1\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;
  await store.saveLocal(list!.id, made);
  const created = await syncAccount(store, provider, account.id);
  expect(created.errors).toEqual([
    expect.objectContaining({ problem: "not-kept", detail: "PRIORITY" }),
  ]);
  expect([...api.tasks.values()].map((task) => task["title"])).toContain("Call the bank");

  // Deleted on Google: gone here at the next sync (updatedMin lists it as deleted).
  api.put({ ...api.tasks.get("t1")!, deleted: true });
  await syncAccount(store, provider, account.id);
  const left = await store.tasks([list!.id]);
  expect(left.map((task) => /SUMMARY:(.*)\r\n/.exec(task.ics)?.[1])).toEqual(["Call the bank"]);
  const listings = api.asked.filter(
    (request) => request.method === "GET" && request.url.startsWith(LIST),
  );
  expect(new URL(listings.at(-1)!.url).searchParams.get("updatedMin")).not.toBeNull();
});

test("one Google account, two APIs: each call goes to the one whose address it names", async () => {
  const calls: string[] = [];
  const fake = (name: string): Provider => ({
    calendars: async () => [
      {
        url: `${name}:cal`,
        name,
        color: null,
        components: ["VEVENT"],
        rights: { create: true, edit: true, delete: true },
      },
    ],
    changes: async (url) => (
      calls.push(`${name} changes ${url}`),
      { changed: [], removed: [], syncToken: null, ctag: null }
    ),
    fetch: async (href) => (calls.push(`${name} fetch ${href}`), null),
    create: async (href) => (calls.push(`${name} create ${href}`), { ok: true, href, etag: null }),
    update: async (href) => (calls.push(`${name} update ${href}`), { ok: true, href, etag: null }),
    remove: async (href) => (calls.push(`${name} remove ${href}`), { ok: true, href, etag: null }),
  });
  const google = new GoogleProvider(fake("caldav"), fake("tasks"));
  expect((await google.calendars()).map((calendar) => calendar.name)).toEqual(["caldav", "tasks"]);
  await google.changes(`${LIST}`, { syncToken: null, ctag: null }, new Map());
  await google.update(`${LIST}t1`, "x", null);
  await google.update("https://apidata.googleusercontent.com/caldav/v2/me/events/a.ics", "x", null);
  await google.remove("https://apidata.googleusercontent.com/caldav/v2/me/events/a.ics", null);
  expect(calls).toEqual([
    `tasks changes ${LIST}`,
    `tasks update ${LIST}t1`,
    "caldav update https://apidata.googleusercontent.com/caldav/v2/me/events/a.ics",
    "caldav remove https://apidata.googleusercontent.com/caldav/v2/me/events/a.ics",
  ]);
});
