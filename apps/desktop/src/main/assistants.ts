// AstroTime's MCP endpoint on the desktop (docs/plans/assistant.md#D308): the
// main process listens on 127.0.0.1 alone, while Settings → Assistants has
// it on (off by default), and only listens: each tool call goes over IPC to
// the window, which runs it against its own store, as a click there would
// (desktop D73), and its answer comes back. With no page serving, a call is
// answered that AstroTime must be open. The token is 32 random bytes, kept
// with the credentials (`secrets.ts`, D74); a new one replaces it at once.
// Apart from Electron, so it is tested in Node.
import { randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { mcpEndpoint, MCP_PATH, type ToolAnswer } from "@astrotime/mcp/http";

import type { AssistantsState } from "../bridge.ts";
import type { Secrets } from "./secrets.ts";

/** Where the token is kept among the credentials. */
export const TOKEN_KEY = "assistants:token";

/** The most a request may carry: a file's content (about 1 MiB in base64) and its call around it. */
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

/** What a call is answered with while no window serves it. */
export const NOT_OPEN =
  "AstroTime must be open for an assistant to reach the calendars: open its window.";

/** `assistants.json`: whether the endpoint is on, and the port configurations name. */
interface Settings {
  readonly enabled: boolean;
  readonly port: number | null;
}

/** The page's end of a call: sends it and hears its answer. */
interface Page {
  /** Sends a call to the page that serves; false when none does. */
  send(id: string, name: string, args: unknown): boolean;
}

export interface AssistantsOptions {
  /** `assistants.json` in userData. */
  readonly path: string;
  readonly secrets: Secrets;
  readonly page: Page;
  readonly version?: string;
}

/** A new token: 32 random bytes, base64url. */
const newToken = () => randomBytes(32).toString("base64url");

/** The request as the web's, its body read up to the cap; `null` when it is over. */
async function toRequest(req: IncomingMessage, port: number): Promise<Request | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_REQUEST_BYTES) return null;
    chunks.push(chunk as Buffer);
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && chunks.length > 0;
  return new Request(`http://127.0.0.1:${port}${req.url ?? "/"}`, {
    method: req.method ?? "GET",
    headers,
    ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
  });
}

export function assistants(options: AssistantsOptions) {
  const { path, secrets, page } = options;
  let settings: Settings = { enabled: false, port: null };
  let token: string | null = null;
  let server: Server | null = null;
  let port = 0;
  /** Why the endpoint could not listen, for the setting to say. */
  let failure: string | null = null;
  const calls = new Map<string, (answer: ToolAnswer) => void>();

  async function readSettings(): Promise<Settings> {
    try {
      const read = JSON.parse(await readFile(path, "utf8")) as Partial<Settings>;
      return {
        enabled: read.enabled === true,
        port: Number.isInteger(read.port) ? (read.port as number) : null,
      };
    } catch {
      return { enabled: false, port: null };
    }
  }

  async function writeSettings(next: Settings) {
    settings = next;
    const temporary = `${path}.next`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  }

  /** The token kept, or a new one kept now; under the keyring where there is one. */
  async function tokenNow(fresh = false): Promise<string> {
    const kept = fresh ? null : await secrets.get(TOKEN_KEY);
    if (kept) return kept;
    const made = newToken();
    // With no keyring it is kept as the profile keeps the store itself:
    // whoever reads the profile reads the calendars already (D308).
    if ((await secrets.set(TOKEN_KEY, made, "keyring")) === "no-keyring") {
      await secrets.set(TOKEN_KEY, made, "unprotected");
    }
    return made;
  }

  const handle = mcpEndpoint({
    port: () => port,
    token: () => token,
    ...(options.version ? { version: options.version } : {}),
    call(name, args) {
      const id = crypto.randomUUID();
      return new Promise<ToolAnswer>((resolve) => {
        calls.set(id, resolve);
        if (!page.send(id, name, args)) answer(id, { refused: NOT_OPEN });
      });
    },
  });

  /** Listens on the port configurations name, or on a free one when it is taken. */
  async function listen(): Promise<void> {
    const http = createServer((req, res) => {
      void (async () => {
        const request = await toRequest(req, port);
        if (!request) {
          res.writeHead(413, { Connection: "close" }).end();
          return;
        }
        const response = await handle(request);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        // A stream (an answer as events) is written as it comes.
        if (response.body) for await (const chunk of response.body) res.write(chunk);
        res.end();
      })().catch((error: unknown) => {
        console.error("The MCP endpoint failed a request:", error);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    const bind = (at: number) =>
      new Promise<void>((resolve, reject) => {
        http.once("error", reject);
        http.listen(at, "127.0.0.1", () => {
          http.off("error", reject);
          resolve();
        });
      });
    try {
      await bind(settings.port ?? 0);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE" || settings.port === null)
        throw error;
      await bind(0);
    }
    server = http;
    port = (http.address() as AddressInfo).port;
    if (port !== settings.port) await writeSettings({ ...settings, port });
  }

  async function stop(): Promise<void> {
    const http = server;
    server = null;
    if (!http) return;
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  }

  async function apply(): Promise<void> {
    failure = null;
    if (!settings.enabled) {
      await stop();
      token = null;
      return;
    }
    token = await tokenNow();
    if (server) return;
    try {
      await listen();
    } catch (error) {
      failure = (error as Error).message;
      console.error("The MCP endpoint could not listen:", error);
    }
  }

  function state(): AssistantsState {
    return {
      enabled: settings.enabled,
      url: settings.enabled && server ? `http://127.0.0.1:${port}${MCP_PATH}` : null,
      token: settings.enabled ? token : null,
      ...(failure ? { error: failure } : {}),
    };
  }

  /** Resolves a call with the page's answer; a stray or repeated one is nothing. */
  function answer(id: string, value: ToolAnswer) {
    const resolve = calls.get(id);
    if (!resolve) return;
    calls.delete(id);
    resolve(value);
  }

  // One change at a time: a quick on and off never interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const done = queue.then(work);
    queue = done.catch(() => undefined);
    return done;
  };

  return {
    /** Reads the setting and listens when it is on: at the app's start. */
    start: () =>
      serial(async () => {
        settings = await readSettings();
        await apply();
      }),
    state: () => serial(async () => state()),
    setEnabled: (enabled: boolean) =>
      serial(async () => {
        await writeSettings({ ...settings, enabled });
        await apply();
        return state();
      }),
    /** Replaces the token: the old one is refused from now on. */
    newToken: () =>
      serial(async () => {
        if (settings.enabled) token = await tokenNow(true);
        return state();
      }),
    answer,
    /** The page that served went (a reload, its process gone): its calls are answered so. */
    pageGone() {
      for (const id of calls.keys()) answer(id, { refused: NOT_OPEN });
    },
    close: () => serial(stop),
  };
}
