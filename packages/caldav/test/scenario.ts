// What a recording records (docs/plans/providers.md#D249): one account's
// discovery, its calendars, and a calendar of the recording's own with an
// event (and a task, where the service keeps them) made, found by a sync,
// changed, deleted, and the calendar removed; calendars an earlier run
// left are removed first. The same steps run against the service by
// scripts/record-caldav-service.ts and against the recording by
// services.test.ts. Every value in them is fixed but the calendar's name,
// which is the run's own (`calendarName`) and kept in the recording, so a
// replay given it sends the requests the recording holds.
import {
  Authorization,
  CalDavProvider,
  send,
  type Credentials,
  type HttpClient,
  type RememberedScheme,
} from "../src/index.ts";

/** What the recordings' calendars are named from: a run's own name follows it. */
const PREFIX = "astrotime-recording-";

/** A calendar name for a new recording, unique to the run. */
export const calendarName = () =>
  `${PREFIX}${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

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
  options: { readonly tasks: boolean; readonly calendar: string },
): Promise<ScenarioResult> {
  // One app's run after the sign-in: what its first sync learns of the
  // scheme, the rest answers at once (D260).
  const schemes: RememberedScheme = {};
  const { homeUrl } = await CalDavProvider.discover(http, server, credentials);
  const provider = new CalDavProvider(http, credentials, homeUrl, schemes);
  const listed = await provider.calendars();
  const authorization = new Authorization(credentials, schemes);
  // Twice at most: a cleanup the server answered with a failure is tried again.
  const remove = async (url: string) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await send(http, authorization, { method: "DELETE", url, headers: {} }, [404]);
        return;
      } catch (error) {
        if (attempt === 1) throw error;
      }
    }
  };
  // What an earlier run left, whose cleanup failed for good, goes first.
  for (const leftover of listed.filter((calendar) => calendar.name.startsWith(PREFIX)))
    await remove(leftover.url);
  const calendars = listed
    .filter((calendar) => !calendar.name.startsWith(PREFIX))
    .map((calendar) => calendar.components);
  const calendarUrl = new URL(`${options.calendar}/`, homeUrl).href;
  let result: ScenarioResult;
  const components = options.tasks ? ["VEVENT", "VTODO"] : ["VEVENT"];
  await send(
    http,
    authorization,
    {
      method: "MKCALENDAR",
      url: calendarUrl,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
      body: `<?xml version="1.0" encoding="utf-8"?><c:mkcalendar xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:set><d:prop><d:displayname>${options.calendar}</d:displayname><c:supported-calendar-component-set>${components.map((c) => `<c:comp name="${c}"/>`).join("")}</c:supported-calendar-component-set></d:prop></d:set></c:mkcalendar>`,
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
    result = { calendars, found, changed, removed };
  } catch (error) {
    // The scenario's own failure is what to see: a cleanup that fails too
    // says so beside it, never in its place.
    await remove(calendarUrl).catch((cleanup: unknown) => {
      throw new AggregateError([error, cleanup], "The scenario failed, and so did its cleanup.", {
        cause: error,
      });
    });
    throw error;
  }
  await remove(calendarUrl);
  return result;
}
