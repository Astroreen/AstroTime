// The UI on the web store in Chromium: it draws what the local store holds
// and follows it as it changes (docs/plans/foundation.md#D5), and says so
// plainly when it cannot open the store.
import type { HttpClient } from "@astrotime/caldav";
import { ALL_RIGHTS, OfflineError } from "@astrotime/core";
import {
  CommitInDoubtError,
  InsecureContextError,
  OutdatedWebViewError,
  Store,
  type LocalChange,
} from "@astrotime/storage";
import { webDriver } from "@astrotime/storage/web";
import { saveAccount } from "@astrotime/sync";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser/context";

import { loadDemo } from "../src/demo/index.ts";
import { AstroTime, type Platform } from "../src/index.ts";
import { memoryPreferences } from "../src/preferences.ts";
import { fakeReminders, memorySecrets, nextcloud, SERVER } from "./fakes.ts";

const NOW = new Date("2026-11-04T10:40:00+02:00");
const timeZone = "Europe/Vilnius";
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
  vi.useRealTimers();
});

/** Never reached: the demo account does not sync. */
const unreachable: HttpClient = async () => {
  throw new OfflineError("no network in this test");
};

function render(store: Promise<Store>, languages: string[], platform: Partial<Platform> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  root.render(
    <AstroTime
      platform={{
        store,
        preferences: memoryPreferences({ "astrotime.view": "day" }),
        http: unreachable,
        secrets: memorySecrets(),
        openExternal: () => {},
        reminders: fakeReminders().scheduler,
        ...platform,
      }}
      languages={languages}
      timeZone={timeZone}
    />,
  );
  cleanups.push(() => {
    root.unmount();
    container.remove();
  });
}

/** A store that fails to open; handled here, so the test is not failed for an unhandled rejection. */
function failing(error: Error): Promise<Store> {
  const opening = Promise.reject(error);
  opening.catch(() => {});
  return opening;
}

let n = 0;
async function demoStore(languages: string[]): Promise<Store> {
  const store = await Store.open(await webDriver(`ui-${Date.now()}-${n++}`));
  cleanups.push(() => store.close());
  await loadDemo(store, { languages, timeZone, now: NOW.getTime() });
  return store;
}

const event = (uid: string, summary: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nSUMMARY:${summary}\r\nDTSTART;TZID=${timeZone}:20261104T160000\r\nDTEND;TZID=${timeZone}:20261104T170000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

test("draws today from the local store, and follows the store as a sync writes to it", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await demoStore(["en-US"]);
  render(Promise.resolve(store), ["en-US"]);
  const today = page.getByRole("list", { name: "Wednesday, November 4" });
  await expect
    .element(today.getByRole("listitem", { name: /^Design review, / }))
    .toBeInTheDocument();
  await expect
    .element(
      page.getByRole("list", { name: "All day" }).getByRole("button", { name: "3 undone tasks" }),
    )
    .toBeInTheDocument();

  const work = (await store.calendars()).find((calendar) => calendar.name === "Work")!;
  const written = await store.saveFromServer(work.id, {
    href: "late.ics",
    etag: '"1"',
    ics: event("late", "Late review"),
  });
  const late = today.getByRole("listitem", { name: /^Late review, / });
  await expect.element(late).toBeInTheDocument();
  await store.removeObject(written.id);
  await expect.element(late).not.toBeInTheDocument();
});

test("a period whose items cannot be read is drawn all the same, empty, not held (design D59)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  cleanups.push(() => errors.mockRestore());
  const store = await demoStore(["en-US"]);
  // From tomorrow on, the store rejects every read of the items.
  const broken = Object.assign(Object.create(store) as Store, {
    objectsBetween: (...args: Parameters<Store["objectsBetween"]>) =>
      args[1].from >= "2026-11-05"
        ? Promise.reject(new Error("The disk is gone."))
        : store.objectsBetween(...args),
  });
  render(Promise.resolve(broken), ["en-US"]);
  await expect
    .element(
      page
        .getByRole("list", { name: "Wednesday, November 4" })
        .getByRole("listitem", { name: /^Design review, / }),
    )
    .toBeInTheDocument();
  await userEvent.keyboard("n");
  const thursday = page.getByRole("list", { name: "Thursday, November 5" });
  await expect.element(thursday).toBeInTheDocument();
  expect(thursday.getByRole("listitem").elements()).toEqual([]);
  expect(errors).toHaveBeenCalled();
});

test("back from the Agenda, the day is drawn as the store has it now, not as read before (design D59)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await demoStore(["en-US"]);
  render(Promise.resolve(store), ["en-US"]);
  // Today's column in the Day view: the Agenda names its days too, but has no strip.
  const today = () =>
    document.querySelector('main [role="list"][aria-label="All day"]') &&
    document.querySelector('main [role="list"][aria-label="Wednesday, November 4"]');
  await expect
    .element(page.getByRole("list", { name: "Wednesday, November 4" }).getByText("Design review"))
    .toBeInTheDocument();
  await userEvent.keyboard("a");
  await expect.element(page.getByRole("list", { name: "All day" })).not.toBeInTheDocument();
  const work = (await store.calendars()).find((calendar) => calendar.name === "Work")!;
  await store.saveFromServer(work.id, {
    href: "late.ics",
    etag: '"1"',
    ics: event("late", "Late review"),
  });
  // Every state of the page the Day view is drawn in, from the key on.
  const drawn: boolean[] = [];
  const observer = new MutationObserver(() => {
    const list = today();
    if (list) drawn.push(list.textContent?.includes("Late review") ?? false);
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  cleanups.push(() => observer.disconnect());
  await userEvent.keyboard("d");
  await expect
    .element(page.getByRole("list", { name: "Wednesday, November 4" }).getByText("Late review"))
    .toBeInTheDocument();
  expect(drawn).not.toEqual([]);
  expect(drawn.filter((late) => !late)).toEqual([]);
});

test("calendars that cannot be read leave the view drawn, empty, on open (design D59)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  cleanups.push(() => errors.mockRestore());
  const store = await demoStore(["en-US"]);
  const broken = Object.assign(Object.create(store) as Store, {
    calendars: () => Promise.reject(new Error("The disk is gone.")),
  });
  render(Promise.resolve(broken), ["en-US"]);
  await expect
    .element(page.getByRole("list", { name: "Wednesday, November 4" }))
    .toBeInTheDocument();
  expect(errors).toHaveBeenCalled();
});

