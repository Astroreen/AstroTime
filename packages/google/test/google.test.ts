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
  CALENDAR_API,
  GOOGLE_CALDAV,
  googleProvider,
  GoogleProvider,
  GoogleTasks,
  taskFieldsOf,
  TASKS_API,
  vtodoOf,
  type GoogleTask,
} from "../src/index.ts";

const tokens: TokenSource = { token: async () => "t", renew: async () => false };

/** The Tasks API, in memory, with the one list "Inbox", paged by `maxResults` (2 here). */
function tasksApi(pageSize = 2) {
  let version = 0;
  // Google's own clock: `updated` and `updatedMin` are its, never the device's.
  let clock = Date.UTC(2026, 10, 4, 9);
  const tasks = new Map<string, Record<string, unknown>>();
  const asked: HttpRequest[] = [];
  const put = (task: Record<string, unknown>) => {
    version += 1;
    clock += 1000;
    const kept: Record<string, unknown> = {
      ...task,
      etag: `"e${version}"`,
      updated: new Date(clock).toISOString(),
    };
    for (const [key, value] of Object.entries(kept)) if (value === null) delete kept[key];
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
    const [, list, , id, action] = path.split("/");
    if (list !== "inbox") return json(404, { error: { code: 404 } });
    if (!id && request.method === "GET") {
      // updatedMin is inclusive, as Google's is.
      const since = url.searchParams.get("updatedMin");
      const all = [...tasks.values()].filter((task) =>
        since ? String(task["updated"]) >= since : !task["deleted"],
      );
      const from = Number(url.searchParams.get("pageToken") ?? "0");
      const items = all.slice(from, from + pageSize);
      return json(200, {
        items,
        ...(from + pageSize < all.length ? { nextPageToken: String(from + pageSize) } : {}),
      });
    }
    if (!id && request.method === "POST") {
      const body = JSON.parse(String(request.body)) as Record<string, unknown>;
      const parent = url.searchParams.get("parent");
      return json(
        200,
        put({ ...body, id: `t${tasks.size + 1}`, position: "1", ...(parent ? { parent } : {}) }),
      );
    }
    const task = tasks.get(decodeURIComponent(id!));
    if (!task || task["deleted"]) return json(404, { error: { code: 404 } });
    if (action === "move" && request.method === "POST")
      return json(200, put({ ...task, parent: url.searchParams.get("parent") }));
    if (request.method === "GET") return json(200, task);
    if (request.method === "PATCH")
      return json(200, put({ ...task, ...(JSON.parse(String(request.body)) as object) }));
    if (request.method === "DELETE") {
      put({ ...task, deleted: true });
      return json(204, null);
    }
    return json(405, null);
  };
  return { http, asked, tasks, put };
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
      completed: "2026-11-09T18:00:00.000Z",
    },
    parent: "p1",
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
  const provider = new GoogleTasks(api.http, tokens);
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

/** A task list synced into a store of its own, its tasks' summaries read back. */
async function synced(api: ReturnType<typeof tasksApi>) {
  const provider = new GoogleTasks(api.http, tokens);
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "g",
    serverUrl: TASKS_API,
    username: null,
  });
  const sync = () => syncAccount(store, provider, account.id);
  await sync();
  const [list] = await store.calendars(account.id);
  const summaries = async () =>
    (await store.tasks([list!.id]))
      .map((task) => /SUMMARY:(.*)\r\n/.exec(task.ics)?.[1])
      .toSorted();
  return { provider, store, list: list!, sync, summaries };
}

test("a task reopened here clears Google's completion time", async () => {
  const api = tasksApi();
  api.put({
    id: "t1",
    title: "Done once",
    status: "completed",
    completed: "2026-11-03T10:00:00.000Z",
  });
  const feed = await synced(api);
  const [task] = await feed.store.tasks([feed.list.id]);
  await feed.store.saveLocal(
    feed.list.id,
    task!.ics.replace("STATUS:COMPLETED", "STATUS:NEEDS-ACTION"),
    task!.href!,
  );
  await feed.sync();
  const patch = JSON.parse(
    String(api.asked.findLast((request) => request.method === "PATCH")!.body),
  );
  expect(patch).toMatchObject({ status: "needsAction", completed: null });
  expect(api.tasks.get("t1")).not.toHaveProperty("completed");
});

test("the next listing starts at Google's latest `updated`, whatever the device's clock says", async () => {
  const api = tasksApi();
  api.put({ id: "t1", title: "First" });
  const feed = await synced(api);
  const latest = String(api.tasks.get("t1")!["updated"]);
  // A device clock a day ahead or behind changes nothing: the token is Google's.
  api.put({ id: "t2", title: "Made just after" });
  await feed.sync();
  const listing = api.asked.findLast(
    (request) => request.method === "GET" && request.url.startsWith(LIST),
  )!;
  expect(new URL(listing.url).searchParams.get("updatedMin")).toBe(latest);
  expect(await feed.summaries()).toEqual(["First", "Made just after"]);
});

