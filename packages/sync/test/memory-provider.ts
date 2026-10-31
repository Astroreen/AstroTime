// A provider over an in-memory server, for the engine's paths a real server
// will not take on demand: lost answers, failures of one object, outages.
import {
  OfflineError,
  type Provider,
  type RemoteCalendar,
  type RemoteObject,
  type WriteResult,
} from "@astrotime/core";

export interface MemoryServer extends Provider {
  readonly objects: Map<string, { etag: string; ics: string }>;
  calendarList: RemoteCalendar[];
  /** Called before every write; throw to fail it, or return a result to answer with. */
  beforeWrite: (method: "create" | "update" | "remove", href: string) => WriteResult | void;
  offline: boolean;
  /** Off: writes answer without an ETag, as some servers do when they change what they store. */
  etagsOnWrite: boolean;
}

export function memoryServer(calendarUrl = "https://dav.example/cal/"): MemoryServer {
  let version = 0;
  const etag = () => `"${++version}"`;
  const server: MemoryServer = {
    objects: new Map(),
    calendarList: [
      {
        url: calendarUrl,
        name: "Cal",
        color: null,
        components: ["VEVENT", "VTODO"],
        readOnly: false,
      },
    ],
    beforeWrite: () => {},
    offline: false,
    etagsOnWrite: true,
    async calendars() {
      if (server.offline) throw new OfflineError("offline");
      return server.calendarList;
    },
    async changes(_url, _state, known) {
      if (server.offline) throw new OfflineError("offline");
      const changed: RemoteObject[] = [];
      for (const [href, object] of server.objects) {
        if (known.get(href) !== object.etag) changed.push({ href, ...object });
      }
      const removed = [...known.keys()].filter((href) => !server.objects.has(href));
      return { changed, removed, syncToken: `t${version}`, ctag: null };
    },
    async fetch(href) {
      if (server.offline) throw new OfflineError("offline");
      const object = server.objects.get(href);
      return object ? { href, ...object } : null;
    },
    async create(href, ics) {
      if (server.offline) throw new OfflineError("offline");
      const answer = server.beforeWrite("create", href);
      if (answer) return answer;
      if (server.objects.has(href)) return { ok: false, reason: "conflict" };
      const object = { etag: etag(), ics };
      server.objects.set(href, object);
      return { ok: true, href, etag: server.etagsOnWrite ? object.etag : null };
    },
    async update(href, ics, expected) {
      if (server.offline) throw new OfflineError("offline");
      const answer = server.beforeWrite("update", href);
      if (answer) return answer;
      const current = server.objects.get(href);
      // No If-Match (a null ETag) overwrites whatever is there.
      if (!current || (expected !== null && current.etag !== expected))
        return { ok: false, reason: "conflict" };
      const object = { etag: etag(), ics };
      server.objects.set(href, object);
      return { ok: true, href, etag: server.etagsOnWrite ? object.etag : null };
    },
    async remove(href, expected) {
      if (server.offline) throw new OfflineError("offline");
      const answer = server.beforeWrite("remove", href);
      if (answer) return answer;
      const current = server.objects.get(href);
      if (current && current.etag !== expected) return { ok: false, reason: "conflict" };
      server.objects.delete(href);
      return { ok: true, href, etag: null };
    },
  };
  return server;
}