test("completing and starring on the tasks screen write the task to the store, to upload (D52)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await demoStore(["en-US"]);
  render(Promise.resolve(store), ["en-US"]);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("tab", { name: /^Tasks/ }).click();
  const list = (await store.calendars()).find((calendar) => calendar.name === "Tasks")!;
  const before = (await store.tasks([list.id])).find((task) => task.uid === "demo-report")!;
  /** The next write to the store. */
  const written = () =>
    new Promise<void>((resolve) => {
      const stop = store.subscribe(() => {
        stop();
        resolve();
      });
    });

  const report = page.getByRole("checkbox", { name: "Send the report" });
  await expect.element(report).toBeInTheDocument();
  let write = written();
  // No stylesheet here, so the empty circle has no size: clicked in the DOM.
  // The e2e tests click it as it is drawn.
  (report.element() as HTMLElement).click();
  await write;
  const [completed] = await store.pending(list.id);
  expect(completed).toMatchObject({ id: before.id, href: before.href, pending: "update" });
  // Only what completing writes changed (AGENTS.md rule 2).
  expect(completed!.ics).toBe(
    before.ics
      .replace("DTSTAMP:20260101T000000Z", "DTSTAMP:20261104T084000Z")
      .replace(
        "END:VTODO",
        "STATUS:COMPLETED\r\nCOMPLETED:20261104T084000Z\r\nPERCENT-COMPLETE:100\r\nLAST-MODIFIED:20261104T084000Z\r\nEND:VTODO",
      ),
  );

  write = written();
  await page.getByRole("button", { name: "Star: Write the proposal" }).click();
  await write;
  const proposal = (await store.pending(list.id)).find((task) => task.uid === "demo-proposal");
  expect(proposal?.ics).toContain("X-ASTROTIME-STARRED:TRUE\r\n");
});

test("a completion or a star that did not land says so: the task gone meanwhile, a commit in doubt (D99)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await demoStore(["en-US"]);
  let failure: "gone" | "doubt" = "gone";
  // The store as another tab or a leader that went leaves it, at the moment of the write.
  const shaky = Object.assign(Object.create(store) as Store, {
    async changeLocal<T>(change: (local: LocalChange) => Promise<T>): Promise<T> {
      if (failure === "gone") {
        return store.changeLocal((local) =>
          change({
            object: async () => undefined,
            save: (...args) => local.save(...args),
            delete: (id) => local.delete(id),
          }),
        );
      }
      await store
        .changeLocal(async (local) => {
          await change(local);
          throw new Error("Rolled back with the leader.");
        })
        .catch(() => {});
      throw new CommitInDoubtError("The answer went with the leader.");
    },
  });
  render(Promise.resolve(shaky), ["en-US"]);
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await page.getByRole("tab", { name: /^Tasks/ }).click();
  const report = page.getByRole("checkbox", { name: "Send the report" });
  await expect.element(report).toBeInTheDocument();
  (report.element() as HTMLElement).click();
  const notice = page.getByRole("alert");
  await expect.element(notice.getByText(/^This is no longer on your calendar/)).toBeInTheDocument();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect.element(notice).not.toBeInTheDocument();

  failure = "doubt";
  await page.getByRole("button", { name: "Star: Write the proposal" }).click();
  await expect
    .element(notice.getByText(/^It is not clear whether the change was saved/))
    .toBeInTheDocument();
  const list = (await store.calendars()).find((calendar) => calendar.name === "Tasks")!;
  expect(await store.pending(list.id)).toEqual([]);
});

