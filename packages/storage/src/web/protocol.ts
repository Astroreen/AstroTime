/** Messages between `webDriver` and the store's worker. */
export type Request =
  | { readonly id: number; readonly type: "open"; readonly name: string }
  | {
      readonly id: number;
      readonly type: "query";
      readonly sql: string;
      readonly params: readonly unknown[];
    }
  | { readonly id: number; readonly type: "script"; readonly sql: string }
  | { readonly id: number; readonly type: "close" };

export type Response =
  | { readonly id: number; readonly ok: true; readonly rows?: unknown[][] }
  | { readonly id: number; readonly ok: false; readonly error: string };