test("a subtask made here is inserted under its parent; a parent changed here is a move", async () => {
  const api = tasksApi();
  api.put({ id: "p1", title: "Parent" });
  api.put({ id: "p2", title: "Other parent" });
  const feed = await synced(api);
  const child = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//EN\r\nBEGIN:VTODO\r\nUID:c1\r\nDTSTAMP:20261104T080000Z\r\nSUMMARY:Child\r\nRELATED-TO:p1\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;
  await feed.store.saveLocal(feed.list.id, child);
  expect((await feed.sync()).errors).toEqual([]);
  const made = [...api.tasks.values()].find((task) => task["title"] === "Child")!;
  expect(made["parent"]).toBe("p1");
  const stored = (await feed.store.tasks([feed.list.id])).find((task) =>
    task.ics.includes("Child"),
  )!;
  await feed.store.saveLocal(
    feed.list.id,
    stored.ics.replace("RELATED-TO:p1", "RELATED-TO:p2"),
    stored.href!,
  );
  await feed.sync();
  expect(api.asked.some((request) => request.url.includes("/move?parent=p2"))).toBe(true);
  expect(api.tasks.get(String(made["id"]))!["parent"]).toBe("p2");
});

test("lines are folded at 75 octets: a Russian title stays whole and readable", () => {
  const title = "Купить подарки к Новому году для всей семьи и не забыть открытки бабушке";
  const ics = vtodoOf({ id: "ru", title, updated: "2026-11-04T09:00:00Z" });
  for (const line of ics.split("\r\n"))
    expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  expect(taskFieldsOf(ics).fields["title"]).toBe(title);
});

test("the first listing pages through every task and removes what Google no longer has", async () => {
  const api = tasksApi(2);
  for (const id of ["t1", "t2", "t3", "t4", "t5"]) api.put({ id, title: `Task ${id}` });
  const feed = await synced(api);
  expect(await feed.summaries()).toEqual(["Task t1", "Task t2", "Task t3", "Task t4", "Task t5"]);
  expect(api.asked.filter((request) => request.url.includes("pageToken="))).toHaveLength(2);
  // Gone from Google while no token is kept (a first sync again): removed here too.
  api.tasks.delete("t3");
  const known = new Map(
    (await feed.store.hrefs(feed.list.id)).map((entry) => [entry.href, entry.etag]),
  );
  const changes = await feed.provider.changes(LIST, { syncToken: null, ctag: null }, known);
  expect(changes.removed).toEqual([`${LIST}t3`]);
});

test("a removed task is gone; one already gone says so; an update gives back Google's etag, or gone", async () => {
  const api = tasksApi();
  api.put({ id: "t1", title: "To go" });
  const provider = new GoogleTasks(api.http, tokens);
  expect(await provider.remove(`${LIST}t1`)).toEqual({ ok: true, href: `${LIST}t1`, etag: null });
  expect(await provider.remove(`${LIST}t1`)).toEqual({ ok: false, reason: "gone" });
  api.put({ id: "t2", title: "Kept" });
  const ics = vtodoOf({ id: "t2", title: "Kept, renamed", updated: "2026-11-04T09:00:00Z" });
  const updated = await provider.update(`${LIST}t2`, ics);
  expect(updated).toMatchObject({
    ok: true,
    href: `${LIST}t2`,
    etag: api.tasks.get("t2")!["etag"],
  });
  expect(await provider.update(`${LIST}missing`, ics)).toEqual({ ok: false, reason: "gone" });
});

test("only a parent RELATED-TO naming a task of the list becomes the parent; any other is said not kept", async () => {
  const api = tasksApi();
  api.put({ id: "p1", title: "Parent" });
  const feed = await synced(api);
  const make = (uid: string, related: string) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//EN\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:20261104T080000Z\r\nSUMMARY:${uid}\r\n${related}END:VTODO\r\nEND:VCALENDAR\r\n`;
  await feed.store.saveLocal(feed.list.id, make("sibling", "RELATED-TO;RELTYPE=SIBLING:p1\r\n"));
  await feed.store.saveLocal(feed.list.id, make("orphan", "RELATED-TO:not-in-this-list\r\n"));
  await feed.store.saveLocal(feed.list.id, make("child", "RELATED-TO;RELTYPE=PARENT:p1\r\n"));
  const report = await feed.sync();
  const byTitle = (title: string) =>
    [...api.tasks.values()].find((task) => task["title"] === title)!;
  expect(byTitle("child")["parent"]).toBe("p1");
  expect(byTitle("sibling")).not.toHaveProperty("parent");
  expect(byTitle("orphan")).not.toHaveProperty("parent");
  expect(
    report.errors.filter((error) => error.problem === "not-kept").map((error) => error.detail),
  ).toEqual(["RELATED-TO", "RELATED-TO"]);
});

test("a task done here sends when it was done", async () => {
  const api = tasksApi();
  api.put({ id: "t1", title: "Do it", status: "needsAction" });
  const feed = await synced(api);
  const [task] = await feed.store.tasks([feed.list.id]);
  await feed.store.saveLocal(
    feed.list.id,
    task!.ics.replace("STATUS:NEEDS-ACTION", "STATUS:COMPLETED\r\nCOMPLETED:20261103T101500Z"),
    task!.href!,
  );
  await feed.sync();
  const patch = JSON.parse(
    String(api.asked.findLast((request) => request.method === "PATCH")!.body),
  );
  expect(patch).toMatchObject({ status: "completed", completed: "2026-11-03T10:15:00.000Z" });
});