test("Reminders: the switch asks the permission from the tap, the set reaches the platform, a tapped one opens its day and its details (D101)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await demoStore(["en-US"]);
  const reminders = fakeReminders("default", "granted");
  render(Promise.resolve(store), ["en-US"], { reminders: reminders.scheduler });
  await page.getByRole("button", { name: "Main menu" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", { name: "Reminders" });
  // These tests load no CSS, so the switch itself has no size: its label takes the tap.
  const label = page.getByText("Reminders", { exact: true });
  await expect.element(toggle).not.toBeChecked();
  // Nothing is asked at start, and nothing is scheduled without the permission.
  expect(reminders.asked).toBe(0);
  expect(reminders.last).toEqual([]);

  const handed = reminders.next();
  await label.click();
  await handed;
  expect(reminders.asked).toBe(1);
  await expect.element(toggle).toBeChecked();
  await expect
    .element(page.getByText("Reminders show while AstroTime is open in a tab."))
    .toBeInTheDocument();
  // The set reaches an hour back, to the design review's at 9:50; the next is still ahead.
  await expect
    .element(page.getByText(/^Next: Call with Anna, Wed, Nov 4, 11:00\sAM\.$/))
    .toBeInTheDocument();
  expect(reminders.last.map((r) => r.notification.title)).toEqual([
    "Design review",
    "Call with Anna",
    "Write the proposal",
    "Dentist",
    "Trip to Tallinn",
  ]);

  await userEvent.keyboard("{Escape}");
  reminders.tap(reminders.last.find((r) => r.title === "Dentist")!);
  // Its details open over its day.
  const details = page.getByRole("dialog", { name: "Dentist" });
  await expect.element(details).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(details).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("list", { name: "Thursday, November 5" }))
    .toBeInTheDocument();

  // Turned off: the platform is handed an empty set.
  await page.getByRole("button", { name: "Main menu" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  await label.click();
  await expect.element(toggle).not.toBeChecked();
  expect(reminders.last).toEqual([]);
});

test("Reminders the browser blocks: the switch cannot turn on and says why, in Russian", async () => {
  const store = await demoStore(["ru-RU"]);
  const reminders = fakeReminders("denied");
  render(Promise.resolve(store), ["ru-RU"], { reminders: reminders.scheduler });
  await page.getByRole("button", { name: "Главное меню" }).click();
  await page.getByRole("button", { name: "Настройки" }).click();
  await expect.element(page.getByRole("switch", { name: "Напоминания" })).toBeDisabled();
  await expect
    .element(
      page.getByText(
        "Браузер не пропускает уведомления от AstroTime. Разрешите их в настройках сайта.",
      ),
    )
    .toBeInTheDocument();
});

test("Reminders on Android: the platform has the set before it may notify, asks by itself, and the setting hears its answer (android D66)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await demoStore(["en-US"]);
  const reminders = fakeReminders("default", "granted");
  const changed = new Set<() => void>();
  let exact = false;
  const handed = reminders.next();
  render(Promise.resolve(store), ["en-US"], {
    reminders: {
      ...reminders.scheduler,
      whileOpenOnly: false,
      asksWhenNeeded: true,
      native: true,
      inexact: () => !exact,
      onPermissionChange(listener) {
        changed.add(listener);
        return () => changed.delete(listener);
      },
    },
  });
  // Handed over at start, with no tap, so the platform can ask the first time there is one.
  await handed;
  expect(reminders.last.map((r) => r.notification.title)).toContain("Call with Anna");
  expect(reminders.asked).toBe(0);
  await page.getByRole("button", { name: "Main menu" }).click();
  await page.getByRole("button", { name: "Settings" }).click();
  const toggle = page.getByRole("switch", { name: "Reminders" });
  await expect.element(toggle).not.toBeChecked();

  // The platform asked and was allowed: the switch is on, and says reminders may come late.
  await reminders.scheduler.requestPermission();
  for (const listener of changed) listener();
  await expect.element(toggle).toBeChecked();
  await expect
    .element(page.getByText(/^Exact alarms are off for AstroTime in the system's settings/))
    .toBeInTheDocument();
  expect(page.getByText("Reminders show while AstroTime is open in a tab.").query()).toBeNull();
  exact = true;
  for (const listener of changed) listener();
  await expect.element(page.getByText(/^Exact alarms are off/)).not.toBeInTheDocument();
});

test("Reminders the system blocks: the setting names the system's settings, not a browser's", async () => {
  const store = await demoStore(["ru-RU"]);
  const reminders = fakeReminders("denied");
  render(Promise.resolve(store), ["ru-RU"], {
    reminders: { ...reminders.scheduler, native: true, asksWhenNeeded: true },
  });
  await page.getByRole("button", { name: "Главное меню" }).click();
  await page.getByRole("button", { name: "Настройки" }).click();
  await expect.element(page.getByRole("switch", { name: "Напоминания" })).toBeDisabled();
  await expect
    .element(
      page.getByText(
        "Уведомления от AstroTime выключены. Разрешите их в настройках системы для AstroTime.",
      ),
    )
    .toBeInTheDocument();
  // Blocked, the platform is handed nothing.
  expect(reminders.last).toEqual([]);
});

test("a page that is not a secure context: a message in the user's language", async () => {
  render(failing(new InsecureContextError("http")), ["ru-RU"]);
  await expect
    .element(page.getByRole("alert").getByRole("heading", { name: "Этот адрес не защищён" }))
    .toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Обновить" })).toBeInTheDocument();
});

test("a WebView too old for the store: says to update it, in the user's language (android D61)", async () => {
  render(failing(new OutdatedWebViewError(104, 109)), ["ru-RU"]);
  const alert = page.getByRole("alert");
  await expect
    .element(alert.getByRole("heading", { name: "Обновите Android System WebView" }))
    .toBeInTheDocument();
  expect(alert.element().textContent).toContain("версии 109 или новее, а здесь версия 104.");
  // Reloading does not update it: no button that would do nothing.
  expect(alert.getByRole("button").elements()).toEqual([]);
});

test("a store that does not open for another reason: the failure, not a blank page", async () => {
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  cleanups.push(() => quiet.mockRestore());
  render(failing(new Error("broken")), ["en-US"]);
  await expect
    .element(
      page.getByRole("alert").getByRole("heading", { name: "Your calendar could not be opened" }),
    )
    .toBeInTheDocument();
  expect(quiet).toHaveBeenCalled();
});

test("an item opens its details; Escape closes them and the focus is back on the item (D14)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await demoStore(["en-US"]);
  render(Promise.resolve(store), ["en-US"]);
  const opener = page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Design review, / });
  await expect.element(opener).toBeInTheDocument();
  const button = opener.element() as HTMLElement;
  // No stylesheet here, so the button over the item has no size: used in the DOM.
  button.focus();
  button.click();
  const details = page.getByRole("dialog", { name: "Design review" });
  await expect.element(details).toBeInTheDocument();
  await expect.element(details.getByText("Calendar: Work")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(details).not.toBeInTheDocument();
  await expect.element(opener).toHaveFocus();
});

test("a calendar shared to edit, without adding or deleting: its item shows Edit, not Delete, and it is offered for no new item (D37)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await demoStore(["en-US"]);
  const [demo] = await store.accounts();
  const team = await store.saveCalendar({
    accountId: demo!.id,
    url: "https://demo.invalid/team/",
    name: "Team",
    color: "#7a5cc4",
    components: ["VEVENT"],
    rights: { create: false, edit: true, delete: false },
  });
  await store.saveFromServer(team.id, {
    href: "sync.ics",
    etag: '"1"',
    ics: event("sync", "Team sync"),
  });
  render(Promise.resolve(store), ["en-US"]);
  const options = (dialog: ReturnType<typeof page.getByRole>) =>
    [
      ...(dialog.getByRole("combobox", { name: "Calendar" }).element() as HTMLSelectElement)
        .options,
    ].map((option) => option.text);

  const opener = page
    .getByRole("list", { name: "Wednesday, November 4" })
    .getByRole("button", { name: /^Team sync, / });
  await expect.element(opener).toBeInTheDocument();
  (opener.element() as HTMLElement).click();
  const details = page.getByRole("dialog", { name: "Team sync" });
  await expect.element(details.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  expect(details.getByRole("button", { name: "Delete" }).elements()).toEqual([]);
  expect(details.getByRole("note").elements()).toEqual([]);

  // Its edit stays in Team: moving it out would delete it there.
  (details.getByRole("button", { name: "Edit" }).element() as HTMLElement).click();
  const editor = page.getByRole("dialog", { name: "Edit event" });
  await expect.element(editor).toBeInTheDocument();
  expect(options(editor)).toEqual(["Team"]);
  (editor.getByRole("button", { name: "Close without saving" }).element() as HTMLElement).click();
  await expect.element(editor).not.toBeInTheDocument();
  (details.getByRole("button", { name: "Close", exact: true }).element() as HTMLElement).click();
  await expect.element(details).not.toBeInTheDocument();

  // A new event goes in a calendar that takes new items: not Team, not the read-only Holidays.
  (page.getByRole("button", { name: "Create" }).element() as HTMLElement).click();
  const creating = page.getByRole("dialog", { name: "New event" });
  await expect.element(creating).toBeInTheDocument();
  expect(options(creating)).toEqual(["Personal", "Work"]);
});

// The app's stylesheet lifts a dialog above Base UI's own backdrop; these
// tests load no CSS, so a dialog's buttons get the clicks only with this.
const lift = document.createElement("style");
lift.textContent = "[role=dialog], [role=alertdialog] { position: relative; z-index: 1; }";
document.head.append(lift);

async function emptyStore(): Promise<Store> {
  const store = await Store.open(await webDriver(`ui-${Date.now()}-${n++}`));
  cleanups.push(() => store.close());
  return store;
}

test("removing a Login Flow account offline: removed here, and the app password said to be still valid (foundation D90)", async () => {
  const store = await Store.open(await webDriver(`ui-${Date.now()}-${n++}`));
  cleanups.push(() => store.close());
  const secrets = memorySecrets();
  const name = "astro@cloud.example.com";
  await saveAccount(
    { store, secrets },
    {
      name,
      serverUrl: `${SERVER}/`,
      homeUrl: `${SERVER}/remote.php/dav/calendars/astro/`,
      credentials: { username: "astro", password: "app-pass" },
      loginFlow: true,
    },
  );
  render(Promise.resolve(store), ["en-US"], { secrets });
  // No stylesheet here, so nothing is laid out to be clicked: clicked in the DOM.
  const click = async (locator: ReturnType<typeof page.getByRole>) => {
    await expect.element(locator).toBeInTheDocument();
    (locator.element() as HTMLElement).click();
  };
  await click(page.getByRole("button", { name: "Accounts" }));
  await click(
    page
      .getByRole("dialog", { name: "Accounts" })
      .getByRole("button", { name: `Options for ${name}` }),
  );
  await click(page.getByRole("menuitem", { name: "Remove from this device" }));
  await click(
    page
      .getByRole("alertdialog", { name: `Remove ${name}?` })
      .getByRole("button", { name: "Remove" }),
  );
  const told = page.getByRole("alertdialog", { name: `${name} was removed` });
  await expect
    .element(told.getByText(/^AstroTime could not revoke its app password/))
    .toBeInTheDocument();
  // Gone, with its password; the calendar on this device comes in its place (D122).
  const servers = (await store.accounts()).filter((account) => account.provider !== "local");
  expect([servers, secrets.values.size]).toEqual([[], 0]);
  await click(told.getByRole("button", { name: "OK" }));
  await expect.element(told).not.toBeInTheDocument();
});

test("a sync that comes to need the user is said once, not again after each sync while it does (design D120)", async () => {
  const store = await emptyStore();
  const secrets = memorySecrets();
  await saveAccount(
    { store, secrets },
    {
      name: "astro@cloud.example.com",
      serverUrl: `${SERVER}/`,
      homeUrl: `${SERVER}/remote.php/dav/calendars/astro/`,
      credentials: { username: "astro", password: "revoked" },
    },
  );
  // The server refuses the saved password, so every sync needs the user. A
  // sync's requests wait while `held` is set, to look at the page mid-sync.
  const server = nextcloud({ password: "right" });
  let held: Promise<void> | null = null;
  let release = () => {};
  const http: HttpClient = async (request) => {
    await held;
    return server.http(request);
  };
  let requestSync: (byUser: boolean) => void = () => {};
  render(Promise.resolve(store), ["en-US"], {
    http,
    secrets,
    onSyncRequest: (listener) => {
      requestSync = listener;
      return () => {};
    },
  });
  const button = page.getByRole("button", { name: /^Accounts/ });
  const said = page.getByRole("status").filter({ hasText: "something needs your attention" });
  await expect.element(said).toHaveTextContent("Accounts, something needs your attention");
  await expect.element(button).toHaveAccessibleName("Accounts, something needs your attention");

  // A live region is read again when its content changes: record any change.
  const changes: string[] = [];
  const region = said.element();
  new MutationObserver(() => changes.push(region.textContent ?? "")).observe(region, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  held = new Promise((resolve) => (release = resolve));
  requestSync(true);
  await expect.element(button).toHaveAccessibleName("Accounts, syncing");
  expect(region.textContent).toBe("Accounts, something needs your attention");
  held = null;
  release();
  await expect.element(button).toHaveAccessibleName("Accounts, something needs your attention");
  expect([region.isConnected, region.textContent, changes]).toEqual([
    true,
    "Accounts, something needs your attention",
    [],
  ]);
});

test("an empty app opens on the calendar on this device; an account added from the accounts dialog with no calendar yet leaves it there, a wrong password said in the user's language (D122)", async () => {
  const store = await emptyStore();
  const server = nextcloud({ password: "right" });
  const secrets = memorySecrets();
  render(Promise.resolve(store), ["ru-RU"], { http: server.http, secrets });
  // No sign-in in the way: the calendar, with a calendar of its own on this device.
  await page.getByRole("button", { name: /^Аккаунты/ }).click();
  const accounts = page.getByRole("dialog", { name: "Аккаунты" });
  await expect
    .element(accounts.getByText("Без синхронизации: только на этом устройстве"))
    .toBeInTheDocument();
  await expect
    .element(accounts.getByText("На этом устройстве", { exact: true }))
    .toBeInTheDocument();
  expect((await store.accounts()).map((a) => a.provider)).toEqual(["local"]);
  expect((await store.calendars()).map((c) => c.name)).toEqual(["Личный"]);
  await accounts.getByRole("button", { name: "Добавить аккаунт" }).click();
  const dialog = page.getByRole("dialog", { name: "Добавить аккаунт" });
  await dialog.getByRole("tab", { name: "CalDAV" }).click();
  await dialog.getByRole("textbox", { name: "Адрес сервера" }).fill("cloud.example.com");
  await dialog.getByRole("textbox", { name: "Имя пользователя" }).fill("astro");
  await dialog.getByLabelText("Пароль").fill("wrong");
  await dialog.getByRole("button", { name: "Войти" }).click();
  await expect
    .element(dialog.getByRole("alert"))
    .toHaveTextContent("Неверное имя пользователя или пароль.");

  await dialog.getByLabelText("Пароль").fill("right");
  await dialog.getByRole("button", { name: "Войти" }).click();
  // Signed in: the dialog closes. This fake server lists no calendar, so the
  // calendar on this device stays, somewhere to write; it steps aside only
  // once a server's calendars are here (D122, the store's contract).
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await page.getByRole("button", { name: /^Аккаунты/ }).click();
  await expect.element(accounts.getByText("astro@cloud.example.com")).toBeInTheDocument();
  await expect
    .element(accounts.getByText("На этом устройстве", { exact: true }))
    .toBeInTheDocument();
  expect((await store.accounts()).map((a) => [a.provider, a.name])).toEqual([
    ["local", "На этом устройстве"],
    ["caldav", "astro@cloud.example.com"],
  ]);
  expect(secrets.values.size).toBe(1);
});

test("a new event's dialog open as the calendar on this device steps aside saves to the server's calendar it then shows (D122)", async () => {
  const store = await emptyStore();
  render(Promise.resolve(store), ["en-US"]);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await expect
    .element(dialog.getByRole("combobox", { name: "Calendar" }))
    .toHaveValue((await store.calendars())[0]!.id);
  await dialog.getByRole("textbox", { name: "Title" }).fill("Made meanwhile");
  // Meanwhile a server's account brings calendars for events and tasks: the
  // unused calendar on this device steps aside under the open dialog.
  const server = await store.addAccount({
    provider: "caldav",
    name: "astro@cloud.example.com",
    serverUrl: `${SERVER}/`,
    username: "astro",
  });
  const work = await store.saveCalendar({
    accountId: server.id,
    url: `${SERVER}/remote.php/dav/calendars/astro/work/`,
    name: "Work",
    color: null,
    components: ["VEVENT", "VTODO"],
    rights: ALL_RIGHTS,
  });
  await expect
    .element(
      dialog.getByRole("combobox", { name: "Calendar" }).getByRole("option", { name: "Work" }),
    )
    .toBeInTheDocument();
  await expect
    .element(
      dialog.getByRole("combobox", { name: "Calendar" }).getByRole("option", { name: "Personal" }),
    )
    .not.toBeInTheDocument();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  const [saved] = await store.pending(work.id);
  expect(saved?.ics).toContain("SUMMARY:Made meanwhile");
});

test("a hidden calendar that stepped aside leaves the view and new items to the server's (D122)", async () => {
  // The clock pinned mid-morning, as the views' other tests have it: with the
  // real one, from 23:00 in the test's zone a new event starts tomorrow, off
  // the day the view shows.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await emptyStore();
  const local = await store.addLocalCalendarIfEmpty({
    account: "On this device",
    calendar: "Personal",
    color: "#4f8fd6",
  });
  const [personal] = await store.calendars(local!.id);
  // The user hid the calendar on this device; then it steps aside for a server's.
  const preferences = memoryPreferences({
    "astrotime.view": "day",
    "astrotime.hiddenCalendars": JSON.stringify([personal!.id]),
  });
  const server = await store.addAccount({
    provider: "caldav",
    name: "astro@cloud.example.com",
    serverUrl: `${SERVER}/`,
    username: "astro",
  });
  const work = await store.saveCalendar({
    accountId: server.id,
    url: `${SERVER}/remote.php/dav/calendars/astro/work/`,
    name: "Work",
    color: null,
    components: ["VEVENT", "VTODO"],
    rights: ALL_RIGHTS,
  });
  expect(await store.removeLocalCalendarIfUnused()).toBe(true);
  render(Promise.resolve(store), ["en-US"], { preferences });
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New event" });
  await expect.element(dialog.getByRole("combobox", { name: "Calendar" })).toHaveValue(work.id);
  await dialog.getByRole("textbox", { name: "Title" }).fill("After the step aside");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect.element(dialog).not.toBeInTheDocument();
  await expect
    .element(page.getByRole("listitem", { name: /^After the step aside, / }))
    .toBeInTheDocument();
});

test("an approval held while its server is down is saved on a later sync's tick, after the backoff (D121)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await emptyStore();
  const secrets = memorySecrets();
  // An account of another server, whose syncs the test holds midway: a tick
  // is seen to run, and to end.
  await saveAccount(
    { store, secrets },
    {
      name: "astro@dav.example.org",
      serverUrl: "https://dav.example.org/",
      homeUrl: "https://dav.example.org/calendars/astro/",
      credentials: { username: "astro", password: "pw" },
    },
  );
  // A page went with its approval unsaved; its server is down, the browser online.
  secrets.values.set(
    "login-flow",
    JSON.stringify({
      step: "approved",
      token: "t0k3n",
      server: `${SERVER}/`,
      owner: "a-page-that-went",
      heldUntil: NOW.getTime() + 60 * 60_000,
      username: "astro",
      password: "app-pass",
    }),
  );
  const server = nextcloud({ password: "app-pass" });
  let down = true;
  let midway: Promise<void> | null = null;
  const tries: string[] = [];
  const http: HttpClient = async (request) => {
    if (new URL(request.url).host === "dav.example.org") {
      await midway;
      throw new OfflineError("away");
    }
    tries.push(request.url);
    if (down) throw new OfflineError("down");
    return server.http(request);
  };
  let request: (byUser: boolean) => void = () => {};
  render(Promise.resolve(store), ["en-US"], {
    http,
    secrets,
    pendingSignIn: secrets,
    onSyncRequest: (listener) => {
      request = listener;
      return () => {};
    },
  });
  const button = page.getByRole("button", { name: /^Accounts/ });
  await button.click();
  const accounts = page.getByRole("dialog", { name: "Accounts" });
  await expect
    .element(
      accounts.getByText("Signing in as astro@cloud.example.com once the server can be reached."),
    )
    .toBeInTheDocument();
  await accounts.getByRole("button", { name: "Close" }).click();
  await expect.element(accounts).not.toBeInTheDocument();
  const before = tries.length;

  // The server is back. A sync's tick within the backoff, seen to run and
  // end, leaves the approval be.
  down = false;
  let release = () => {};
  midway = new Promise((resolve) => (release = resolve));
  request(true);
  await expect.element(button).toHaveAccessibleName("Accounts, syncing");
  release();
  midway = null;
  await expect.element(button).not.toHaveAccessibleName("Accounts, syncing");
  expect(tries).toHaveLength(before);
  expect((await store.accounts()).filter((a) => a.name === "astro@cloud.example.com")).toEqual([]);

  // One after the backoff saves it.
  vi.setSystemTime(NOW.getTime() + 2 * 60_000);
  request(true);
  await button.click();
  await expect.element(accounts.getByText("astro@cloud.example.com")).toBeInTheDocument();
  expect(secrets.values.has("login-flow")).toBe(false);
});

test("the browser is asked to keep the data once there is something to keep, not on a first run's load (D121)", async () => {
  const store = await emptyStore();
  let asks = 0;
  let asked = () => {};
  const keeping = new Promise<void>((resolve) => (asked = resolve));
  const memory = memoryPreferences({ "astrotime.view": "day" });
  let answered: (value: string) => void = () => {};
  const answer = new Promise<string>((resolve) => (answered = resolve));
  const preferences = {
    get: memory.get,
    set: (key: string, value: string) => {
      memory.set(key, value);
      if (key === "astrotime.keepData") answered(value);
    },
  };
  render(Promise.resolve(store), ["en-US"], {
    preferences,
    keepData: async () => {
      asks++;
      asked();
      return false;
    },
  });
  // The first run: the empty calendar on this device, and no question yet.
  await page.getByRole("button", { name: /^Accounts/ }).click();
  await expect
    .element(page.getByRole("dialog", { name: "Accounts" }).getByText("On this device"))
    .toBeInTheDocument();
  expect(asks).toBe(0);
  // Its first item is worth keeping: asked, once, and the answer kept.
  const [personal] = await store.calendars();
  await store.saveLocal(
    personal!.id,
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\nBEGIN:VTODO\r\nUID:milk\r\nDTSTAMP:20261101T080000Z\r\nSUMMARY:Milk\r\nEND:VTODO\r\nEND:VCALENDAR\r\n",
  );
  await keeping;
  expect(asks).toBe(1);
  expect(await answer).toBe("refused");
});

test("a deployment's preset asks for the password alone, by itself, and not again once closed (D123)", async () => {
  const store = await emptyStore();
  const server = nextcloud({ password: "right" });
  const preferences = memoryPreferences({ "astrotime.view": "day" });
  const preset = { server: `${SERVER}/`, username: "astro" };
  render(Promise.resolve(store), ["en-US"], { http: server.http, preferences, preset });
  const dialog = page.getByRole("dialog", { name: "Sign in to cloud.example.com" });
  await expect.element(dialog.getByText("As astro")).toBeInTheDocument();
  await expect
    .element(dialog.getByRole("textbox", { name: "Server address" }))
    .not.toBeInTheDocument();
  await expect.element(dialog.getByRole("textbox", { name: "User name" })).not.toBeInTheDocument();
  // Closed unsigned: the calendar on this device, and no dialog the next time.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  expect(preferences.get("astrotime.presetSignIn")).toBe("dismissed");
  cleanups.pop()?.();
  render(Promise.resolve(store), ["en-US"], { http: server.http, preferences, preset });
  await expect.element(page.getByRole("button", { name: /^Accounts/ })).toBeInTheDocument();
  expect(document.querySelector('[role="dialog"]')).toBeNull();

  // From the accounts dialog it asks the same: the password signs in.
  await page.getByRole("button", { name: /^Accounts/ }).click();
  await page.getByRole("button", { name: "Add account" }).click();
  await dialog.getByLabelText("Password").fill("right");
  await dialog.getByRole("button", { name: "Sign in" }).click();
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await page.getByRole("button", { name: /^Accounts/ }).click();
  const accounts = page.getByRole("dialog", { name: "Accounts" });
  await expect.element(accounts.getByText("astro@cloud.example.com")).toBeInTheDocument();
  expect(
    (await store.accounts()).filter((a) => a.provider === "caldav").map((a) => a.username),
  ).toEqual(["astro"]);
  expect(preferences.get("astrotime.presetSignIn")).toBe("");
});

test("Login Flow v2 in the UI: it waits, opens the page again, cancels, and finishes on return", async () => {
  const store = await emptyStore();
  const server = nextcloud({ password: "app-pass" });
  const opened: string[] = [];
  render(Promise.resolve(store), ["en-US"], {
    http: server.http,
    openExternal: (url) => opened.push(url),
  });
  await page.getByRole("button", { name: /^Accounts/ }).click();
  await page.getByRole("button", { name: "Add account" }).click();
  const dialog = page.getByRole("dialog", { name: "Add an account" });
  await dialog.getByRole("textbox", { name: "Server address" }).fill("cloud.example.com");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect
    .element(dialog.getByRole("status").getByRole("heading", { name: "Waiting for Nextcloud" }))
    .toBeInTheDocument();
  expect(opened).toEqual([`${SERVER}/login/v2/flow/abc`]);
  await dialog.getByRole("button", { name: "Open the sign-in page again" }).click();
  expect(opened).toHaveLength(2);

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect.element(dialog.getByRole("button", { name: "Continue" })).toBeInTheDocument();

  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect
    .element(dialog.getByRole("heading", { name: "Waiting for Nextcloud" }))
    .toBeInTheDocument();
  // Approved on Nextcloud's page; coming back to the tab asks at once.
  server.approve();
  document.dispatchEvent(new Event("visibilitychange"));
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  // The server's account, beside the calendar on this device (this fake
  // server lists no calendar for it to step aside for, D122).
  expect(
    (await store.accounts()).filter((a) => a.provider === "caldav").map((a) => a.username),
  ).toEqual(["astro"]);
});

test("the back button closes what is open, the topmost first, then lets the shell leave (android D68)", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  const store = await demoStore(["en-US"]);
  let back: (() => boolean) | null = null;
  render(Promise.resolve(store), ["en-US"], {
    onBack: (close) => {
      back = close;
      return () => {
        if (back === close) back = null;
      };
    },
  });
  await expect.element(page.getByRole("button", { name: "Main menu" })).toBeInTheDocument();
  const press = () => {
    if (!back) throw new Error("The UI hears no back button.");
    return back();
  };

  // The drawer, a dialog opened from the top bar, the editor of a new event.
  await page.getByRole("button", { name: "Main menu" }).click();
  await expect.element(page.getByRole("dialog", { name: "Main menu" })).toBeInTheDocument();
  expect(press()).toBe(true);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await page.getByRole("button", { name: /^Accounts/ }).click();
  await expect.element(page.getByRole("dialog", { name: "Accounts" })).toBeInTheDocument();
  expect(press()).toBe(true);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect.element(page.getByRole("dialog", { name: "New event" })).toBeInTheDocument();
  expect(press()).toBe(true);
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();

  // Search, then the tasks screen.
  await page.getByRole("button", { name: "Search" }).click();
  await expect.element(page.getByRole("button", { name: "Close search" })).toBeInTheDocument();
  expect(press()).toBe(true);
  await expect.element(page.getByRole("button", { name: "Close search" })).not.toBeInTheDocument();
  await page.getByRole("button", { name: "Tasks", exact: true }).click();
  await expect.element(page.getByRole("region", { name: "Tasks" })).toBeInTheDocument();
  expect(press()).toBe(true);
  await expect.element(page.getByRole("region", { name: "Tasks" })).not.toBeInTheDocument();

  // Nothing open: the shell leaves the app.
  expect(press()).toBe(false);
});

