// Microsoft (docs/plans/providers.md#D253) against a fake Graph that keeps
// what the real one keeps: calendars and To Do lists, items with their
// `@odata.etag`, `If-Match` refused with 412, pages by `@odata.nextLink`,
// a series' exceptions from `instances`. Through the sync engine and a real
// store: both ways, a PATCH of what changed only.
import {
  followRedirects,
  type HttpClient,
  type HttpRequest,
  type TokenSource,
} from "@astrotime/caldav";
import {
  AuthError,
  CalendarObject,
  OfflineError,
  occurrencesBetween,
  type Provider,
} from "@astrotime/core";
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
      if (request.method === "POST") {
        // Graph's own dedup: a POST with a `transactionId` it has seen is the event it made then.
        const made = [...events.values()].find(
          (event) => body["transactionId"] && event["transactionId"] === body["transactionId"],
        );
        if (made) return json(201, made);
        return json(
          201,
          keep(events, {
            ...body,
            id: `e${events.size + 1}`,
            iCalUId: `uid-${events.size + 1}`,
            type: body["recurrence"] ? "seriesMaster" : "singleInstance",
          }),
        );
      }
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
    etag: expect.stringContaining('~"x1"'),
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

test("a rule that leaves its days to the start (bare FREQ=WEEKLY, MONTHLY, YEARLY) is Graph's from the start's day", () => {
  const wednesday = "2026-11-04";
  expect(recurrenceOf("FREQ=WEEKLY", wednesday)?.pattern).toMatchObject({
    type: "weekly",
    daysOfWeek: ["wednesday"],
  });
  expect(recurrenceOf("FREQ=MONTHLY;INTERVAL=2", wednesday)?.pattern).toMatchObject({
    type: "absoluteMonthly",
    dayOfMonth: 4,
    interval: 2,
  });
  expect(recurrenceOf("FREQ=YEARLY", wednesday)?.pattern).toMatchObject({
    type: "absoluteYearly",
    month: 11,
    dayOfMonth: 4,
  });
  expect(recurrenceOf("FREQ=YEARLY;BYMONTHDAY=8", wednesday)?.pattern).toMatchObject({
    type: "absoluteYearly",
    month: 11,
    dayOfMonth: 8,
  });
  // The year's 20th Monday, with no month: Graph has no such shape.
  expect(recurrenceOf("FREQ=YEARLY;BYDAY=20MO", wednesday)).toBeNull();
});

test("a series removed, a place removed: the PATCH names them, null and empty, and Graph's event is single", async () => {
  const api = graphApi();
  api.keep(api.events, {
    id: "s1",
    iCalUId: "series",
    subject: "Review",
    location: { displayName: "Room 4" },
    start: at("2026-11-02T08:00:00.0000000"),
    end: at("2026-11-02T09:00:00.0000000"),
    type: "seriesMaster",
    recurrence: {
      pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] },
      range: { type: "noEnd", startDate: "2026-11-02" },
    },
  });
  const provider = new OutlookCalendars(new Graph(api.http, tokens), () => Date.UTC(2026, 10, 4));
  const href = `${GRAPH}me/calendars/work/events/s1`;
  const read = (await provider.fetch(href))!;
  const single = read.ics.replace(/RRULE:[^\r]*\r\n/, "").replace("LOCATION:Room 4\r\n", "");
  expect(await provider.update(href, single, read.etag)).toMatchObject({ ok: true });
  expect(JSON.parse(String(api.asked.findLast((r) => r.method === "PATCH")!.body))).toEqual({
    recurrence: null,
    location: { displayName: "" },
  });
  expect(api.events.get("s1")).toMatchObject({ recurrence: null, location: { displayName: "" } });
  expect((await provider.fetch(href))!.ics).not.toContain("RRULE");
});

