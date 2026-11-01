// Android's reminders (docs/plans/android.md#D66), with the plugin replaced:
// each set is diffed against what Android holds, the integer ids are kept
// per reminder and never shared, a reminder past is shown once at most, and
// the permission is asked once by itself, the first time there is a reminder.
import type { ScheduledReminder } from "@astrotime/core";
import type { Preferences } from "@astrotime/ui";
import { expect, test } from "vite-plus/test";

import {
  androidReminders,
  CHANNEL,
  KEPT_KEY,
  LATE_MS,
  type NativeNotification,
  type NativeNotifications,
} from "../src/reminders.ts";

const NOW = Date.UTC(2026, 10, 4, 9, 0);
const MINUTE = 60_000;

function reminder(id: string, fireAt: number, title = id): ScheduledReminder {
  return {
    id,
    objectId: `object-${id}`,
    uid: `${id}@example.com`,
    kind: "event",
    recurrenceId: null,
    fireAt,
    title,
    start: null,
    end: null,
    due: null,
    notification: { title, body: `Body of ${title}`, late: `Late body of ${title}` },
  };
}

function memoryPreferences(): Preferences & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    get: (key) => values.get(key) ?? null,
    set: (key, value) => values.set(key, value),
  };
}

type State = "granted" | "denied" | "prompt" | "prompt-with-rationale";

/** The plugin as Android would answer it: what is pending, what was asked, a tap. */
function device(options: { display?: State; answer?: State; exact?: State } = {}) {
  let display = options.display ?? "granted";
  let exact = options.exact ?? "granted";
  let asked = 0;
  let failing = false;
  let tap: ((action: { notification: { extra?: unknown } }) => void) | null = null;
  /** What Android holds, by integer id. */
  const pending = new Map<number, NativeNotification>();
  const calls: { scheduled: NativeNotification[]; cancelled: number[] }[] = [];
  const native: NativeNotifications = {
    checkPermissions: async () => ({ display }),
    requestPermissions: async () => {
      asked++;
      display = options.answer ?? display;
      return { display };
    },
    checkExactNotificationSetting: async () => ({ exact_alarm: exact }),
    schedule: async ({ notifications }) => {
      if (failing) throw new Error("Notifications are disabled.");
      calls.push({ scheduled: notifications, cancelled: [] });
      for (const notification of notifications) pending.set(notification.id, notification);
    },
    cancel: async ({ notifications }) => {
      calls.push({ scheduled: [], cancelled: notifications.map(({ id }) => id) });
      for (const { id } of notifications) pending.delete(id);
    },
    getPending: async () => ({ notifications: [...pending.keys()].map((id) => ({ id })) }),
    addListener: async (_event, listener) => {
      tap = listener;
      return {};
    },
  };
  return {
    native,
    pending,
    calls,
    asked: () => asked,
    set display(state: State) {
      display = state;
    },
    set exact(state: State) {
      exact = state;
    },
    set failing(on: boolean) {
      failing = on;
    },
    tap: (extra: unknown) => tap?.({ notification: { extra } }),
    /** The last call's scheduled reminders by stable id, and its cancelled integer ids. */
    last() {
      const call = calls.at(-1);
      return {
        scheduled: call?.scheduled.map(({ extra }) => extra.reminder.id) ?? [],
        cancelled: call?.cancelled ?? [],
      };
    },
  };
}

function scheduler(phone: ReturnType<typeof device>, preferences = memoryPreferences(), now = NOW) {
  let resume: (() => void) | null = null;
  const reminders = androidReminders({
    native: phone.native,
    preferences,
    now: () => now,
    onResume: (listener) => (resume = listener),
  });
  return { reminders, preferences, resume: () => resume?.() };
}

/** The integer id Android holds a reminder under, the latest scheduled (a fired one stays shown). */
const idOf = (phone: ReturnType<typeof device>, id: string) =>
  phone.calls
    .flatMap(({ scheduled }) => scheduled)
    .findLast(({ extra }) => extra.reminder.id === id)?.id;

