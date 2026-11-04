// Microsoft (docs/plans/providers.md#D253) against a fake Graph that keeps
// what the real one keeps: calendars and To Do lists, items with their
// `@odata.etag`, `If-Match` refused with 412, pages by `@odata.nextLink`,
// a series' exceptions from `instances`. Through the sync engine and a real
// store: both ways, a PATCH of what changed only.
import type { HttpClient, HttpRequest, TokenSource } from "@astrotime/caldav";
import type { Provider } from "@astrotime/core";
import { Store } from "@astrotime/storage";
import { nodeDriver } from "@astrotime/storage/node";
import { syncAccount } from "@astrotime/sync";
import { expect, test } from "vite-plus/test";

import {
  GRAPH,
  Graph,
  MicrosoftProvider,
  MicrosoftTodo,
  OutlookCalendars,
  recurrenceOf,
  rruleOf,
  veventOf,
  type GraphEvent,
} from "../src/index.ts";

const tokens: TokenSource = { token: async () => "t", renew: async () => false };

/** Graph in memory: one calendar "Work", one To Do list "Tasks", pages of 2. */
function graphApi() {
  let version = 0;
  const events = new Map<string, Record<string, unknown>>();
  const exceptions = new Map<string, Record<string, unknown>[]>();
  const tasks = new Map<string, Record<string, unknown>>();
  const asked: HttpRequest[] = [];
  const keep = (store: Map<string, Record<string, unknown>>, item: Record<string, unknown>) => {
    version += 1;
    const kept = {
      ...item,
      "@odata.etag": `W/"${version}"`,
      lastModifiedDateTime: `2026-11-04T09:00:${String(version % 60).padStart(2, "0")}Z`,
    };
    store.set(String(item["id"]), kept);
    return kept;
  };
  const json = (status: number, body: unknown) => ({
    status,
    url: "",
    header: () => "application/json",
    body: body === null ? "" : JSON.stringify(body),
  });
  const page = (url: URL, items: unknown[]) => {
    const skip = Number(url.searchParams.get("$skip") ?? "0");
    const next = new URL(url.href);
    next.searchParams.set("$skip", String(skip + 2));
    return json(200, {
      value: items.slice(skip, skip + 2),
      ...(skip + 2 < items.length ? { "@odata.nextLink": next.href } : {}),
    });
  };
  const http: HttpClient = async (request) => {
    asked.push(request);
    if (request.headers["Authorization"] !== "Bearer t")
      return json(401, { error: { code: "InvalidAuthenticationToken" } });
    const url = new URL(request.url);
    const path = url.pathname.replace("/v1.0/", "");
    const body = request.body ? (JSON.parse(String(request.body)) as Record<string, unknown>) : {};
    const match = (store: Map<string, Record<string, unknown>>, id: string) => {
      const item = store.get(id);
      if (!item) return { error: json(404, { error: { code: "ErrorItemNotFound" } }) };
      const ifMatch = request.headers["If-Match"];
      if (ifMatch && ifMatch !== item["@odata.etag"])
        return { error: json(412, { error: { code: "ErrorIrresolvableConflict" } }) };
      return { item };
    };
    let m: RegExpExecArray | null;
    if (path === "me/calendars")
      return page(url, [{ id: "work", name: "Work", hexColor: "#3f7be0", canEdit: true }]);
    if (path === "me/todo/lists") return page(url, [{ id: "tasks", displayName: "Tasks" }]);
    if (path === "me/calendars/work/events") {
      if (request.method === "POST")
        return json(
          201,
          keep(events, {
            ...body,
            id: `e${events.size + 1}`,
            iCalUId: `uid-${events.size + 1}`,
            type: body["recurrence"] ? "seriesMaster" : "singleInstance",
          }),
        );
      return page(url, [...events.values()]);
    }
    if ((m = /^me\/events\/([^/]+)\/instances$/.exec(path)))
      return page(url, exceptions.get(m[1]!) ?? []);
    if ((m = /^me\/events\/([^/]+)$/.exec(path))) {
      const found = match(events, decodeURIComponent(m[1]!));
      if (found.error) return found.error;
      if (request.method === "GET") return json(200, found.item);
      if (request.method === "PATCH") return json(200, keep(events, { ...found.item, ...body }));
      if (request.method === "DELETE")
        return (events.delete(String(found.item!["id"])), json(204, null));
    }
    if (path === "me/todo/lists/tasks/tasks") {
      if (request.method === "POST")
        return json(201, keep(tasks, { ...body, id: `k${tasks.size + 1}` }));
      return page(url, [...tasks.values()]);
    }
    if ((m = /^me\/todo\/lists\/tasks\/tasks\/([^/]+)$/.exec(path))) {
      const found = match(tasks, decodeURIComponent(m[1]!));
      if (found.error) return found.error;
      if (request.method === "GET") return json(200, found.item);
      if (request.method === "PATCH") return json(200, keep(tasks, { ...found.item, ...body }));
      if (request.method === "DELETE")
        return (tasks.delete(String(found.item!["id"])), json(204, null));
    }
    return json(400, { error: { code: "BadRequest", path } });
  };
  return { http, asked, events, exceptions, tasks, keep };
}