test("a weekly series made in Berlin keeps 09:00 across the DST change; its end day is its zone's", async () => {
  const api = graphApi();
  // Graph gives instants (Prefer: UTC) and the zone the event was made in, by its Windows name.
  api.keep(api.events, {
    id: "s1",
    iCalUId: "berlin",
    subject: "Standup",
    originalStartTimeZone: "W. Europe Standard Time",
    originalEndTimeZone: "W. Europe Standard Time",
    start: at("2026-10-19T07:00:00.0000000"),
    end: at("2026-10-19T07:15:00.0000000"),
    type: "seriesMaster",
    recurrence: {
      pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] },
      range: { type: "endDate", startDate: "2026-10-19", endDate: "2026-11-09" },
    },
  });
  api.exceptions.set("s1", [
    {
      id: "x1",
      // An exception's own iCalUId differing from its master's: the object keeps one UID (D34).
      iCalUId: "another",
      type: "exception",
      subject: "Standup, later",
      originalStartTimeZone: "W. Europe Standard Time",
      originalStart: "2026-11-02T08:00:00Z",
      start: at("2026-11-02T09:00:00.0000000"),
      end: at("2026-11-02T09:15:00.0000000"),
      "@odata.etag": 'W/"x1"',
    },
  ]);
  const provider = new OutlookCalendars(
    new Graph(api.http, tokens),
    () => Date.UTC(2026, 10, 4),
    "Europe/Vilnius",
  );
  const href = `${GRAPH}me/calendars/work/events/s1`;
  const read = (await provider.fetch(href))!;
  expect(read.ics).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/Berlin");
  expect(read.ics).toContain("DTSTART;TZID=Europe/Berlin:20261019T090000");
  expect(read.ics).toContain("RECURRENCE-ID;TZID=Europe/Berlin:20261102T090000");
  expect(read.ics).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261109T225959Z");
  expect(read.ics).not.toContain("UID:another");
  const object = CalendarObject.parse(read.ics);
  const starts = occurrencesBetween(object, {
    from: "2026-10-19",
    to: "2026-11-16",
    timeZone: "Europe/Berlin",
  }).map((o) =>
    o.start.type === "zoned" ? [o.start.local, new Date(o.start.epochMs).toISOString()] : [],
  );
  // CEST before 25 October, CET after: the wall clock stays, the instant moves; the 2nd moved to 10:00.
  expect(starts).toEqual([
    ["2026-10-19T09:00:00", "2026-10-19T07:00:00.000Z"],
    ["2026-10-26T09:00:00", "2026-10-26T08:00:00.000Z"],
    ["2026-11-02T10:00:00", "2026-11-02T09:00:00.000Z"],
    ["2026-11-09T09:00:00", "2026-11-09T08:00:00.000Z"],
  ]);
  // Renamed here: the times read back as they were sent, so only the subject changes.
  const renamed = read.ics.replace("SUMMARY:Standup\r\n", "SUMMARY:Daily\r\n");
  expect(await provider.update(href, renamed, read.etag)).toMatchObject({ ok: true });
  expect(JSON.parse(String(api.asked.findLast((r) => r.method === "PATCH")!.body))).toEqual({
    subject: "Daily",
  });
  // An end day read in its own zone, where UNTIL's UTC is the next day.
  const rule = rruleOf(
    {
      pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] },
      range: { type: "endDate", startDate: "2026-11-02", endDate: "2026-12-28" },
    },
    false,
    "America/New_York",
  );
  expect(rule).toBe("FREQ=WEEKLY;BYDAY=MO;UNTIL=20261229T045959Z");
  expect(recurrenceOf(rule, "2026-11-02", "America/New_York")?.range).toMatchObject({
    type: "endDate",
    endDate: "2026-12-28",
  });
});

