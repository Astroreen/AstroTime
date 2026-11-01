// When the UI syncs (docs/plans/foundation.md#D91, D129): on start, when the
// app is back in front of the user, every few minutes while it is, after a
// local change, and when the network comes back. Every trigger calls
// `syncAll`, which joins a sync already running, so two never run at once;
// the automatic ones wait out a minute after the last sync, so several at
// once make one.
import type { AccountSync, SyncAllReport } from "@astrotime/sync";

/** A sync while the app is visible: often enough to see another device's change soon. */
export const SYNC_EVERY_MS = 5 * 60_000;
/**
 * An automatic trigger (coming back, the timer, the network) syncs only when the last sync started longer ago than this, or
 * found a server offline (D129).
 */
export const REFOCUS_GAP_MS = 60_000;
/** A burst of local changes is sent once, this long after the last of them. */
export const CHANGE_DEBOUNCE_MS = 2_000;

type Event = "visible" | "hidden" | "online" | "offline";

/** What the scheduler needs of the page; the browser's by default, a fake in tests. */
export interface SyncEnvironment {
  now(): number;
  visible(): boolean;
  online(): boolean;
  /** Calls `listener` on `event`; returns the function that stops it. */
  on(event: Event, listener: () => void): () => void;
  /** Calls `run` every `ms`; returns the function that stops it. */
  every(ms: number, run: () => void): () => void;
  /** Calls `run` once after `ms`; returns the function that cancels it. */
  after(ms: number, run: () => void): () => void;
}

export function browserEnvironment(): SyncEnvironment {
  return {
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
    online: () => navigator.onLine,
    on(event, listener) {
      if (event === "online" || event === "offline") {
        window.addEventListener(event, listener);
        return () => window.removeEventListener(event, listener);
      }
      // Another tab or another window in front and back again: the tab's
      // visibility, and the window's focus for a window beside others.
      const onVisibility = () => {
        if ((document.visibilityState === "visible") === (event === "visible")) listener();
      };
      document.addEventListener("visibilitychange", onVisibility);
      if (event === "visible") window.addEventListener("focus", listener);
      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        if (event === "visible") window.removeEventListener("focus", listener);
      };
    },
    every(ms, run) {
      const timer = setInterval(run, ms);
      return () => clearInterval(timer);
    },
    after(ms, run) {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  };
}

const AUTOMATIC: SyncRequest = { fresh: false, retry: false };

/** One account's latest sync, for the UI. */
export interface AccountStatus {
  readonly last: AccountSync;
  /** When it last synced without stopping; `null` if it never has here. */
  readonly syncedAt: number | null;
}

export interface SyncStatus {
  readonly running: boolean;
  /** The browser says there is no network at all. */
  readonly offline: boolean;
  readonly accounts: ReadonlyMap<string, AccountStatus>;
}

/**
 * How a sync is asked for (`syncAll`'s options): `fresh`, one that starts
 * after the call; `retry`, the user's own, which tries accounts a server
 * turned away too (D128).
 */
export interface SyncRequest {
  readonly fresh: boolean;
  readonly retry: boolean;
}

/** Runs the UI's syncs and says how they went. */
export class SyncScheduler {
  readonly #sync: (request: SyncRequest) => Promise<SyncAllReport>;
  readonly #environment: SyncEnvironment;
  readonly #listeners = new Set<() => void>();
  #status: SyncStatus;
  #running = 0;
  #lastStart = Number.NEGATIVE_INFINITY;
  /** The last sync that ended found an account's server offline. */
  #lastOffline = false;
  #cancelChange: (() => void) | null = null;
  /** The sync planned for when a busy server's hold ends (D128). */
  #cancelRetry: (() => void) | null = null;

  constructor(
    sync: (request: SyncRequest) => Promise<SyncAllReport>,
    environment: SyncEnvironment,
  ) {
    this.#sync = sync;
    this.#environment = environment;
    this.#status = { running: false, offline: !environment.online(), accounts: new Map() };
  }

