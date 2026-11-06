// AstroTime's MCP endpoint over streamable HTTP (docs/plans/assistant.md#D308),
// as a `(Request) => Promise<Response>` like the proxy's and the server's:
// the desktop's main process serves it on 127.0.0.1, and AstroTime's server
// may later (D309). Who may call is checked before the MCP SDK sees the
// request: a Host of this machine alone (DNS rebinding), no Origin (a page
// in a browser), and the bearer token, compared in constant time. The tools
// themselves run where the store is (`call`): the window's, on the desktop.
import { createMcpHandler, McpServer, type CallToolResult } from "@modelcontextprotocol/server";

import { TOOLS, type ToolName } from "./tools.ts";

/** Where the endpoint answers. */
export const MCP_PATH = "/mcp";

/** A tool's answer from where it ran: the item, or a refusal in words for the assistant. */
export type ToolAnswer = { readonly ok: unknown } | { readonly refused: string };

export interface EndpointOptions {
  /** The port it listens on: a Host must name it. */
  readonly port: () => number;
  /** The token a call must carry; `null` refuses every call. */
  readonly token: () => string | null;
  /**
   * Runs a tool, its input checked by the SDK against the tool's schema.
   * `signal` aborts when the client goes before the answer: a call waiting
   * elsewhere (the desktop's window) is let go then.
   */
  readonly call: (name: ToolName, args: unknown, signal: AbortSignal) => Promise<ToolAnswer>;
  readonly version?: string;
}

const INSTRUCTIONS =
  "AstroTime holds the user's calendars and task lists. Find an item's id with list_items, search_items or a create, then get, change, complete or delete it by that id. Times are days (YYYY-MM-DD) or wall-clock times (YYYY-MM-DDTHH:MM) in the user's zone unless a timeZone is given. Every change is logged in AstroTime, where the user can undo it.";

const refusal = (status: number, message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

const encoder = new TextEncoder();

/** Whether `given` is `expected`, in a time that depends on `expected`'s length alone. */
export function sameToken(given: string, expected: string): boolean {
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  let differs = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) differs |= (a[i] ?? 0) ^ b[i]!;
  return differs === 0;
}

/** A tool's answer as MCP's result: the item as JSON, in text and structured. */
function resultOf(answer: ToolAnswer): CallToolResult {
  if ("refused" in answer)
    return { isError: true, content: [{ type: "text", text: answer.refused }] };
  const structured = (answer.ok ?? {}) as Record<string, unknown>;
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

/**
 * The endpoint: every request checked, then served by the MCP SDK, one
 * server per request. `refusal` checks a request's caller from its headers
 * alone, so a server can refuse it before reading its body.
 */
export function mcpEndpoint(options: EndpointOptions): ((request: Request) => Promise<Response>) & {
  refusal(headers: Headers, url: string): Response | null;
} {
  const handler = createMcpHandler(({ requestInfo }) => {
    // One server per request: its calls end with it.
    const signal = requestInfo?.signal ?? new AbortController().signal;
    const server = new McpServer(
      { name: "astrotime", title: "AstroTime", version: options.version ?? "0.0.0" },
      { instructions: INSTRUCTIONS },
    );
    for (const [name, tool] of Object.entries(TOOLS) as [ToolName, (typeof TOOLS)[ToolName]][]) {
      server.registerTool(
        name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.input,
          annotations: { title: tool.title, ...tool.annotations },
        },
        async (args: unknown) => resultOf(await options.call(name, args, signal)),
      );
    }
    return server;
  });

  const check = (headers: Headers, url: string): Response | null => {
    // A page in a browser calling this machine; an MCP client sends none.
    if (headers.has("origin")) return refusal(403, "No requests from a web page.");
    // A name that only resolves here (DNS rebinding) is not this machine's.
    const port = options.port();
    const host = headers.get("host")?.toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      return refusal(403, "Not this machine's address.");
    }
    if (new URL(url).pathname !== MCP_PATH) return refusal(404, "Not found.");
    const token = options.token();
    const given = /^Bearer (.+)$/i.exec(headers.get("authorization") ?? "")?.[1];
    if (token === null || given === undefined || !sameToken(given, token)) {
      return refusal(401, "A valid token is required.", { "WWW-Authenticate": "Bearer" });
    }
    return null;
  };
  return Object.assign(
    (request: Request) =>
      Promise.resolve(check(request.headers, request.url) ?? handler.fetch(request)),
    { refusal: check },
  );
}