test("each set is diffed against the last: the gone cancelled, the new and moved scheduled, the rest left", async () => {
  const phone = device();
  const { reminders } = scheduler(phone);
  const call = reminder("call", NOW + 30 * MINUTE);
  const lunch = reminder("lunch", NOW + 3 * 60 * MINUTE);
  const gym = reminder("gym", NOW + 9 * 60 * MINUTE);
  await reminders.schedule([call, lunch, gym]);
  expect(phone.last()).toEqual({ scheduled: ["call", "lunch", "gym"], cancelled: [] });
  const [first] = phone.calls[0]!.scheduled;
  expect(first).toMatchObject({
    title: "call",
    body: "Body of call",
    channelId: CHANNEL,
    schedule: { at: new Date(NOW + 30 * MINUTE), allowWhileIdle: true },
    isExactNotification: true,
    extra: { reminder: call },
  });
  const ids = { call: idOf(phone, "call"), lunch: idOf(phone, "lunch"), gym: idOf(phone, "gym") };

  // The same set again changes nothing on the device.
  await reminders.schedule([call, lunch, gym]);
  expect(phone.calls).toHaveLength(1);

  // Lunch deleted on the server, the gym moved, its title edited, a new one.
  const later = reminder("gym", NOW + 10 * 60 * MINUTE, "Gym (moved)");
  const dentist = reminder("dentist", NOW + 26 * 60 * MINUTE);
  await reminders.schedule([call, later, dentist]);
  expect(
    phone.calls.slice(1).map(({ scheduled, cancelled }) => ({
      scheduled: scheduled.map(({ extra }) => extra.reminder.id),
      cancelled,
    })),
  ).toEqual([
    { scheduled: ["gym", "dentist"], cancelled: [] },
    { scheduled: [], cancelled: [ids.lunch] },
  ]);
  // A moved reminder keeps its id, so Android replaces its alarm.
  expect(idOf(phone, "gym")).toBe(ids.gym);
  expect(phone.pending.get(ids.gym!)?.title).toBe("Gym (moved)");
  expect([...phone.pending.keys()].toSorted()).toEqual(
    [ids.call, ids.gym, idOf(phone, "dentist")].toSorted(),
  );

  // Turned off: an empty set cancels everything.
  await reminders.schedule([]);
  expect(phone.pending.size).toBe(0);
});

test("a cancel that fails is tried again with the next set: no alarm is left behind untracked", async () => {
  const phone = device();
  const { reminders } = scheduler(phone);
  const call = reminder("call", NOW + 30 * MINUTE);
  const lunch = reminder("lunch", NOW + 3 * 60 * MINUTE);
  await reminders.schedule([call, lunch]);
  const lunchId = idOf(phone, "lunch")!;
  const cancel = phone.native.cancel;
  phone.native.cancel = async () => {
    throw new Error("cancel failed");
  };
  // The call moved meanwhile: its new time is scheduled though the cancel fails.
  const moved = reminder("call", NOW + 45 * MINUTE);
  await expect(reminders.schedule([moved])).rejects.toThrow("cancel failed");
  expect(phone.pending.has(lunchId)).toBe(true);
  expect(phone.last().scheduled).toEqual(["call"]);
  phone.native.cancel = cancel;
  await reminders.schedule([moved]);
  expect(phone.pending.has(lunchId)).toBe(false);
});

test("a kept record that is not one (scheduled null) starts afresh instead of failing every set", async () => {
  const phone = device();
  const preferences = memoryPreferences();
  preferences.set("astrotime.reminders", JSON.stringify({ next: 1, scheduled: null }));
  const { reminders } = scheduler(phone, preferences);
  await reminders.schedule([reminder("call", NOW + 30 * MINUTE)]);
  expect(phone.last().scheduled).toEqual(["call"]);
});

test("without a kept record, the alarms Android still holds are cancelled first: their ids are handed out again", async () => {
  const phone = device();
  await scheduler(phone).reminders.schedule([
    reminder("call", NOW + 30 * MINUTE),
    reminder("lunch", NOW + 3 * 60 * MINUTE),
  ]);
  const old = [...phone.pending.keys()];
  // The preferences cleared: a new record, its counter at 1 again.
  const { reminders } = scheduler(phone);
  await reminders.schedule([reminder("gym", NOW + 9 * 60 * MINUTE)]);
  expect(phone.calls.slice(-2).map(({ cancelled }) => cancelled)).toEqual([old, []]);
  expect([...phone.pending.values()].map(({ extra }) => extra.reminder.id)).toEqual(["gym"]);
  // Once: the next set diffs as usual.
  await reminders.schedule([reminder("gym", NOW + 9 * 60 * MINUTE)]);
  expect(phone.calls).toHaveLength(3);
});