test("Monday 01:00 in Moscow is Sunday in UTC: the start is written in Moscow, BYDAY and DTSTART agree", async () => {
  const api = graphApi();
  api.keep(api.events, {
    id: "m1",
    iCalUId: "moscow",
    subject: "Early",
    originalStartTimeZone: "Europe/Moscow",
    start: at("2026-11-01T22:00:00.0000000"),
    end: at("2026-11-01T22:30:00.0000000"),
    type: "seriesMaster",
    recurrence: {
      pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] },
      range: { type: "noEnd", startDate: "2026-11-02" },
    },
  });
  const provider = new OutlookCalendars(new Graph(api.http, tokens), () => Date.UTC(2026, 10, 4));
  const read = (await provider.fetch(`${GRAPH}me/calendars/work/events/m1`))!;
  expect(read.ics).toContain("DTSTART;TZID=Europe/Moscow:20261102T010000");
  const [first] = occurrencesBetween(CalendarObject.parse(read.ics), {
    from: "2026-11-01",
    to: "2026-11-10",
    timeZone: "Europe/Moscow",
  });
  expect(first!.start).toMatchObject({
    local: "2026-11-02T01:00:00",
    epochMs: Date.UTC(2026, 10, 1, 22),
  });
});

test("a floating time is written in the user's zone, a TZID in its own (a Windows name as IANA's), Z in UTC", async () => {
  const api = graphApi();
  const provider = new OutlookCalendars(new Graph(api.http, tokens), Date.now, "Europe/Berlin");
  const make = (uid: string, start: string, end: string) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//EN\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261104T080000Z\r\n${start}\r\n${end}\r\nSUMMARY:${uid}\r\nRRULE:FREQ=WEEKLY\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  const posted = async (ics: string) => {
    expect(await provider.create(`${GRAPH}me/calendars/work/events/new`, ics)).toEqual(
      expect.not.objectContaining({ dropped: expect.anything() }),
    );
    return JSON.parse(String(api.asked.findLast((r) => r.method === "POST")!.body)) as Record<
      string,
      unknown
    >;
  };
  const floating = await posted(make("f", "DTSTART:20261110T090000", "DTEND:20261110T100000"));
  expect(floating).toMatchObject({
    start: { dateTime: "2026-11-10T09:00:00", timeZone: "Europe/Berlin" },
    end: { dateTime: "2026-11-10T10:00:00", timeZone: "Europe/Berlin" },
    // Bare FREQ=WEEKLY: the start's Tuesday.
    recurrence: { pattern: { type: "weekly", daysOfWeek: ["tuesday"] } },
  });
  const windows = await posted(
    make("w", 'DTSTART;TZID="Pacific Standard Time":20261110T090000', "DURATION:PT45M"),
  );
  expect(windows).toMatchObject({
    start: { dateTime: "2026-11-10T09:00:00", timeZone: "America/Los_Angeles" },
    end: { dateTime: "2026-11-10T09:45:00", timeZone: "America/Los_Angeles" },
  });
  const utc = await posted(make("u", "DTSTART:20261110T090000Z", "DTEND:20261110T093000Z"));
  expect(utc).toMatchObject({ start: { dateTime: "2026-11-10T09:00:00", timeZone: "UTC" } });
});

test("a To Do task with no ETag on either side is fetched again, never taken as unchanged (D37)", async () => {
  const api = graphApi();
  api.tasks.set("k1", { id: "k1", title: "No etag", status: "notStarted" });
  const todo = new MicrosoftTodo(new Graph(api.http, tokens));
  const url = `${GRAPH}me/todo/lists/tasks/tasks/`;
  const changes = await todo.changes(
    url,
    { syncToken: null, ctag: null },
    new Map([[`${url}k1`, null]]),
  );
  expect(changes.changed.map((object) => object.href)).toEqual([`${url}k1`]);
});