const at = (dateTime: string) => ({ dateTime, timeZone: "UTC" });

test("Graph's recurrence and an RRULE, both ways, for every shape Graph has; another shape is none", () => {
  const start = "2026-11-02";
  const shapes = [
    "FREQ=DAILY;INTERVAL=2;COUNT=5",
    "FREQ=WEEKLY;BYDAY=MO,WE;WKST=MO",
    "FREQ=MONTHLY;BYMONTHDAY=15",
    "FREQ=MONTHLY;BYDAY=-1FR",
    "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=8",
    "FREQ=YEARLY;BYMONTH=11;BYDAY=4TH",
  ];
  for (const rule of shapes) expect(rruleOf(recurrenceOf(rule, start)!, true), rule).toBe(rule);
  expect(rruleOf(recurrenceOf("FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T235959Z", start)!, false)).toBe(
    "FREQ=WEEKLY;BYDAY=TU;UNTIL=20261231T235959Z",
  );
  // Shapes Graph cannot say.
  for (const rule of [
    "FREQ=HOURLY",
    "FREQ=MONTHLY;BYDAY=1MO,3WE",
    "FREQ=WEEKLY;BYSETPOS=1;BYDAY=MO",
  ])
    expect(recurrenceOf(rule, start), rule).toBeNull();
});

test("a calendar syncs both ways through the engine: events, a series with its exception, a PATCH of what changed", async () => {
  const api = graphApi();
  api.keep(api.events, {
    id: "e1",
    iCalUId: "single",
    subject: "Planning, Q4",
    start: at("2026-11-04T09:00:00.0000000"),
    end: at("2026-11-04T10:00:00.0000000"),
    type: "singleInstance",
    location: { displayName: "Room 4" },
  });
  api.keep(api.events, {
    id: "e2",
    iCalUId: "allday",
    subject: "Off",
    isAllDay: true,
    start: at("2026-11-06T00:00:00.0000000"),
    end: at("2026-11-07T00:00:00.0000000"),
    type: "singleInstance",
  });
  api.keep(api.events, {
    id: "e3",
    iCalUId: "weekly",
    subject: "Standup",
    start: at("2026-11-02T08:00:00.0000000"),
    end: at("2026-11-02T08:15:00.0000000"),
    type: "seriesMaster",
    recurrence: {
      pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"], firstDayOfWeek: "monday" },
      range: { type: "noEnd", startDate: "2026-11-02" },
    },
  });
  api.exceptions.set("e3", [
    {
      id: "x1",
      type: "exception",
      subject: "Standup, later",
      originalStart: "2026-11-09T08:00:00Z",
      start: at("2026-11-09T10:00:00.0000000"),
      end: at("2026-11-09T10:15:00.0000000"),
      "@odata.etag": 'W/"x1"',
    },
  ]);
  const provider = new OutlookCalendars(new Graph(api.http, tokens), () => Date.UTC(2026, 10, 4));
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "m",
    serverUrl: GRAPH,
    username: null,
  });
  await syncAccount(store, provider, account.id);
  const [calendar] = await store.calendars(account.id);
  expect(calendar).toMatchObject({ name: "Work", color: "#3f7be0", components: ["VEVENT"] });
  const objects = await store.objectsBetween([calendar!.id], {
    from: "2026-11-01",
    to: "2026-11-30",
    timeZone: "UTC",
  });
  const by = (uid: string) => objects.find((object) => object.ics.includes(`UID:${uid}`))!.ics;
  expect(by("single")).toContain("DTSTART:20261104T090000Z");
  expect(by("single")).toContain("SUMMARY:Planning\\, Q4");
  expect(by("allday")).toContain("DTSTART;VALUE=DATE:20261106");
  expect(by("weekly")).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO;WKST=MO");
  expect(by("weekly")).toContain("RECURRENCE-ID:20261109T080000Z");
  // Pages followed: three events, two to a page.
  expect(
    api.asked.filter((r) => new URL(r.url).searchParams.get("$skip") === "2"),
  ).not.toHaveLength(0);

  // Renamed here: one PATCH of the subject alone, with the event's If-Match.
  const single = objects.find((object) => object.ics.includes("UID:single"))!;
  await store.saveLocal(
    calendar!.id,
    single.ics.replace("SUMMARY:Planning\\, Q4", "SUMMARY:Planning\\, Q1"),
    single.href!,
  );
  const instancesBefore = api.asked.filter((r) => r.url.includes("/instances")).length;
  expect((await syncAccount(store, provider, account.id)).errors).toEqual([]);
  const patch = api.asked.findLast((r) => r.method === "PATCH")!;
  expect(JSON.parse(String(patch.body))).toEqual({ subject: "Planning, Q1" });
  expect(patch.headers["If-Match"]).toMatch(/^W\/"\d+"$/);
  expect(api.events.get("e1")).toMatchObject({
    subject: "Planning, Q1",
    location: { displayName: "Room 4" },
  });
  // The series' master unchanged: its exceptions were not asked again.
  expect(api.asked.filter((r) => r.url.includes("/instances")).length).toBe(instancesBefore);

  // Deleted in Outlook: gone here.
  api.events.delete("e2");
  await syncAccount(store, provider, account.id);
  const left = await store.objectsBetween([calendar!.id], {
    from: "2026-11-01",
    to: "2026-11-30",
    timeZone: "UTC",
  });
  expect(left.some((object) => object.ics.includes("UID:allday"))).toBe(false);
});