test("the Tasks API failing (not enabled, its scope not given) leaves the calendars syncing and the lists as they were", async () => {
  const calendar = (url: string, name: string) => ({
    url,
    name,
    color: null,
    components: ["VEVENT" as const],
    rights: { create: true, edit: true, delete: true },
  });
  const events: Provider = {
    calendars: async () => [
      calendar("https://apidata.googleusercontent.com/caldav/v2/me/events/", "Me"),
    ],
    changes: async () => ({ changed: [], removed: [], syncToken: "s", ctag: null }),
    fetch: async () => null,
    create: async () => ({ ok: false, reason: "gone" }),
    update: async () => ({ ok: false, reason: "gone" }),
    remove: async () => ({ ok: false, reason: "gone" }),
  };
  let tasksUp = true;
  const tasks: Provider = {
    ...events,
    calendars: async () => {
      if (!tasksUp)
        throw new Error("Tasks API has not been used in project 123 before or it is disabled.");
      return [{ ...calendar(LIST, "Inbox"), components: ["VTODO"] }];
    },
  };
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "g",
    serverUrl: TASKS_API,
    username: null,
  });
  const google = new GoogleProvider(events, tasks);
  await syncAccount(store, google, account.id);
  expect((await store.calendars(account.id)).map((c) => c.name).toSorted()).toEqual([
    "Inbox",
    "Me",
  ]);
  tasksUp = false;
  const report = await syncAccount(store, google, account.id);
  // The lists stay, the calendars sync, and what failed is said.
  expect((await store.calendars(account.id)).map((c) => c.name).toSorted()).toEqual([
    "Inbox",
    "Me",
  ]);
  expect(report.errors).toEqual([
    expect.objectContaining({
      href: TASKS_API,
      problem: "failed",
      detail: expect.stringContaining("Tasks API"),
    }),
  ]);
  // Both failing is the sync's failure.
  const down: Provider = { ...events, calendars: async () => Promise.reject(new Error("offline")) };
  await expect(syncAccount(store, new GoogleProvider(down, down), account.id)).rejects.toThrow(
    "offline",
  );
});

test("a calendar made goes through the Calendar API, a task list through the Tasks API, each as its listing names it (D275)", async () => {
  const asked: { method: string; url: string; body: unknown; authorization: string | undefined }[] =
    [];
  const http: HttpClient = async (request) => {
    asked.push({
      method: request.method,
      url: request.url,
      body: request.body ? JSON.parse(String(request.body)) : null,
      authorization: request.headers["Authorization"],
    });
    const answer = request.url.startsWith(CALENDAR_API)
      ? { id: "c0ffee@group.calendar.google.com", summary: "Plans" }
      : { id: "MTIz", title: "Errands" };
    return { status: 200, url: request.url, header: () => null, body: JSON.stringify(answer) };
  };
  const provider = googleProvider(http, tokens, `${GOOGLE_CALDAV}astro@example.com/`);
  const calendar = await provider.makeCalendar({
    name: "Plans",
    color: "#4f8fd6",
    component: "VEVENT",
  });
  const list = await provider.makeCalendar({ name: "Errands", color: null, component: "VTODO" });
  expect(asked).toEqual([
    {
      method: "POST",
      url: `${CALENDAR_API}calendars`,
      body: { summary: "Plans" },
      authorization: "Bearer t",
    },
    {
      method: "POST",
      url: `${TASKS_API}users/@me/lists`,
      body: { title: "Errands" },
      authorization: "Bearer t",
    },
  ]);
  expect(calendar).toEqual({
    url: `${GOOGLE_CALDAV}c0ffee%40group.calendar.google.com/events/`,
    name: "Plans",
    color: null,
    components: ["VEVENT"],
    rights: { create: true, edit: true, delete: true },
  });
  expect(list).toMatchObject({ url: `${TASKS_API}lists/MTIz/tasks/`, components: ["VTODO"] });
});

test("a part that makes no calendars rejects, as every provider's makeCalendar does (D275)", async () => {
  const none: Provider = {
    calendars: async () => [],
    changes: async () => ({ changed: [], removed: [], syncToken: null, ctag: null }),
    fetch: async () => null,
    create: async () => ({ ok: false, reason: "gone" }),
    update: async () => ({ ok: false, reason: "gone" }),
    remove: async () => ({ ok: false, reason: "gone" }),
  };
  // No Calendar API given: a calendar of events is not made, said as a rejection.
  const made = new GoogleProvider(none, none).makeCalendar({
    name: "Plans",
    color: null,
    component: "VEVENT",
  });
  expect(made).toBeInstanceOf(Promise);
  await expect(made).rejects.toEqual(
    expect.objectContaining({ name: "CannotMakeCalendarError", reason: "unsupported" }),
  );
});