test("an all-day event east of UTC stays on its day: Vilnius, Tokyo, a zone no database knows, a series' exception", async () => {
  const api = graphApi();
  // Graph gives an all-day event's midnight as an instant: 6 November in Vilnius starts on the 5th in UTC.
  const allDay = (id: string, zone: string, start: string, end: string) =>
    api.keep(api.events, {
      id,
      iCalUId: id,
      subject: id,
      isAllDay: true,
      originalStartTimeZone: zone,
      originalEndTimeZone: zone,
      start: at(start),
      end: at(end),
      type: "singleInstance",
    });
  allDay(
    "vilnius",
    "FLE Standard Time",
    "2026-11-05T22:00:00.0000000",
    "2026-11-06T22:00:00.0000000",
  );
  allDay(
    "tokyo",
    "Tokyo Standard Time",
    "2026-11-05T15:00:00.0000000",
    "2026-11-06T15:00:00.0000000",
  );
  allDay(
    "custom",
    "Customized Time Zone",
    "2026-11-05T22:00:00.0000000",
    "2026-11-06T22:00:00.0000000",
  );
  api.keep(api.events, {
    id: "s1",
    iCalUId: "holidays",
    subject: "Off",
    isAllDay: true,
    originalStartTimeZone: "Europe/Vilnius",
    start: at("2026-11-01T22:00:00.0000000"),
    end: at("2026-11-02T22:00:00.0000000"),
    type: "seriesMaster",
    recurrence: {
      pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] },
      range: { type: "numbered", startDate: "2026-11-02", numberOfOccurrences: 3 },
    },
  });
  api.exceptions.set("s1", [
    {
      id: "x1",
      type: "exception",
      isAllDay: true,
      subject: "Off, moved",
      originalStartTimeZone: "Europe/Vilnius",
      originalStart: "2026-11-08T22:00:00Z",
      start: at("2026-11-09T22:00:00.0000000"),
      end: at("2026-11-10T22:00:00.0000000"),
      "@odata.etag": 'W/"x1"',
    },
  ]);
  const provider = new OutlookCalendars(
    new Graph(api.http, tokens),
    () => Date.UTC(2026, 10, 4),
    "Europe/Vilnius",
  );
  const read = async (id: string) =>
    (await provider.fetch(`${GRAPH}me/calendars/work/events/${id}`))!;
  for (const id of ["vilnius", "tokyo", "custom"]) {
    const { ics } = await read(id);
    expect(ics, id).toContain("DTSTART;VALUE=DATE:20261106\r\n");
    expect(ics, id).toContain("DTEND;VALUE=DATE:20261107\r\n");
    expect(ics, id).not.toContain("VTIMEZONE");
  }
  const series = await read("s1");
  expect(series.ics).toContain("DTSTART;VALUE=DATE:20261102\r\n");
  expect(series.ics).toContain("RECURRENCE-ID;VALUE=DATE:20261109\r\n");
  expect(series.ics).toContain("DTSTART;VALUE=DATE:20261110\r\n");
  // Read back as it was written: a rename sends the subject alone; a day made here is the user's midnight.
  const vilnius = await read("vilnius");
  await provider.update(
    `${GRAPH}me/calendars/work/events/vilnius`,
    vilnius.ics.replace("SUMMARY:vilnius", "SUMMARY:Holiday"),
    vilnius.etag,
  );
  expect(JSON.parse(String(api.asked.findLast((r) => r.method === "PATCH")!.body))).toEqual({
    subject: "Holiday",
  });
  await provider.create(
    `${GRAPH}me/calendars/work/events/new`,
    vilnius.ics.replace("UID:vilnius", "UID:made-here"),
  );
  expect(JSON.parse(String(api.asked.findLast((r) => r.method === "POST")!.body))).toMatchObject({
    isAllDay: true,
    start: { dateTime: "2026-11-06T00:00:00", timeZone: "Europe/Vilnius" },
    end: { dateTime: "2026-11-07T00:00:00", timeZone: "Europe/Vilnius" },
  });
});

