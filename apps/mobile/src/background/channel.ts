// The headless WebView's way to native (docs/plans/android.md#D67): no
// Capacitor bridge, but the one object `SyncWorker` injects with
// `WebViewCompat.addWebMessageListener`, for this origin only. A call is a
// JSON message with an id; native answers it with the same id.

/** The injected object, as the WebView gives it to the page. */
export interface NativePort {
  postMessage(message: string): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/** A call native refused: its code, as the plugins' rejections carry one (`offline`, `cleartext`). */
export class NativeError extends Error {
  readonly code: string;
  readonly data: unknown;

  constructor(message: string, code: string, data: unknown) {
    super(message);
    this.name = "NativeError";
    this.code = code;
    this.data = data;
  }
}

export interface Channel {
  /** Calls a handler of native's and waits for its answer. */
  call<T>(method: string, params: unknown): Promise<T>;
  /** Tells native something that has no answer (the run is over). */
  tell(method: string, params: unknown): void;
}

type Answer =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | {
      readonly id: number;
      readonly ok: false;
      readonly code: string;
      readonly message: string;
      readonly data?: unknown;
    };

export function channel(port: NativePort): Channel {
  let next = 0;
  const waiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  port.addEventListener("message", ({ data }) => {
    if (typeof data !== "string") return;
    let answer: Answer;
    try {
      answer = JSON.parse(data) as Answer;
    } catch {
      return;
    }
    const call = waiting.get(answer.id);
    if (!call) return;
    waiting.delete(answer.id);
    if (answer.ok) call.resolve(answer.value);
    else call.reject(new NativeError(answer.message, answer.code, answer.data));
  });
  return {
    call<T>(method: string, params: unknown) {
      const id = ++next;
      return new Promise<T>((resolve, reject) => {
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
        port.postMessage(JSON.stringify({ id, method, params }));
      });
    },
    tell(method, params) {
      port.postMessage(JSON.stringify({ method, params }));
    },
  };
}
