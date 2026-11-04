// What a recording records (docs/plans/providers.md#D249): one account's
// discovery, its calendars, and a calendar of the recording's own with an
// event (and a task, where the service keeps them) made, found by a sync,
// changed, deleted, and the calendar removed. The same steps run against
// the service by scripts/record-caldav-service.ts and against the recording
// by services.test.ts; every value in them is fixed, so the requests are
// the same each time.
import {
  Authorization,
  CalDavProvider,
  send,
  type Credentials,
  type HttpClient,
} from "../src/index.ts";

const CALENDAR = "astrotime-recording";

const object = (component: "VEVENT" | "VTODO", summary: string) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AstroTime//Recording//EN",
    `BEGIN:${component}`,
    `UID:astrotime-recording-${component.toLowerCase()}`,
    "DTSTAMP:20261104T080000Z",
    ...(component === "VEVENT"
      ? ["DTSTART:20261110T090000Z", "DTEND:20261110T100000Z"]
      : ["DUE:20261110T170000Z"]),
    `SUMMARY:${summary}`,
    `END:${component}`,
    "END:VCALENDAR",
    "",
  ].join("\r\n");

export interface ScenarioResult {
  /** The home's calendars before the recording's own was made: their components. */
  readonly calendars: readonly (readonly string[])[];
  /** What the sync after the creations found, by summary. */
  readonly found: readonly string[];
  /** What the sync after the change found. */
  readonly changed: readonly string[];
  /** Whether the deletions went through. */
  readonly removed: boolean;
}

export async function scenario(
  http: HttpClient,
  server: string,
  credentials: Credentials,
  options: { readonly tasks: boolean },
): Promise<ScenarioResult> {
  const { homeUrl } = await CalDavProvider.discover(http, server, credentials);
  const provider = new CalDavProvider(http, credentials, homeUrl);
  const calendars = (await provider.calendars()).map((calendar) => calendar.components);
  const authorization = new Authorization(credentials);
  const calendarUrl = new URL(`${CALENDAR}/`, homeUrl).href;
  const components = options.tasks ? ["VEVENT", "VTODO"] : ["VEVENT"];
  await send(
    http,
    authorization,
    {
      method: "MKCALENDAR",
      url: calendarUrl,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>${CALENDAR}</d:displayname><c:supported-calendar-component-set>${components.map((c) => `<c:comp name="${c}"/>`).join("")}</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`,
    },
    [],
  );
  try {
    const event = `${calendarUrl}astrotime-recording-event.ics`;
    const task = `${calendarUrl}astrotime-recording-task.ics`;
    const created = await provider.create(event, object("VEVENT", "Recorded event"));
    if (options.tasks) await provider.create(task, object("VTODO", "Recorded task"));
    const first = await provider.changes(calendarUrl, { syncToken: null, ctag: null }, new Map());
    const summary = (ics: string) => /SUMMARY:(.*)\r?\n/.exec(ics)?.[1] ?? "";
    const found = first.changed.map((o) => summary(o.ics)).toSorted();
    const etag = created.ok ? created.etag : null;
    await provider.update(event, object("VEVENT", "Recorded event changed"), etag);
    const known = new Map(first.changed.map((o) => [o.href, o.etag]));
    const second = await provider.changes(calendarUrl, first, known);
    const changed = second.changed.map((o) => summary(o.ics)).toSorted();
    const current = second.changed.find((o) => o.href === event)?.etag ?? null;
    const removed = (await provider.remove(event, current)).ok;
    return { calendars, found, changed, removed };
  } finally {
    await send(http, authorization, { method: "DELETE", url: calendarUrl, headers: {} }, [404]);
  }
}