test("an event changed in Outlook first is a conflict; one gone is gone; what Graph cannot keep is said", async () => {
  const api = graphApi();
  api.keep(api.events, {
    id: "e1",
    iCalUId: "u1",
    subject: "Lunch",
    start: at("2026-11-04T12:00:00.0000000"),
    end: at("2026-11-04T13:00:00.0000000"),
    type: "singleInstance",
  });
  const provider = new OutlookCalendars(new Graph(api.http, tokens));
  const href = `${GRAPH}me/calendars/work/events/e1`;
  const ics = veventOf(api.events.get("e1") as unknown as GraphEvent).replace(
    "SUMMARY:Lunch",
    "SUMMARY:Late lunch",
  );
  expect(await provider.update(href, ics, 'W/"old"')).toEqual({ ok: false, reason: "conflict" });
  const withAlarm = ics.replace(
    "END:VEVENT",
    "BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nEND:VALARM\r\nEND:VEVENT",
  );
  const written = await provider.update(
    href,
    withAlarm,
    String(api.events.get("e1")!["@odata.etag"]),
  );
  expect(written).toMatchObject({ ok: true, dropped: ["VALARM"] });
  expect(await provider.remove(`${GRAPH}me/calendars/work/events/missing`, null)).toEqual({
    ok: false,
    reason: "gone",
  });
  expect(await provider.remove(href, 'W/"old"')).toEqual({ ok: false, reason: "conflict" });
  expect(await provider.remove(href, String(api.events.get("e1")!["@odata.etag"]))).toMatchObject({
    ok: true,
  });
});

test("a series: its master's edit is a PATCH of the master; an occurrence's own edit is said not kept", async () => {
  const api = graphApi();
  api.keep(api.events, {
    id: "s1",
    iCalUId: "series",
    subject: "Standup",
    start: at("2026-11-02T08:00:00.0000000"),
    end: at("2026-11-02T08:15:00.0000000"),
    type: "seriesMaster",
    recurrence: {
      pattern: { type: "daily", interval: 1 },
      range: { type: "numbered", startDate: "2026-11-02", numberOfOccurrences: 10 },
    },
  });
  api.exceptions.set("s1", [
    {
      id: "x1",
      type: "exception",
      subject: "Standup, moved",
      originalStart: "2026-11-04T08:00:00Z",
      start: at("2026-11-04T09:00:00.0000000"),
      end: at("2026-11-04T09:15:00.0000000"),
      "@odata.etag": 'W/"x1"',
    },
  ]);
  const provider = new OutlookCalendars(new Graph(api.http, tokens), () => Date.UTC(2026, 10, 4));
  const href = `${GRAPH}me/calendars/work/events/s1`;
  const read = (await provider.fetch(href))!;
  expect(read.ics).toContain("RRULE:FREQ=DAILY;COUNT=10");
  expect(read.ics).toContain("SUMMARY:Standup\\, moved");
  const renamed = read.ics.replace("SUMMARY:Standup\r\n", "SUMMARY:Daily\r\n");
  expect(await provider.update(href, renamed, read.etag)).toEqual({
    ok: true,
    href,
    etag: expect.stringContaining('W/"x1"'),
  });
  expect(JSON.parse(String(api.asked.findLast((r) => r.method === "PATCH")!.body))).toEqual({
    subject: "Daily",
  });
  const again = (await provider.fetch(href))!;
  const occurrenceEdited = again.ics.replace(
    "SUMMARY:Standup\\, moved",
    "SUMMARY:Standup\\, cancelled?",
  );
  expect(await provider.update(href, occurrenceEdited, again.etag)).toMatchObject({
    ok: true,
    dropped: ["RECURRENCE-ID"],
  });
  expect(api.events.get("s1")).toMatchObject({ subject: "Daily" });
});

