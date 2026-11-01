// The page's half of the desktop's reminders (docs/plans/desktop.md#D76): the
// set goes to the main process, a click comes back to the UI's listeners, and
// notifications show where the system has them, with the app closed too.
import type { ScheduledReminder } from "@astrotime/core";
import { expect, test } from "vite-plus/test";

import type { Bridge } from "../bridge.ts";
import { desktopReminders } from "./reminders.ts";

function bridge(supported: boolean) {
  const handed: (readonly ScheduledReminder[])[] = [];
  let opened: ((reminder: ScheduledReminder) => void) | undefined;
  const reminders: Bridge["reminders"] = {
    supported,
    schedule: (set) => void handed.push(set),
    onOpen(listener) {
      opened = listener;
      return () => (opened = undefined);
    },
  };
  return { reminders, handed, open: (reminder: ScheduledReminder) => opened?.(reminder) };
}

test("the set goes to the main process and a clicked reminder comes back to the UI", () => {
  const { reminders, handed, open } = bridge(true);
  const scheduler = desktopReminders(reminders);
  const set = [{ id: "call" } as ScheduledReminder];
  void scheduler.schedule(set);
  expect(handed).toEqual([set]);
  const heard: string[] = [];
  const stop = scheduler.onOpen((reminder) => heard.push(reminder.id));
  open(set[0]!);
  stop();
  open(set[0]!);
  expect(heard).toEqual(["call"]);
  expect([scheduler.permission(), scheduler.whileOpenOnly]).toEqual(["granted", false]);
});

test("without the system's notifications the setting says they are unsupported", async () => {
  const scheduler = desktopReminders(bridge(false).reminders);
  expect(scheduler.permission()).toBe("unsupported");
  expect(await scheduler.requestPermission()).toBe("unsupported");
});