test("a month-day list or one from the end is no shape of Graph's: the event is kept, its rule said not kept, nothing NaN sent", async () => {
  for (const rule of [
    "FREQ=MONTHLY;BYMONTHDAY=1,15",
    "FREQ=MONTHLY;BYMONTHDAY=-1",
    "FREQ=YEARLY;BYMONTH=1,6",
    "FREQ=YEARLY;BYMONTH=13",
    "FREQ=DAILY;INTERVAL=0",
    "FREQ=DAILY;COUNT=-2",
  ])
    expect(recurrenceOf(rule, "2026-11-04"), rule).toBeNull();
  const api = graphApi();
  const provider = new OutlookCalendars(new Graph(api.http, tokens), Date.now, "Europe/Vilnius");
  const written = await provider.create(
    `${GRAPH}me/calendars/work/events/new`,
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//EN\r\nBEGIN:VEVENT\r\nUID:pay\r\nDTSTAMP:20261104T080000Z\r\nDTSTART;VALUE=DATE:20261130\r\nSUMMARY:Pay day\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  );
  expect(written).toMatchObject({ ok: true, dropped: ["RRULE"] });
  const body = String(api.asked.findLast((r) => r.method === "POST")!.body);
  expect(JSON.parse(body)).not.toHaveProperty("recurrence");
  expect(body).not.toContain("NaN");
  expect(JSON.parse(body)).toMatchObject({
    subject: "Pay day",
    start: { dateTime: "2026-11-30T00:00:00" },
    end: { dateTime: "2026-12-01T00:00:00" },
  });
});

test("a part of the account signed out or offline is the account's: the sync stops so, its calendars kept", async () => {
  const api = graphApi();
  const graph = new Graph(api.http, tokens);
  const todo = new MicrosoftTodo(graph);
  let refusal: Error | null = null;
  const tasks: Provider = {
    calendars: () => (refusal ? Promise.reject(refusal) : todo.calendars()),
    changes: (url, state, known) => todo.changes(url, state, known),
    fetch: (href) => todo.fetch(href),
    create: (href, ics) => todo.create(href, ics),
    update: (href, ics, etag) => todo.update(href, ics, etag),
    remove: (href, etag) => todo.remove(href, etag),
  };
  const microsoft = new MicrosoftProvider(new OutlookCalendars(graph), tasks);
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "m",
    serverUrl: GRAPH,
    username: null,
  });
  await syncAccount(store, microsoft, account.id);
  refusal = new AuthError("Tasks.ReadWrite revoked");
  await expect(syncAccount(store, microsoft, account.id)).rejects.toBeInstanceOf(AuthError);
  refusal = new OfflineError("offline");
  await expect(syncAccount(store, microsoft, account.id)).rejects.toBeInstanceOf(OfflineError);
  expect((await store.calendars(account.id)).map((c) => c.name).toSorted()).toEqual([
    "Tasks",
    "Work",
  ]);
});

test("a create whose answer was lost, sent again, is the event Graph made then: one event, not two", async () => {
  const api = graphApi();
  let lose = true;
  const losing: HttpClient = async (request) => {
    const response = await api.http(request);
    if (request.method === "POST" && lose) {
      lose = false;
      throw new OfflineError("the answer was lost");
    }
    return response;
  };
  const provider = new OutlookCalendars(new Graph(losing, tokens), Date.now, "Europe/Vilnius");
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "m",
    serverUrl: GRAPH,
    username: null,
  });
  await syncAccount(store, provider, account.id);
  const [calendar] = await store.calendars(account.id);
  await store.saveLocal(
    calendar!.id,
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//AstroTime//EN\r\nBEGIN:VEVENT\r\nUID:made-here@astrotime\r\nDTSTAMP:20261104T080000Z\r\nDTSTART:20261110T090000Z\r\nDTEND:20261110T100000Z\r\nSUMMARY:Dentist\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n",
  );
  await expect(syncAccount(store, provider, account.id)).rejects.toBeInstanceOf(OfflineError);
  expect(api.events.size).toBe(1);
  expect((await syncAccount(store, provider, account.id)).errors).toEqual([]);
  const posts = api.asked.filter((r) => r.method === "POST");
  expect(posts.map((r) => JSON.parse(String(r.body)).transactionId)).toEqual([
    "made-here@astrotime",
    "made-here@astrotime",
  ]);
  expect(api.events.size).toBe(1);
  expect(await store.pending(calendar!.id)).toEqual([]);
  const [href] = await store.hrefs(calendar!.id);
  expect(href!.href).toBe(`${GRAPH}me/calendars/work/events/e1`);
});