test("a To Do list syncs both ways; importance is a priority; a PATCH names what changed only", async () => {
  const api = graphApi();
  api.keep(api.tasks, {
    id: "k1",
    title: "Pay rent",
    status: "notStarted",
    importance: "high",
    dueDateTime: at("2026-11-30T00:00:00.0000000"),
    categories: ["home"],
  });
  const provider = new MicrosoftTodo(new Graph(api.http, tokens));
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "m",
    serverUrl: GRAPH,
    username: null,
  });
  await syncAccount(store, provider, account.id);
  const [list] = await store.calendars(account.id);
  expect(list).toMatchObject({ name: "Tasks", components: ["VTODO"] });
  const [task] = await store.tasks([list!.id]);
  expect(task!.ics).toContain("PRIORITY:1");
  expect(task!.ics).toContain("DUE;VALUE=DATE:20261130");
  expect(task!.ics).toContain("CATEGORIES:home");
  await store.saveLocal(
    list!.id,
    task!.ics.replace("STATUS:NEEDS-ACTION", "STATUS:COMPLETED"),
    task!.href!,
  );
  expect((await syncAccount(store, provider, account.id)).errors).toEqual([]);
  const patch = api.asked.findLast((r) => r.method === "PATCH")!;
  expect(JSON.parse(String(patch.body))).toEqual({ status: "completed" });
  expect(api.tasks.get("k1")).toMatchObject({ status: "completed", importance: "high" });
  // Made here with a reminder and a rule: inserted, and that said.
  await store.saveLocal(
    list!.id,
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//EN\r\nBEGIN:VTODO\r\nUID:n1\r\nDTSTAMP:20261104T080000Z\r\nSUMMARY:Water the plants\r\nRRULE:FREQ=WEEKLY\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT1H\r\nEND:VALARM\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`,
  );
  const made = await syncAccount(store, provider, account.id);
  expect(made.errors).toEqual([
    expect.objectContaining({ problem: "not-kept", detail: "RRULE, VALARM" }),
  ]);
});

test("one Microsoft account, two parts: To Do failing leaves the calendars syncing and its lists as they were", async () => {
  const api = graphApi();
  const graph = new Graph(api.http, tokens);
  let todoUp = true;
  const todo = new MicrosoftTodo(graph);
  const failing: Provider = {
    ...todo,
    calendars: () =>
      todoUp ? todo.calendars() : Promise.reject(new Error("Tasks.ReadWrite not granted")),
    changes: (url, state, known) => todo.changes(url, state, known),
    fetch: (href) => todo.fetch(href),
    create: (href, ics) => todo.create(href, ics),
    update: (href, ics, etag) => todo.update(href, ics, etag),
    remove: (href, etag) => todo.remove(href, etag),
  };
  const microsoft = new MicrosoftProvider(new OutlookCalendars(graph), failing);
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "m",
    serverUrl: GRAPH,
    username: null,
  });
  await syncAccount(store, microsoft, account.id);
  expect((await store.calendars(account.id)).map((c) => c.name).toSorted()).toEqual([
    "Tasks",
    "Work",
  ]);
  todoUp = false;
  const report = await syncAccount(store, microsoft, account.id);
  expect((await store.calendars(account.id)).map((c) => c.name).toSorted()).toEqual([
    "Tasks",
    "Work",
  ]);
  expect(report.errors).toEqual([
    expect.objectContaining({
      href: `${GRAPH}me/todo/`,
      problem: "failed",
      detail: "Tasks.ReadWrite not granted",
    }),
  ]);
});