test("the empty screens say what is empty and what to do, in English and Russian (design D134)", async () => {
  for (const [language, words] of [
    [
      "en-US",
      {
        tasks: "Tasks",
        noLists: "No task lists yet",
        listHint: /^A task list is a calendar that holds tasks\./,
        back: "Back to the calendar",
        search: "Search",
        searchHint: "Find events and tasks by their title",
        none: "Nothing found",
        scope: "Only the calendars shown are searched.",
      },
    ],
    [
      "ru-RU",
      {
        tasks: "Задачи",
        noLists: "Списков задач пока нет",
        listHint: /^Список задач — это календарь с задачами\./,
        back: "Назад к календарю",
        search: "Поиск",
        searchHint: "Найдите мероприятие или задачу по названию",
        none: "Ничего не найдено",
        scope: "Поиск идёт только по показанным календарям.",
      },
    ],
  ] as const) {
    const store = await demoStore([language]);
    // No calendar holds tasks: the tasks screen has no list to show.
    for (const calendar of await store.calendars()) {
      if (calendar.components.includes("VTODO")) await store.removeCalendar(calendar.id);
    }
    render(Promise.resolve(store), [language]);
    await page.getByRole("button", { name: words.tasks, exact: true }).click();
    const tasks = page.getByRole("region", { name: words.tasks });
    await expect.element(tasks.getByText(words.noLists)).toBeInTheDocument();
    await expect.element(tasks.getByText(words.listHint)).toBeInTheDocument();
    expect(tasks.getByRole("tablist").elements()).toEqual([]);
    await tasks.getByRole("button", { name: words.back }).click();

    // Search before a word is typed, and when nothing is found.
    await page.getByRole("button", { name: words.search, exact: true }).click();
    // The status is there, saying nothing on open (the hint is outside it),
    // before a query finds nothing, so what it comes to say is said.
    const status = page.getByRole("status");
    await expect.element(page.getByText(words.searchHint)).toBeInTheDocument();
    await expect.element(status).toBeInTheDocument();
    expect(status.element().textContent).toBe("");
    const region = status.element();
    await expect.element(page.getByText(words.scope)).toBeInTheDocument();
    await page.getByRole("searchbox").fill("zzzz");
    // Said to a screen reader as the search's outcome: the same region, new words.
    await expect.element(status.getByText(words.none)).toBeInTheDocument();
    expect(status.element()).toBe(region);
    await expect.element(page.getByText(words.scope)).toBeInTheDocument();
    for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
  }
});

