// Records what Nextcloud's own web Calendar and Tasks apps write
// (docs/plans/foundation.md, PR 4): a browser creates each item through their
// pages, and the object is then fetched over CalDAV, as AstroTime reads it,
// into packages/core/test/fixtures/nextcloud-web-*.ics. How to run it and what
// it recorded: packages/core/test/fixtures/README.md.
//
//   node scripts/record-nextcloud-fixtures.ts
//
// It starts a disposable Nextcloud (with PostgreSQL: on SQLite the Tasks app's
// writes fail with "database is locked") in Docker on 127.0.0.1, installs the
// Calendar and Tasks apps, and removes the containers at the end. It needs
// docker and Playwright's Chromium (the dev shell's).
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { chromium, type Locator, type Page } from "playwright";

const IMAGE = process.env.ASTROTIME_RECORD_IMAGE ?? "nextcloud:31-apache";
const PORT = process.env.ASTROTIME_RECORD_PORT ?? "18090";
const SERVER = `http://127.0.0.1:${PORT}/`;
const USER = "astro";
const PASSWORD = "astrotime-test-password";
const NAME = "astrotime-record-nextcloud";
const FIXTURES = new URL("../packages/core/test/fixtures/", import.meta.url);
// The browser's zone and clock: the items land on fixed days whenever this runs,
// and DTSTAMP, CREATED and LAST-MODIFIED fall on this morning.
const TIME_ZONE = "Europe/Vilnius";
const NOW = new Date("2026-11-02T07:00:00Z");