test("the bearer goes to Graph only: a page link elsewhere is refused unsent; a link repeated or pages without end are refused, nothing removed", async () => {
  const api = graphApi();
  api.keep(api.events, {
    id: "e1",
    iCalUId: "u1",
    subject: "Kept",
    start: at("2026-11-04T09:00:00.0000000"),
    end: at("2026-11-04T10:00:00.0000000"),
    type: "singleInstance",
  });
  let next: (url: URL) => string | null = () => null;
  const http: HttpClient = async (request) => {
    const response = await api.http(request);
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/events") || request.method !== "GET") return response;
    const link = next(url);
    const body = JSON.parse(String(response.body)) as Record<string, unknown>;
    return {
      ...response,
      body: JSON.stringify({ ...body, ...(link ? { "@odata.nextLink": link } : {}) }),
    };
  };
  const provider = new OutlookCalendars(new Graph(http, tokens), () => Date.UTC(2026, 10, 4));
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "m",
    serverUrl: GRAPH,
    username: null,
  });
  await syncAccount(store, provider, account.id);
  const [calendar] = await store.calendars(account.id);
  for (const [name, link] of [
    ["elsewhere", () => "https://graph.example.com/v1.0/me/calendars/work/events?$skip=2"],
    ["plain http", () => "http://graph.microsoft.com/v1.0/me/calendars/work/events?$skip=2"],
    ["repeated", (url: URL) => url.href],
    [
      "without end",
      (url: URL) =>
        `${GRAPH}me/calendars/work/events?page=${Number(url.searchParams.get("page") ?? "0") + 1}`,
    ],
  ] as const) {
    next = link;
    const before = api.asked.length;
    const report = await syncAccount(store, provider, account.id);
    expect(report.errors, name).toEqual([
      expect.objectContaining({ problem: "failed", href: calendar!.url }),
    ]);
    expect((await store.hrefs(calendar!.id)).length, name).toBe(1);
    // Nothing sent anywhere but Graph's own origin over https.
    expect(
      api.asked.slice(before).every((r) => r.url.startsWith("https://graph.microsoft.com/")),
      name,
    ).toBe(true);
    if (name === "without end") expect(api.asked.length - before, name).toBeLessThanOrEqual(1001);
  }
});

test("To Do's times are read in the zone each names, whatever Prefer asked; a due day written is the user's midnight", async () => {
  const api = graphApi();
  api.keep(api.tasks, {
    id: "k1",
    title: "Zoned",
    status: "completed",
    dueDateTime: { dateTime: "2026-11-30T00:00:00.0000000", timeZone: "FLE Standard Time" },
    completedDateTime: { dateTime: "2026-11-04T12:00:00.0000000", timeZone: "Tokyo Standard Time" },
  });
  api.keep(api.tasks, {
    id: "k2",
    title: "In UTC",
    status: "notStarted",
    dueDateTime: at("2026-11-29T22:00:00.0000000"),
  });
  const todo = new MicrosoftTodo(new Graph(api.http, tokens), "Europe/Vilnius");
  const url = `${GRAPH}me/todo/lists/tasks/tasks/`;
  const zoned = (await todo.fetch(`${url}k1`))!;
  expect(zoned.ics).toContain("DUE;VALUE=DATE:20261130\r\n");
  expect(zoned.ics).toContain("COMPLETED:20261104T030000Z\r\n");
  expect((await todo.fetch(`${url}k2`))!.ics).toContain("DUE;VALUE=DATE:20261130\r\n");
  // A rename sends the title alone: the due day read back is the one that would be written.
  expect(
    await todo.update(
      `${url}k1`,
      zoned.ics.replace("SUMMARY:Zoned", "SUMMARY:Renamed"),
      zoned.etag,
    ),
  ).toMatchObject({ ok: true });
  expect(JSON.parse(String(api.asked.findLast((r) => r.method === "PATCH")!.body))).toEqual({
    title: "Renamed",
  });
  await todo.create(`${url}new`, zoned.ics.replace("UID:k1", "UID:made-here"));
  expect(JSON.parse(String(api.asked.findLast((r) => r.method === "POST")!.body))).toMatchObject({
    dueDateTime: { dateTime: "2026-11-30T00:00:00", timeZone: "Europe/Vilnius" },
  });
});