test("a failed read of the alarms Android holds still schedules the set; the next set cancels the old ones, not ours", async () => {
  const phone = device();
  await scheduler(phone).reminders.schedule([
    reminder("call", NOW + 30 * MINUTE),
    reminder("lunch", NOW + 3 * 60 * MINUTE),
  ]);
  const read = phone.native.getPending;
  phone.native.getPending = () => Promise.reject(new Error("Storage unavailable."));
  const { reminders } = scheduler(phone);
  await reminders.schedule([reminder("gym", NOW + 9 * 60 * MINUTE)]);
  expect(phone.last().scheduled).toEqual(["gym"]);
  // "gym" took id 1 and with it the old alarm of "call"; "lunch" is left.
  expect([...phone.pending.values()].map(({ extra }) => extra.reminder.id)).toEqual([
    "gym",
    "lunch",
  ]);
  phone.native.getPending = read;
  await reminders.schedule([reminder("gym", NOW + 9 * 60 * MINUTE)]);
  expect([...phone.pending.values()].map(({ extra }) => extra.reminder.id)).toEqual(["gym"]);
});

test("ids: allocated per reminder from a kept counter, never shared, never handed out again after a restart", async () => {
  const phone = device();
  const preferences = memoryPreferences();
  const first = scheduler(phone, preferences).reminders;
  const many = Array.from({ length: 100 }, (_, i) => reminder(`r${i}`, NOW + (i + 1) * MINUTE));
  await first.schedule(many);
  const ids = [...phone.pending.keys()];
  expect(new Set(ids).size).toBe(100);

  // Half go, half come: the new ones never take an id in use, nor one freed.
  const next = [
    ...many.slice(50),
    ...Array.from({ length: 50 }, (_, i) => reminder(`s${i}`, NOW + (200 + i) * MINUTE)),
  ];
  await first.schedule(next);
  const after = [...phone.pending.keys()];
  expect(new Set(after).size).toBe(100);
  const freed = ids.filter((id) => !after.includes(id));
  expect(freed).toHaveLength(50);
  for (const added of next.slice(50)) expect(freed).not.toContain(idOf(phone, added.id));

  // A restart: the first set arms every reminder ahead again, under the same ids.
  const kept = new Map(next.map((r) => [r.id, idOf(phone, r.id)]));
  phone.pending.clear(); // as a force stop does to the alarms
  const again = scheduler(phone, preferences).reminders;
  await again.schedule(next);
  expect(new Map(next.map((r) => [r.id, idOf(phone, r.id)]))).toEqual(kept);
  // A new one after the restart gets an id no one had before.
  await again.schedule([...next, reminder("new", NOW + 999 * MINUTE)]);
  expect([...ids, ...after]).not.toContain(idOf(phone, "new"));
  expect(new Set(phone.pending.keys()).size).toBe(101);
});

test("ids: the counter wraps before Java's largest int, past the ids still in use", async () => {
  const phone = device();
  const preferences = memoryPreferences();
  preferences.set(
    KEPT_KEY,
    JSON.stringify({
      next: 2_147_483_646,
      asked: false,
      scheduled: { old: { id: 1, fireAt: NOW + MINUTE, title: "old", body: "Body of old" } },
    }),
  );
  const { reminders } = scheduler(phone, preferences);
  await reminders.schedule(
    ["old", "a", "b", "c"].map((id, i) => reminder(id, NOW + (i + 1) * MINUTE)),
  );
  expect(["old", "a", "b", "c"].map((id) => idOf(phone, id))).toEqual([
    1, 2_147_483_646, 2_147_483_647, 2,
  ]);
});

test("a reminder past: once handed over it is never shown again; new, it shows within the grace, older it is dropped", async () => {
  const phone = device();
  const preferences = memoryPreferences();
  const soon = reminder("soon", NOW + MINUTE);
  await scheduler(phone, preferences).reminders.schedule([soon]);
  expect(phone.calls).toHaveLength(1);

  // Ten minutes on, the app opens again: "soon" fired from its alarm; two
  // items synced in late, one 4 minutes past, one 20 minutes past.
  const later = NOW + 10 * MINUTE;
  const late = reminder("late", later - 4 * MINUTE);
  const stale = reminder("stale", later - 20 * MINUTE);
  const { reminders } = scheduler(phone, preferences, later);
  await reminders.schedule([stale, soon, late]);
  expect(phone.last().scheduled).toEqual(["late"]);
  // Shown at once, no schedule, saying when it was due.
  expect(phone.calls.at(-1)!.scheduled[0]).toMatchObject({ body: "Late body of late" });
  expect(phone.calls.at(-1)!.scheduled[0]!.schedule).toBeUndefined();
  expect(LATE_MS).toBe(5 * MINUTE);

  // Handed over again, nothing shows twice.
  await reminders.schedule([stale, soon, late]);
  expect(phone.calls).toHaveLength(2);
});

