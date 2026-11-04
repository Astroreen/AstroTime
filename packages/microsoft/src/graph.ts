// Microsoft Graph as the providers ask it (docs/plans/providers.md#D253): JSON
// with the account's bearer token, renewed once when refused (`send`), every
// time in UTC and every body as text (`Prefer`), pages followed by their
// `@odata.nextLink`, writes against the item's `@odata.etag` (`If-Match`).
import { Authorization, send, type HttpClient, type TokenSource } from "@astrotime/caldav";

export const GRAPH = "https://graph.microsoft.com/v1.0/";

export class Graph {
  private readonly http: HttpClient;
  private readonly authorization: Authorization;

  constructor(http: HttpClient, tokens: TokenSource) {
    this.http = http;
    this.authorization = new Authorization(tokens);
  }

  async json<T>(
    method: string,
    url: string,
    options: {
      readonly body?: unknown;
      readonly etag?: string | null;
      readonly accept?: readonly number[];
    } = {},
  ): Promise<{ readonly status: number; readonly value: T | null }> {
    const response = await send(
      this.http,
      this.authorization,
      {
        method,
        url,
        headers: {
          Accept: "application/json",
          Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"',
          ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(options.etag ? { "If-Match": options.etag } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      },
      options.accept ?? [],
    );
    return {
      status: response.status,
      value: response.body ? (JSON.parse(response.body) as T) : null,
    };
  }

  /** Every item of a collection, page after page. */
  async all<T>(url: string): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = url;
    while (next) {
      const page: { value?: T[]; "@odata.nextLink"?: string } | null = (
        await this.json<{ value?: T[]; "@odata.nextLink"?: string }>("GET", next)
      ).value;
      items.push(...(page?.value ?? []));
      next = page?.["@odata.nextLink"];
    }
    return items;
  }
}

/** Graph's `{ dateTime, timeZone }`, which `Prefer` asks in UTC. */
export interface GraphTime {
  readonly dateTime: string;
  readonly timeZone: string;
}

/** A Graph time as RFC 3339 UTC (`…Z`), read as UTC whatever its zone says when `Prefer` was heeded. */
export const utcOf = (time: GraphTime): string =>
  `${time.dateTime.replace(/\.\d+$/, "").replace(/Z$/, "")}Z`;