test("a signed-out account offers to sign in again wherever it is shown, and its rows say nothing on their own (design D137)", async () => {
  const store = await emptyStore();
  const secrets = memorySecrets();
  await saveAccount(
    { store, secrets },
    {
      name: "astro@cloud.example.com",
      serverUrl: `${SERVER}/`,
      homeUrl: `${SERVER}/remote.php/dav/calendars/astro/`,
      credentials: { username: "astro", password: "revoked" },
    },
  );
  // The server refuses the saved password: the account is signed out. A
  // sync's requests wait while `held` is set, to hear it run.
  const server = nextcloud({ password: "right" });
  let held: Promise<void> | null = null;
  let release = () => {};
  const http: HttpClient = async (request) => {
    await held;
    return server.http(request);
  };
  let requestSync: (byUser: boolean) => void = () => {};
  render(Promise.resolve(store), ["en-US"], {
    http,
    secrets,
    onSyncRequest: (listener) => {
      requestSync = listener;
      return () => {};
    },
  });
  const button = page.getByRole("button", { name: /^Accounts/ });
  await expect.element(button).toHaveAccessibleName("Accounts, something needs your attention");

  // The accounts dialog: its row says it, and "Sign in again" is there; no
  // live region of its own.
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Accounts" });
  await expect.element(dialog.getByText("Signed out: sign in again to sync")).toBeInTheDocument();
  await expect.element(dialog.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  // The dialog's one live region, silent while nothing changes; the row's line is text.
  expect(dialog.getByRole("status").elements()).toHaveLength(1);
  expect(dialog.getByRole("status").element().textContent).toBe("");
  // The account's menu offers what is the account's own: no "Sync now",
  // which syncs every account and is the dialog's (design D137).
  await dialog.getByRole("button", { name: "Options for astro@cloud.example.com" }).click();
  const menu = page.getByRole("menu");
  await expect.element(menu).toBeInTheDocument();
  expect(
    menu
      .getByRole("menuitem")
      .elements()
      .map((item) => item.textContent),
  ).toEqual(["Sign in again", "Remove from this device"]);
  await userEvent.keyboard("{Escape}");
  await expect.element(menu).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();

  // The drawer's head, compact, offers it too.
  await page.getByRole("button", { name: "Main menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Main menu" });
  await expect.element(drawer.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  expect(drawer.getByRole("status").elements()).toEqual([]);

  // Settings, the same row.
  await drawer.getByRole("button", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings" });
  const row = settings.getByRole("region", { name: "astro@cloud.example.com" });
  await expect.element(row.getByText("Signed out: sign in again to sync")).toBeInTheDocument();
  await expect.element(row.getByRole("button", { name: "Sign in again" })).toBeInTheDocument();
  expect(settings.getByRole("status").elements()).toEqual([]);
  // It closes Settings and opens signing in again.
  await row.getByRole("button", { name: "Sign in again" }).click();
  await expect.element(settings).not.toBeInTheDocument();
  await expect.element(page.getByRole("dialog", { name: "Sign in again" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");

  // The one live region keeps saying the need through a sync, once.
  const said = page.getByRole("status").filter({ hasText: "something needs your attention" });
  held = new Promise((resolve) => (release = resolve));
  requestSync(true);
  await expect.element(button).toHaveAccessibleName("Accounts, syncing");
  expect(said.element().textContent).toBe("Accounts, something needs your attention");
  held = null;
  release();
  await expect.element(button).toHaveAccessibleName("Accounts, something needs your attention");
});

test("with the accounts dialog open, a sync is said to run and to end, once, in the dialog's one live region (design D120, D137)", async () => {
  const store = await emptyStore();
  const secrets = memorySecrets();
  await saveAccount(
    { store, secrets },
    {
      name: "astro@cloud.example.com",
      serverUrl: `${SERVER}/`,
      homeUrl: `${SERVER}/remote.php/dav/calendars/astro/`,
      credentials: { username: "astro", password: "revoked" },
    },
  );
  const server = nextcloud({ password: "right" });
  let held: Promise<void> | null = null;
  let release = () => {};
  const http: HttpClient = async (request) => {
    await held;
    return server.http(request);
  };
  render(Promise.resolve(store), ["en-US"], { http, secrets });
  const button = page.getByRole("button", { name: /^Accounts/ });
  await expect.element(button).toHaveAccessibleName("Accounts, something needs your attention");
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Accounts" });
  // One live region in the dialog, silent while nothing changes.
  const region = dialog.getByRole("status");
  await expect.element(region).toBeInTheDocument();
  expect(region.element().textContent).toBe("");
  held = new Promise((resolve) => (release = resolve));
  await dialog.getByRole("button", { name: "Sync now" }).click();
  await expect.element(region).toHaveTextContent("Accounts, syncing");
  held = null;
  release();
  // It ended still needing the user, and says so, once for the account.
  await expect.element(region).toHaveTextContent("Accounts, something needs your attention");
  expect(dialog.getByRole("status").elements()).toHaveLength(1);
});

test("a sync that ends with no server reachable is said in the calm offline words, never as synced (design D137)", async () => {
  const store = await emptyStore();
  const secrets = memorySecrets();
  await saveAccount(
    { store, secrets },
    {
      name: "astro@cloud.example.com",
      serverUrl: `${SERVER}/`,
      homeUrl: `${SERVER}/remote.php/dav/calendars/astro/`,
      credentials: { username: "astro", password: "right" },
    },
  );
  // No network: every request fails as the platform's offline does. A sync's
  // requests wait while `held` is set, to hear it run.
  let held: Promise<void> | null = null;
  let release = () => {};
  const http: HttpClient = async () => {
    await held;
    throw new OfflineError("no network");
  };
  render(Promise.resolve(store), ["en-US"], { http, secrets });
  const button = page.getByRole("button", { name: /^Accounts/ });
  // Offline is calm: no need, no dot.
  await expect.element(button).toHaveAccessibleName("Accounts");
  await button.click();
  const dialog = page.getByRole("dialog", { name: "Accounts" });
  const region = dialog.getByRole("status");
  await expect.element(region).toBeInTheDocument();
  expect(region.element().textContent).toBe("");
  held = new Promise((resolve) => (release = resolve));
  await dialog.getByRole("button", { name: "Sync now" }).click();
  await expect.element(region).toHaveTextContent("Accounts, syncing");
  held = null;
  release();
  await expect
    .element(region)
    .toHaveTextContent("Offline: changes wait until the server can be reached");
  expect(region.element().textContent).not.toContain("synced");
});