test("a reminder edited into the past beyond the grace has its alarm cancelled; one that fired and moves ahead gets an id of its own", async () => {
  const phone = device();
  const preferences = memoryPreferences();
  const meeting = reminder("meeting", NOW + 60 * MINUTE);
  const standup = reminder("standup", NOW + MINUTE);
  await scheduler(phone, preferences).reminders.schedule([meeting, standup]);
  const meetingId = idOf(phone, "meeting")!;
  const standupId = idOf(phone, "standup")!;

  const later = NOW + 30 * MINUTE;
  const { reminders } = scheduler(phone, preferences, later);
  // The meeting moved to start earlier: its reminder 20 minutes ago. The
  // standup fired at its time, then moved to tomorrow.
  await reminders.schedule([
    reminder("meeting", later - 20 * MINUTE),
    reminder("standup", later + 24 * 60 * MINUTE),
  ]);
  expect(phone.calls.slice(1).flatMap(({ cancelled }) => cancelled)).toEqual([meetingId]);
  expect(phone.pending.has(meetingId)).toBe(false);
  expect(idOf(phone, "standup")).not.toBe(standupId);
});

test("the permission: asked once by itself, the first time there is a reminder ahead; nothing scheduled without it", async () => {
  const phone = device({ display: "prompt", answer: "prompt-with-rationale" });
  const preferences = memoryPreferences();
  const { reminders } = scheduler(phone, preferences);
  const heard: string[] = [];
  reminders.onPermissionChange?.(() => heard.push(reminders.permission()));
  expect([reminders.asksWhenNeeded, reminders.native, reminders.whileOpenOnly]).toEqual([
    true,
    true,
    false,
  ]);

  // No reminder ahead: nothing asked.
  await reminders.schedule([]);
  await reminders.schedule([reminder("past", NOW - 30 * MINUTE)]);
  expect(phone.asked()).toBe(0);
  // The first reminder ahead asks; dismissed, it is not scheduled.
  await reminders.schedule([reminder("call", NOW + MINUTE)]);
  expect(phone.asked()).toBe(1);
  expect(phone.calls).toHaveLength(0);
  expect(reminders.permission()).toBe("default");
  // Further sets, and a restart, do not ask again: the setting's switch does.
  await reminders.schedule([reminder("call", NOW + MINUTE), reminder("lunch", NOW + 60 * MINUTE)]);
  await scheduler(phone, preferences).reminders.schedule([reminder("call", NOW + MINUTE)]);
  expect(phone.asked()).toBe(1);

  // Allowed in the system's settings meanwhile: back in front, the UI hears it.
  const again = scheduler(phone, preferences);
  again.reminders.onPermissionChange?.(() => heard.push(`again: ${again.reminders.permission()}`));
  await again.reminders.schedule([]);
  phone.display = "granted";
  again.resume();
  await again.reminders.schedule([reminder("call", NOW + MINUTE)]);
  expect(heard).toContain("again: granted");
  expect(phone.last().scheduled).toEqual(["call"]);
});

test("the app ended while asking: kept as not asked, so the next run asks again", async () => {
  const phone = device({ display: "prompt", answer: "granted" });
  const preferences = memoryPreferences();
  let asking = () => {};
  const asked = new Promise<void>((resolve) => (asking = resolve));
  const request = phone.native.requestPermissions;
  // The prompt is never answered: the process ends with it on the screen.
  phone.native.requestPermissions = () => {
    asking();
    return new Promise(() => {});
  };
  void scheduler(phone, preferences).reminders.schedule([reminder("call", NOW + MINUTE)]);
  await asked;
  expect(JSON.parse(preferences.values.get(KEPT_KEY) ?? "{}").asked).not.toBe(true);
  phone.native.requestPermissions = request;
  const again = scheduler(phone, preferences).reminders;
  await again.schedule([reminder("call", NOW + MINUTE)]);
  expect(again.permission()).toBe("granted");
  expect(phone.last().scheduled).toEqual(["call"]);
  expect(JSON.parse(preferences.values.get(KEPT_KEY)!).asked).toBe(true);
});

