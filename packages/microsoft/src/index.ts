// A Microsoft account (docs/plans/providers.md#D253): one account of provider
// `microsoft`, its Outlook calendars and its To Do lists over Microsoft
// Graph, in one provider that sends each call to the part whose address it
// names. Loaded only with a Microsoft account (D255).
import type { HttpClient, TokenSource } from "@astrotime/caldav";
import {
  PartialListing,
  type Changes,
  type NewCalendar,
  type Provider,
  type RemoteCalendar,
  type RemoteObject,
  type SyncState,
  type WriteResult,
} from "@astrotime/core/provider";

import { OutlookCalendars } from "./events.ts";
import { Graph, GRAPH } from "./graph.ts";
import { MicrosoftTodo } from "./todo.ts";

export {
  eventFieldsOf,
  OutlookCalendars,
  recurrenceOf,
  rruleOf,
  veventOf,
  type GraphEvent,
} from "./events.ts";
export { Graph, GRAPH } from "./graph.ts";
export { MicrosoftTodo, todoFieldsOf, vtodoOf, type TodoTask } from "./todo.ts";

/** Where each part's calendars are. */
const CALENDARS = `${GRAPH}me/calendars/`;
const TODO = `${GRAPH}me/todo/`;

export class MicrosoftProvider implements Provider {
  private readonly events: Provider;
  private readonly tasks: Provider;

  constructor(events: Provider, tasks: Provider) {
    this.events = events;
    this.tasks = tasks;
  }

  private of(url: string): Provider {
    return url.startsWith(TODO) ? this.tasks : this.events;
  }

  /** Both parts' calendars; one failing leaves the other syncing (`PartialListing`), both the sync's failure. */
  async calendars(): Promise<RemoteCalendar[]> {
    const [events, tasks] = await Promise.allSettled([
      this.events.calendars(),
      this.tasks.calendars(),
    ]);
    if (events.status === "fulfilled" && tasks.status === "fulfilled")
      return [...events.value, ...tasks.value];
    if (events.status === "rejected" && tasks.status === "rejected") throw events.reason;
    if (events.status === "fulfilled")
      throw new PartialListing(events.value, [
        { prefix: TODO, error: (tasks as PromiseRejectedResult).reason },
      ]);
    throw new PartialListing((tasks as PromiseFulfilledResult<RemoteCalendar[]>).value, [
      { prefix: CALENDARS, error: events.reason },
    ]);
  }

  /** Events in a new Outlook calendar, tasks in a new To Do list (providers D275). */
  makeCalendar(calendar: NewCalendar): Promise<RemoteCalendar> {
    const part = calendar.component === "VTODO" ? this.tasks : this.events;
    if (!part.makeCalendar) throw new Error("This part of the account makes no calendars.");
    return part.makeCalendar(calendar);
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

/** A Microsoft account's provider. */
export function microsoftProvider(http: HttpClient, tokens: TokenSource): MicrosoftProvider {
  const graph = new Graph(http, tokens);
  return new MicrosoftProvider(new OutlookCalendars(graph), new MicrosoftTodo(graph));
}