  get status(): SyncStatus {
    return this.#status;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Syncs now and keeps syncing on the triggers; returns the function that stops them. */
  start(): () => void {
    this.#stopped = false;
    const env = this.#environment;
    let stopTimer: (() => void) | null = null;
    const startTimer = () => {
      stopTimer?.();
      stopTimer = env.every(SYNC_EVERY_MS, () => {
        if (env.visible() && env.online() && this.#due()) void this.#run(AUTOMATIC);
      });
    };
    const stops = [
      // The tab shown and the window focused come together: one sync.
      env.on("visible", () => {
        if (env.online() && this.#due()) void this.#run(AUTOMATIC);
        startTimer();
      }),
      // A hidden tab's timers are throttled anyway; the next visit syncs.
      env.on("hidden", () => {
        stopTimer?.();
        stopTimer = null;
      }),
      // Every tab hears the network come back; the one in front syncs, the
      // others on their next visit.
      env.on("online", () => {
        this.#update({ offline: false });
        if (env.visible() && this.#due()) void this.#run(AUTOMATIC);
      }),
      env.on("offline", () => this.#update({ offline: true })),
    ];
    void this.#run(AUTOMATIC);
    if (env.visible()) startTimer();
    return () => {
      for (const stop of stops) stop();
      stopTimer?.();
      this.#cancelChange?.();
      this.#cancelChange = null;
      this.#cancelRetry?.();
      this.#cancelRetry = null;
      this.#stopped = true;
    };
  }

  /**
   * "Sync now", and an account just added: the user's own, a sync that
   * starts after this call and tries every account (D128).
   */
  syncNow(): Promise<void> {
    return this.#run({ fresh: true, retry: true });
  }

  /**
   * A shell's own trigger, its timer or the machine's resume (desktop D75):
   * a sync that starts after it, but not the user's, so an account a server
   * turned away stays alone (D128).
   */
  requested(): Promise<void> {
    return this.#run({ fresh: true, retry: false });
  }

  /** Something changed on this device: it goes up shortly, in one sync per burst. */
  changed(): void {
    this.#cancelChange?.();
    this.#cancelChange = this.#environment.after(CHANGE_DEBOUNCE_MS, () => {
      this.#cancelChange = null;
      void this.#run({ fresh: true, retry: false });
    });
  }

  /**
   * Plans a sync for when a busy server's hold ends, a second after, so a
   * change made meanwhile goes up then without waiting for another trigger.
   */
  #retryAt(at: number | null): void {
    this.#cancelRetry?.();
    this.#cancelRetry = null;
    if (at === null || this.#stopped) return;
    const env = this.#environment;
    this.#cancelRetry = env.after(Math.max(0, at - env.now()) + 1_000, () => {
      this.#cancelRetry = null;
      // Offline then: the network's return syncs.
      if (env.online()) void this.#run(AUTOMATIC);
    });
  }

  #stopped = false;

  /** Whether an automatic trigger syncs: the last sync is a minute old, or found a server offline. */
  #due(): boolean {
    return this.#lastOffline || this.#environment.now() - this.#lastStart >= REFOCUS_GAP_MS;
  }

  async #run(request: SyncRequest): Promise<void> {
    this.#lastStart = this.#environment.now();
    this.#running++;
    this.#update({ running: true });
    try {
      const report = await this.#sync(request);
      this.#lastOffline = report.accounts.some((account) => account.status === "offline");
      this.#retryAt(report.retryAt);
      // Every account syncAll knows is in its report: one removed meanwhile drops out.
      const before = this.#status.accounts;
      const accounts = new Map<string, AccountStatus>();
      for (const last of report.accounts) {
        const syncedAt =
          last.status === "synced"
            ? report.finishedAt
            : (before.get(last.accountId)?.syncedAt ?? null);
        accounts.set(last.accountId, { last, syncedAt });
      }
      this.#update({ accounts });
    } catch (error) {
      // The store itself failed; the accounts keep what they last said.
      console.error(error);
    } finally {
      this.#running--;
      this.#update({ running: this.#running > 0 });
    }
  }

  #update(changes: Partial<SyncStatus>): void {
    this.#status = { ...this.#status, ...changes };
    for (const listener of this.#listeners) listener();
  }
}