test("a request that fails is not kept as asked, though the set is saved after it", async () => {
  const phone = device({ display: "prompt", answer: "granted" });
  const preferences = memoryPreferences();
  const request = phone.native.requestPermissions;
  phone.native.requestPermissions = () => Promise.reject(new Error("No activity."));
  const { reminders } = scheduler(phone, preferences);
  await expect(reminders.schedule([reminder("call", NOW + MINUTE)])).rejects.toThrow(
    "No activity.",
  );
  // Not asked again by itself in this run: every store write makes a set.
  await reminders.schedule([reminder("call", NOW + MINUTE)]);
  expect(phone.asked()).toBe(0);
  // Allowed in the system's settings meanwhile: the set is saved, "asked" not with it.
  phone.display = "granted";
  await reminders.schedule([reminder("call", NOW + MINUTE)]);
  expect(phone.last().scheduled).toEqual(["call"]);
  expect(JSON.parse(preferences.values.get(KEPT_KEY) ?? "{}").asked).not.toBe(true);
  phone.display = "prompt";
  phone.native.requestPermissions = request;
  await scheduler(phone, preferences).reminders.schedule([reminder("call", NOW + MINUTE)]);
  expect(phone.asked()).toBe(1);
  expect(JSON.parse(preferences.values.get(KEPT_KEY)!).asked).toBe(true);
});

test("without the permission, what left the set is still cancelled: allowed again, it would show", async () => {
  const phone = device();
  const { reminders } = scheduler(phone);
  const call = reminder("call", NOW + 30 * MINUTE);
  await reminders.schedule([call, reminder("lunch", NOW + 3 * 60 * MINUTE)]);
  const lunchId = idOf(phone, "lunch")!;
  phone.display = "denied";
  await reminders.schedule([call]);
  expect(phone.last()).toEqual({ scheduled: [], cancelled: [lunchId] });
  phone.display = "granted";
  await reminders.schedule([call]);
  expect([...phone.pending.keys()]).toEqual([idOf(phone, "call")]);
  expect(phone.calls).toHaveLength(2);
});

test("without the permission, a cancel that fails says so and is tried again with the next set, as with it", async () => {
  const phone = device();
  const { reminders } = scheduler(phone);
  const call = reminder("call", NOW + 30 * MINUTE);
  await reminders.schedule([call, reminder("lunch", NOW + 3 * 60 * MINUTE)]);
  const lunchId = idOf(phone, "lunch")!;
  phone.display = "denied";
  const cancel = phone.native.cancel;
  phone.native.cancel = () => Promise.reject(new Error("Plugin failed."));
  await expect(reminders.schedule([call])).rejects.toThrow("Plugin failed.");
  phone.native.cancel = cancel;
  await reminders.schedule([call]);
  expect(phone.last()).toEqual({ scheduled: [], cancelled: [lunchId] });
});

test("the switch asks too; refused for good, the setting says so", async () => {
  const phone = device({ display: "prompt", answer: "denied" });
  const { reminders } = scheduler(phone);
  expect(await reminders.requestPermission()).toBe("denied");
  expect(reminders.permission()).toBe("denied");
  // The switch asked: a set does not ask again.
  await reminders.schedule([reminder("call", NOW + MINUTE)]);
  expect(phone.asked()).toBe(1);
  expect(phone.calls).toHaveLength(0);
});

test("with exact alarms taken away, reminders are scheduled inexact and the setting hears it", async () => {
  const phone = device({ exact: "denied" });
  const { reminders } = scheduler(phone);
  await reminders.schedule([reminder("call", NOW + MINUTE)]);
  expect(reminders.inexact?.()).toBe(true);
  expect(phone.calls[0]!.scheduled[0]!.isExactNotification).toBe(false);
});

test("a set Android refused is scheduled again with the next, under the same ids", async () => {
  const phone = device();
  const { reminders } = scheduler(phone);
  const call = reminder("call", NOW + MINUTE);
  phone.failing = true;
  await expect(reminders.schedule([call])).rejects.toThrow("disabled");
  phone.failing = false;
  await reminders.schedule([call]);
  expect(phone.last().scheduled).toEqual(["call"]);
  expect(idOf(phone, "call")).toBe(1);
});

test("a tapped reminder reaches the UI, also one that started the app before the UI listened", () => {
  const phone = device();
  const { reminders } = scheduler(phone);
  const call = reminder("call", NOW + MINUTE);
  // The app started from the notification: the UI is not listening yet.
  phone.tap({ reminder: call });
  const heard: string[] = [];
  const stop = reminders.onOpen((r) => heard.push(r.id));
  expect(heard).toEqual(["call"]);
  phone.tap({ reminder: reminder("lunch", NOW) });
  phone.tap(undefined); // a notification of no reminder
  stop();
  phone.tap({ reminder: call });
  expect(heard).toEqual(["call", "lunch"]);
});

