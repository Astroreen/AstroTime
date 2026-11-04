// A Google account (docs/plans/providers.md#D252): one account of provider
// `google`, its calendars over Google's CalDAV with an OAuth bearer token
// (events, iCalendar end to end), its task lists over the Tasks API
// (`tasks.ts`). One provider: each call names a calendar or an href, and
// goes to the API whose address it is. Nothing outside this package knows
// there are two (AGENTS.md rule 4). Loaded only with a Google account (D255).
import { CalDavProvider, type HttpClient, type TokenSource } from "@astrotime/caldav";
import {
  PartialListing,
  type Changes,
  type Provider,
  type RemoteCalendar,
  type RemoteObject,
  type SyncState,
  type WriteResult,
} from "@astrotime/core/provider";

import { GoogleTasks, TASKS_API } from "./tasks.ts";

export { GoogleTasks, taskFieldsOf, TASKS_API, vtodoOf, type GoogleTask } from "./tasks.ts";

/** Google's CalDAV, where discovery of an account's calendar home starts. */
export const GOOGLE_CALDAV = "https://apidata.googleusercontent.com/caldav/v2/";

export class GoogleProvider implements Provider {
  private readonly events: Provider;
  private readonly tasks: Provider;

  constructor(events: Provider, tasks: Provider) {
    this.events = events;
    this.tasks = tasks;
  }

  /** The API an address is of: the Tasks API's, or else Google's CalDAV. */
  private of(url: string): Provider {
    return url.startsWith(TASKS_API) ? this.tasks : this.events;
  }

  /**
   * Both APIs' calendars. One failing (the Tasks API not enabled, its scope
   * not given) does not take the other down: what was read syncs, the rest
   * stays as it is, said (`PartialListing`); both failing is the sync's failure.
   */
  async calendars(): Promise<RemoteCalendar[]> {
    const [events, tasks] = await Promise.allSettled([
      this.events.calendars(),
      this.tasks.calendars(),
    ]);
    if (events.status === "rejected" && tasks.status === "rejected") throw events.reason;
    if (events.status === "fulfilled" && tasks.status === "fulfilled")
      return [...events.value, ...tasks.value];
    const read =
      events.status === "fulfilled"
        ? events.value
        : (tasks as PromiseFulfilledResult<RemoteCalendar[]>).value;
    const failed = events.status === "rejected" ? events : (tasks as PromiseRejectedResult);
    throw new PartialListing(read, [
      { prefix: events.status === "rejected" ? GOOGLE_CALDAV : TASKS_API, error: failed.reason },
    ]);
  }

  changes(
    calendarUrl: string,
    state: SyncState,
    known: ReadonlyMap<string, string | null>,
    listed?: SyncState,
  ): Promise<Changes> {
    return this.of(calendarUrl).changes(calendarUrl, state, known, listed);
  }

  fetch(href: string): Promise<RemoteObject | null> {
    return this.of(href).fetch(href);
  }

  create(href: string, ics: string): Promise<WriteResult> {
    return this.of(href).create(href, ics);
  }

  update(href: string, ics: string, etag: string | null): Promise<WriteResult> {
    return this.of(href).update(href, ics, etag);
  }

  remove(href: string, etag: string | null): Promise<WriteResult> {
    return this.of(href).remove(href, etag);
  }
}

/** A Google account's provider, from the calendar home its sign-in found. */
export function googleProvider(
  http: HttpClient,
  tokens: TokenSource,
  homeUrl: string,
): GoogleProvider {
  return new GoogleProvider(
    new CalDavProvider(http, tokens, homeUrl),
    new GoogleTasks(http, tokens),
  );
}