test("no ETag kept is no licence: Graph's just read is not borrowed; an edit made in To Do meanwhile is merged, not overwritten", async () => {
  const api = graphApi();
  api.keep(api.tasks, { id: "k1", title: "Pay rent", status: "notStarted", importance: "normal" });
  api.keep(api.events, {
    id: "e1",
    iCalUId: "u1",
    subject: "Lunch",
    start: at("2026-11-04T12:00:00.0000000"),
    end: at("2026-11-04T13:00:00.0000000"),
    type: "singleInstance",
  });
  const graph = new Graph(api.http, tokens);
  const todo = new MicrosoftTodo(graph);
  const calendars = new OutlookCalendars(graph);
  const task = `${GRAPH}me/todo/lists/tasks/tasks/k1`;
  const event = `${GRAPH}me/calendars/work/events/e1`;
  const patches = () => api.asked.filter((r) => r.method === "PATCH").length;
  const taskIcs = (await todo.fetch(task))!.ics.replace("SUMMARY:Pay rent", "SUMMARY:Pay the rent");
  expect(await todo.update(task, taskIcs, null)).toEqual({ ok: false, reason: "conflict" });
  const eventIcs = (await calendars.fetch(event))!.ics.replace(
    "SUMMARY:Lunch",
    "SUMMARY:Late lunch",
  );
  expect(await calendars.update(event, eventIcs, null)).toEqual({ ok: false, reason: "conflict" });
  expect(patches()).toBe(0);

  // Through the engine: renamed here, made important in To Do before the sync.
  const store = await Store.open(nodeDriver());
  const account = await store.addAccount({
    provider: "caldav",
    name: "m",
    serverUrl: GRAPH,
    username: null,
  });
  await syncAccount(store, todo, account.id);
  const [list] = await store.calendars(account.id);
  const [stored] = await store.tasks([list!.id]);
  expect(stored!.etag).toMatch(/^~"\d+"$/);
  await store.saveLocal(
    list!.id,
    stored!.ics.replace("SUMMARY:Pay rent", "SUMMARY:Pay the rent"),
    stored!.href!,
  );
  api.keep(api.tasks, { ...api.tasks.get("k1")!, importance: "high" });
  const report = await syncAccount(store, todo, account.id);
  expect(report.errors).toEqual([]);
  const sent = api.asked.filter((r) => r.method === "PATCH");
  // The first write named the version the device had, and Graph refused it; the merge went second.
  expect(sent.map((r) => r.headers["If-Match"])).toEqual([
    stored!.etag!.replace("~", "W/"),
    expect.stringMatching(/^W\//),
  ]);
  expect(api.tasks.get("k1")).toMatchObject({ title: "Pay the rent", importance: "high" });
});

test("a redirect off Graph takes no token, and its answer is refused: a 302 to another host", async () => {
  const hops: HttpRequest[] = [];
  const answer = (status: number, url: string, headers: Record<string, string>, body: unknown) => ({
    status,
    url,
    header: (name: string) => headers[name.toLowerCase()] ?? null,
    body: JSON.stringify(body),
  });
  // The redirect rule the desktop and Android follow (fetch's own drops `Authorization` alike).
  const http = followRedirects(async (request) => {
    hops.push(request);
    return new URL(request.url).host === "graph.microsoft.com"
      ? answer(302, request.url, { location: "https://elsewhere.example/v1.0/me/calendars" }, {})
      : answer(
          200,
          request.url,
          { "content-type": "application/json" },
          { value: [{ id: "x", name: "Not Graph's" }] },
        );
  });
  const provider = new OutlookCalendars(new Graph(http, tokens));
  await expect(provider.calendars()).rejects.toThrow(
    "Not Microsoft Graph: https://elsewhere.example",
  );
  expect(hops.map((hop) => [new URL(hop.url).host, hop.headers["Authorization"] ?? null])).toEqual([
    ["graph.microsoft.com", "Bearer t"],
    ["elsewhere.example", null],
  ]);
});