test("two instances on one set of preferences (the open app and background sync, D67) never share an id", async () => {
  const phone = device();
  const preferences = memoryPreferences();
  // One lock between them, as the WebViews' shared Web Lock.
  let held = Promise.resolve();
  const lock = <T>(work: () => Promise<T>): Promise<T> => {
    const run = held.then(work);
    held = run.then(
      () => {},
      () => {},
    );
    return run;
  };
  const make = () => androidReminders({ native: phone.native, preferences, now: () => NOW, lock });
  // The app reads the kept map when it starts; background sync then hands out an id.
  const app = make();
  await make().schedule([reminder("lunch", NOW + 3 * 60 * MINUTE)]);
  await app.schedule([reminder("call", NOW + 30 * MINUTE)]);
  // Lunch left the set under its own id; call did not take it.
  expect(idOf(phone, "lunch")).toBe(1);
  expect(idOf(phone, "call")).toBe(2);
  expect(phone.last().cancelled).toEqual([1]);
  expect([...phone.pending.keys()]).toEqual([2]);
});

test("the switch asking keeps asked on the record as kept now, not over ids handed out since (D67)", async () => {
  const phone = device();
  const preferences = memoryPreferences();
  let held = Promise.resolve();
  const lock = <T>(work: () => Promise<T>): Promise<T> => {
    const run = held.then(work);
    held = run.then(
      () => {},
      () => {},
    );
    return run;
  };
  const make = () => androidReminders({ native: phone.native, preferences, now: () => NOW, lock });
  const app = make();
  // Background sync hands out an id while the app is open.
  await make().schedule([reminder("lunch", NOW + 3 * 60 * MINUTE)]);
  // The setting's switch asks: its write must not put the app's old record back.
  await app.requestPermission();
  expect(JSON.parse(preferences.values.get(KEPT_KEY)!)).toMatchObject({
    asked: true,
    next: 2,
    scheduled: { lunch: { id: 1 } },
  });
  await app.schedule([reminder("call", NOW + 30 * MINUTE)]);
  expect(idOf(phone, "call")).toBe(2);
  expect(phone.last().cancelled).toEqual([1]);
});

test("a lost write of the kept map heals: a held id is not handed out again, and its alarm is cancelled (D67)", async () => {
  const phone = device();
  const preferences = memoryPreferences();
  const make = () => androidReminders({ native: phone.native, preferences, now: () => NOW });
  await make().schedule([reminder("call", NOW + 30 * MINUTE)]);
  const before = preferences.values.get(KEPT_KEY)!;
  // Background sync hands out an id, then its write of the map is lost.
  await make().schedule([
    reminder("call", NOW + 30 * MINUTE),
    reminder("lunch", NOW + 3 * 60 * MINUTE),
  ]);
  expect(idOf(phone, "lunch")).toBe(2);
  preferences.values.set(KEPT_KEY, before);
  // The app's next run: id 2 is held by an alarm the map does not know.
  const since = phone.calls.length;
  await make().schedule([reminder("call", NOW + 30 * MINUTE), reminder("gym", NOW + 60 * MINUTE)]);
  expect(idOf(phone, "gym")).toBe(3);
  expect(phone.calls.slice(since).flatMap(({ cancelled }) => cancelled)).toEqual([2]);
  expect([...phone.pending.keys()].toSorted()).toEqual([1, 3]);
});

test("an orphan still held (a shown notification keeps its record) is cancelled once a run, and its id stays out", async () => {
  const phone = device();
  const app = androidReminders({
    native: phone.native,
    preferences: memoryPreferences(),
    now: () => NOW,
  });
  // Shown and no one's: the plugin keeps its record after a cancel, only marked cancelled.
  phone.pending.set(1, { id: 1 } as NativeNotification);
  const cancelled: number[] = [];
  phone.native.cancel = async ({ notifications }) => {
    cancelled.push(...notifications.map(({ id }) => id));
  };
  await app.schedule([reminder("call", NOW + 30 * MINUTE)]);
  await app.schedule([reminder("call", NOW + 30 * MINUTE), reminder("gym", NOW + 60 * MINUTE)]);
  expect(cancelled).toEqual([1]);
  expect(idOf(phone, "call")).toBe(2);
  expect(idOf(phone, "gym")).toBe(3);
});