const docker = (...args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const occ = (...args: string[]) =>
  docker("exec", "--user", "www-data", NAME, "php", "occ", ...args);

/** Resolves once a container's log matches: its own word that it is ready, never a sleep. */
function logMatches(container: string, ready: RegExp): Promise<void> {
  const logs = spawn("docker", ["logs", "--follow", container], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((resolve, reject) => {
    let log = "";
    const onData = (chunk: Buffer) => {
      log += chunk.toString();
      if (!ready.test(log)) return;
      logs.kill();
      resolve();
    };
    logs.stdout.on("data", onData);
    logs.stderr.on("data", onData);
    logs.once("exit", () => reject(new Error(`${container} stopped before it was ready:\n${log}`)));
  });
}

async function startNextcloud(): Promise<{ versions: Record<string, string> }> {
  docker("network", "create", NAME);
  const env = (variables: Record<string, string>) =>
    Object.entries(variables).flatMap(([name, value]) => ["-e", `${name}=${value}`]);
  const database = {
    POSTGRES_DB: "nextcloud",
    POSTGRES_USER: "nextcloud",
    POSTGRES_PASSWORD: "nextcloud",
  };
  docker(
    "run",
    "-d",
    "--name",
    `${NAME}-db`,
    "--network",
    NAME,
    ...env(database),
    "postgres:17-alpine",
  );
  // The image starts a temporary server for its set-up first; the real one follows.
  await logMatches(`${NAME}-db`, /init process complete[\s\S]*ready to accept connections/);
  docker(
    "run",
    "-d",
    "--name",
    NAME,
    "--network",
    NAME,
    "-p",
    `127.0.0.1:${PORT}:80`,
    ...env({
      ...database,
      POSTGRES_HOST: `${NAME}-db`,
      NEXTCLOUD_ADMIN_USER: USER,
      NEXTCLOUD_ADMIN_PASSWORD: PASSWORD,
      NEXTCLOUD_TRUSTED_DOMAINS: "localhost 127.0.0.1",
    }),
    IMAGE,
  );
  // Apache starts once the installation is done.
  await logMatches(NAME, /resuming normal operations/);
  occ("app:install", "calendar");
  occ("app:install", "tasks");
  // Its welcome dialog would cover the apps on the first visit.
  occ("app:disable", "firstrunwizard");
  const apps = JSON.parse(occ("app:list", "--output=json")) as {
    enabled: Record<string, string>;
  };
  const status = JSON.parse(occ("status", "--output=json")) as { versionstring: string };
  return {
    versions: {
      Nextcloud: status.versionstring,
      Calendar: apps.enabled.calendar ?? "?",
      Tasks: apps.enabled.tasks ?? "?",
    },
  };
}

function stopNextcloud() {
  for (const container of [NAME, `${NAME}-db`]) {
    try {
      docker("rm", "--force", "--volumes", container);
    } catch {
      // Not started.
    }
  }
  try {
    docker("network", "rm", NAME);
  } catch {
    // Not created.
  }
}

const authorization = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`;

async function hrefs(calendar: string): Promise<string[]> {
  const response = await fetch(new URL(`remote.php/dav/calendars/${USER}/${calendar}/`, SERVER), {
    method: "PROPFIND",
    headers: { Authorization: authorization, Depth: "1" },
  });
  const body = await response.text();
  return [...body.matchAll(/<d:href>([^<]*\.ics)<\/d:href>/g)].map((match) => match[1]!);
}

/** The object as a CalDAV client reads it back. */
async function served(href: string): Promise<string> {
  const response = await fetch(new URL(href, SERVER), {
    headers: { Authorization: authorization },
  });
  if (response.status !== 200) throw new Error(`GET ${href}: ${response.status}`);
  return response.text();
}

/** Resolves when the page's next write of a calendar object has been answered. */
function nextWrite(page: Page, status?: number) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" &&
      response.url().includes("/remote.php/dav/calendars/") &&
      (status === undefined ? response.status() < 300 : response.status() === status),
  );
}

/**
 * Opens one of the apps' pages and waits until it has loaded what it shows: the
 * Calendar app draws its editor before the week's events arrive and draws it
 * again after, closing any select opened in between.
 */
async function visit(page: Page, path: string) {
  await page.goto(new URL(path, SERVER).href);
  await page.waitForLoadState("networkidle");
}

const seconds = (iso: string) => Date.parse(iso) / 1000;

// --- The Calendar app -----------------------------------------------------------------------

/** The Calendar app's full editor for a new event, as its own "new" route opens it. */
async function newEvent(page: Page, allDay: boolean, from: string, to: string) {
  await visit(
    page,
    `apps/calendar/timeGridWeek/${from.slice(0, 10)}/new/full/${allDay ? 1 : 0}/${seconds(from)}/${seconds(to)}`,
  );
  const editor = eventEditor(page);
  await editor.getByRole("textbox", { name: "Event title" }).waitFor();
  return editor;
}

/** Opens one of the editor's selects (vue-select): it opens on its toggle, not its input. */
async function openSelect(combobox: Locator) {
  await combobox.locator("xpath=ancestor::div[contains(@class,'vs__dropdown-toggle')]").click();
}

const eventEditor = (page: Page) =>
  page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Edit event" }) });

/** Creates the event and returns its href. */
async function saveNewEvent(page: Page): Promise<string> {
  const before = await hrefs("personal");
  const written = nextWrite(page);
  await eventEditor(page).getByRole("button", { name: "Save" }).click();
  await written;
  const created = (await hrefs("personal")).filter((href) => !before.includes(href));
  if (created.length !== 1) throw new Error(`Expected one new event, found ${created.length}.`);
  return created[0]!;
}

/** The full editor of one occurrence of a series, by the Calendar app's own route. */
async function openOccurrence(page: Page, href: string, start: string) {
  const id = Buffer.from(href).toString("base64");
  await visit(
    page,
    `apps/calendar/timeGridWeek/${start.slice(0, 10)}/edit/full/${id}/${seconds(start)}`,
  );
  const editor = eventEditor(page);
  await editor.getByRole("textbox", { name: "Event title" }).waitFor();
  return editor;
}

async function timedEvent(page: Page): Promise<string> {
  const editor = await newEvent(page, false, "2026-11-16T08:00:00Z", "2026-11-16T09:00:00Z");
  await editor.getByRole("textbox", { name: "Event title" }).fill("Planning");
  await editor.getByRole("textbox", { name: "Add a location" }).fill("Room 4, second floor");
  await editor
    .getByRole("textbox", { name: /^Add a description/ })
    .fill("Agenda:\n- the week ahead\n- blockers");
  await openSelect(editor.getByRole("combobox", { name: "Search or add categories" }));
  await page.keyboard.type("Work");
  await page.keyboard.press("Enter");
  await editor.getByText("Work", { exact: true }).waitFor();
  return saveNewEvent(page);
}

async function allDayEvent(page: Page): Promise<string> {
  // The Calendar app's own new-event route takes the all-day span as midnights in the user's zone.
  await newEvent(page, true, "2026-11-16T22:00:00Z", "2026-11-17T22:00:00Z");
  await eventEditor(page).getByRole("textbox", { name: "Event title" }).fill("Day off");
  return saveNewEvent(page);
}

async function multiDayEvent(page: Page): Promise<string> {
  await newEvent(page, true, "2026-11-17T22:00:00Z", "2026-11-20T22:00:00Z");
  await eventEditor(page).getByRole("textbox", { name: "Event title" }).fill("Conference");
  return saveNewEvent(page);
}

async function reminderEvent(page: Page): Promise<string> {
  const editor = await newEvent(page, false, "2026-11-19T14:00:00Z", "2026-11-19T15:00:00Z");
  await editor.getByRole("textbox", { name: "Event title" }).fill("Dentist");
  // The select opens on its toggle; its options are drawn outside the dialog, which hides
  // them from the accessibility tree while the dialog is open.
  await openSelect(editor.getByRole("combobox", { name: "Add reminder" }));
  await page.getByRole("option", { name: /^15 minutes before/, includeHidden: true }).click();
  await editor
    .getByText(/15 minutes before/)
    .first()
    .waitFor();
  return saveNewEvent(page);
}

/** Weekly, six times; the second occurrence moved and renamed, the third deleted. */
async function recurringEvent(page: Page): Promise<string> {
  const editor = await newEvent(page, false, "2026-11-23T07:00:00Z", "2026-11-23T07:30:00Z");
  await editor.getByRole("textbox", { name: "Event title" }).fill("Standup");
  await editor.getByRole("button", { name: "Edit" }).click();
  const repeat = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Repeat event" }) });
  // The frequency's list is open as the dialog opens.
  await page.getByRole("option", { name: "week" }).click();
  await repeat.getByRole("combobox").last().click();
  await page.getByRole("option", { name: "after" }).click();
  await repeat.getByRole("spinbutton").last().fill("6");
  await repeat.getByRole("button", { name: "Close" }).click();
  await editor.getByText(/Weekly on Monday/).waitFor();
  const href = await saveNewEvent(page);

  const moved = await openOccurrence(page, href, "2026-11-30T07:00:00Z");
  await moved.getByRole("textbox", { name: "Event title" }).fill("Standup (moved)");
  // The start and end times are the browser's own time inputs.
  await moved.locator("input[type=time]").first().fill("11:00");
  await moved.locator("input[type=time]").last().fill("11:30");
  let written = nextWrite(page);
  await moved.getByRole("button", { name: "Update this occurrence" }).click();
  await written;

  const deleted = await openOccurrence(page, href, "2026-12-07T07:00:00Z");
  await deleted.getByRole("button", { name: "Actions" }).first().click();
  written = nextWrite(page);
  await page.getByRole("menuitem", { name: "Delete this occurrence" }).click();
  await written;
  return href;
}

// --- The Tasks app --------------------------------------------------------------------------

/** Adds a task from the Tasks app's input; its details open beside the list. */
async function newTask(page: Page, summary: string) {
  await visit(page, "apps/tasks/");
  const add = page.getByRole("textbox", { name: /^Add a task to/ });
  const written = nextWrite(page, 201);
  await add.fill(summary);
  await add.press("Enter");
  const href = new URL((await written).url()).pathname;
  const details = page.getByRole("complementary");
  await details.getByRole("heading", { name: summary }).waitFor();
  return { href, details };
}

/** Sets the start or due date to a day of November 2026, at the time the picker offers. */
async function setDate(page: Page, which: "start" | "due", day: number) {
  const details = page.getByRole("complementary");
  await details.getByText(which === "start" ? "Set start date" : "Set due date").click();
  await details.getByRole("textbox", { name: "Datepicker input" }).first().click();
  await page.getByRole("gridcell", { name: String(day), exact: true }).click();
  const written = nextWrite(page);
  await details.getByRole("button", { name: "Set date" }).click();
  await written;
}

async function taskWithDue(page: Page): Promise<string> {
  const { href } = await newTask(page, "Send the report");
  await setDate(page, "due", 20);
  return href;
}

async function taskWithStartAndDue(page: Page): Promise<string> {
  const { href } = await newTask(page, "Write the slides");
  await setDate(page, "start", 16);
  await setDate(page, "due", 18);
  return href;
}

async function completedTask(page: Page): Promise<string> {
  const { href, details } = await newTask(page, "Renew the passport");
  await setDate(page, "due", 10);
  // A date without a time; the toggle saves at once. (The Tasks app remembers it for the
  // next task, so the timed tasks are recorded first.)
  let written = nextWrite(page);
  await details.getByText("All day", { exact: true }).click();
  await written;
  await details.getByText("Due on November 10, 2026").waitFor();
  written = nextWrite(page);
  // The checkbox is drawn by its label.
  await details
    .getByRole("checkbox", { name: "Task is not completed" })
    .locator("xpath=following-sibling::label")
    .click();
  await written;
  return href;
}

async function subtask(page: Page): Promise<string> {
  await newTask(page, "Move house");
  const parent = page.getByRole("main").getByRole("listitem").filter({ hasText: "Move house" });
  await parent.getByRole("button", { name: "Actions" }).first().click();
  await page.getByRole("menuitem", { name: "Add subtask" }).click();
  const add = page.getByRole("textbox", { name: 'Add a subtask to "Move house"…' });
  const written = nextWrite(page, 201);
  await add.fill("Pack the books");
  await add.press("Enter");
  return new URL((await written).url()).pathname;
}

async function taskWithPriorityAndCategories(page: Page): Promise<string> {
  const { href, details } = await newTask(page, "Buy a gift");
  await details.getByText("No priority assigned").click();
  let written = nextWrite(page);
  await details.getByRole("spinbutton").fill("1");
  await details.getByRole("button", { name: "Set value" }).click();
  await written;
  await details.getByRole("combobox", { name: "Select tags" }).click();
  for (const tag of ["Errands", "Family"]) {
    written = nextWrite(page);
    await page.keyboard.type(tag);
    await page.keyboard.press("Enter");
    await written;
  }
  return href;
}

// --- Recording ------------------------------------------------------------------------------

const RECORDINGS: [string, (page: Page) => Promise<string>][] = [
  ["event-timed", timedEvent],
  ["event-allday", allDayEvent],
  ["event-multiday", multiDayEvent],
  ["event-reminder", reminderEvent],
  ["event-recurring", recurringEvent],
  ["task-due", taskWithDue],
  ["task-start-due", taskWithStartAndDue],
  ["task-completed", completedTask],
  ["task-subtask", subtask],
  ["task-priority-categories", taskWithPriorityAndCategories],
];

async function record() {
  const { versions } = await startNextcloud();
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      timezoneId: TIME_ZONE,
      locale: "en-US",
      viewport: { width: 1400, height: 1000 },
    });
    await context.clock.install({ time: NOW });
    const page = await context.newPage();
    await page.goto(new URL("login", SERVER).href);
    await page.getByRole("textbox", { name: /^Account name/ }).fill(USER);
    await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/apps\//);

    for (const [name, create] of RECORDINGS) {
      const ics = await served(await create(page));
      // Nothing of the machine that recorded it: the server's address never belongs in a fixture.
      if (/127\.0\.0\.1|localhost/.test(ics)) throw new Error(`${name} names the test server.`);
      // Nothing that looks like an address of a person, either.
      if (/[\w.+-]+@[\w-]+(\.[\w-]+)+/.test(ics)) throw new Error(`${name} has an e-mail address.`);
      writeFileSync(new URL(`nextcloud-web-${name}.ics`, FIXTURES), ics);
      console.log(`recorded nextcloud-web-${name}.ics`);
    }
  } finally {
    await browser.close();
  }
  console.log(
    Object.entries(versions)
      .map(([app, version]) => `${app} ${version}`)
      .join(", "),
  );
}

stopNextcloud();
try {
  await record();
} finally {
  if (!process.env.ASTROTIME_RECORD_KEEP) stopNextcloud();
}
