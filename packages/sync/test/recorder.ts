// The requests a client sends, recorded: how request budgets are measured
// (docs/plans/foundation.md#D126). Wraps any `HttpClient`, so the same
// recording works on Radicale, a fake Nextcloud or a memory server.
import type { HttpClient } from "@astrotime/caldav";

export interface Recorded {
  readonly method: string;
  /** The path, without the origin: the same on every run's port. */
  readonly path: string;
  readonly status: number | "offline";
}

export interface Recorder {
  readonly http: HttpClient;
  /** Every request since the last `take`, and starts a new list. */
  take(): Recorded[];
}

export function recording(http: HttpClient): Recorder {
  let log: Recorded[] = [];
  return {
    http: async (request) => {
      const path = new URL(request.url).pathname;
      try {
        const response = await http(request);
        log.push({ method: request.method, path, status: response.status });
        return response;
      } catch (error) {
        log.push({ method: request.method, path, status: "offline" });
        throw error;
      }
    },
    take() {
      const taken = log;
      log = [];
      return taken;
    },
  };
}
