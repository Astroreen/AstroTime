// A task's checkbox on the tasks screen (design D197) is checked at once,
// before the store has it, and lets go of that state once the write is
// written and read again: also when the write landed but changed nothing,
// which no later read of the store would ever report.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, test } from "vite-plus/test";

import { ALL_RIGHTS } from "@astrotime/core";
import type { Calendar, Store, StoredObject } from "@astrotime/storage";

import { Formats } from "../src/calendar/format.ts";
import { CalendarContext } from "../src/components/context.ts";
import { EditingContext, type EditingValue } from "../src/components/editing.tsx";
import { TasksScreen } from "../src/components/tasks-screen.tsx";
import { createI18n } from "../src/i18n/index.ts";
import { memoryPreferences } from "../src/preferences.ts";
import { DEFAULT_SETTINGS, SettingsContext } from "../src/settings.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const list = {
  id: "list",
  name: "Tasks",
  components: ["VTODO"],
  rights: ALL_RIGHTS,
} as unknown as Calendar;

const task = {
  id: "report",
  calendarId: "list",
  ics: "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//x//EN\r\nBEGIN:VTODO\r\nUID:report\r\nDTSTAMP:20261101T000000Z\r\nSUMMARY:Send the report\r\nEND:VTODO\r\nEND:VCALENDAR\r\n",
} as unknown as StoredObject;

test("a box checked by a write that changed nothing lets go of its check once the write is read", async () => {
  // A store whose tasks never change, and a write that lands changing nothing.
  let reads = 0;
  const store = {
    tasks: async () => {
      reads++;
      return [task];
    },
    subscribe: () => () => {},
  } as unknown as Store;
  let land: (landed: boolean) => void = () => {};
  const editing = {
    rewrite: () =>
      new Promise<boolean>((resolve) => {
        land = resolve;
      }),
    open: () => {},
    create: () => {},
  } as unknown as EditingValue;

  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const i18n = createI18n("en");
  cleanups.push(() => {
    act(() => root.unmount());
    host.remove();
  });
  await act(async () =>
    root.render(
      <I18nextProvider i18n={i18n}>
        <SettingsContext.Provider value={{ settings: DEFAULT_SETTINGS, change: () => {} }}>
          <CalendarContext.Provider
            value={{
              t: i18n.t,
              formats: new Formats({ language: "en", locale: "en-US", hour12: true, weekStart: 7 }),
              timeZone: "Europe/Vilnius",
              colorOf: () => "#3367d6",
              weekNumbers: true,
            }}
          >
            <EditingContext.Provider value={editing}>
              <TasksScreen
                store={store}
                preferences={memoryPreferences()}
                lists={[list]}
                today="2026-11-04"
                now="2026-11-04T10:40"
                wide
                focus={null}
                onClose={() => {}}
              />
            </EditingContext.Provider>
          </CalendarContext.Provider>
        </SettingsContext.Provider>
      </I18nextProvider>,
    ),
  );
  const box = () =>
    host.querySelector<HTMLElement>('[role="checkbox"][aria-label="Send the report"]')!;
  expect(box().getAttribute("aria-checked")).toBe("false");

  await act(async () => box().click());
  // Checked at once, before the store has it.
  expect(box().getAttribute("aria-checked")).toBe("true");
  const before = reads;

  // Written, changing nothing: read again, and the box shows the store's state.
  await act(async () => land(true));
  expect(reads).toBe(before + 1);
  expect(box().getAttribute("aria-checked")).toBe("false");

  // Not written at all: back at once.
  await act(async () => box().click());
  expect(box().getAttribute("aria-checked")).toBe("true");
  await act(async () => land(false));
  expect(box().getAttribute("aria-checked")).toBe("false");
});
