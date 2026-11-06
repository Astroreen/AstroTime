// The window's end of the MCP endpoint (docs/plans/assistant.md#D308): each
// call the shell hands over runs here, against this page's store, as a
// click would. The calendar shows the change at once (the store tells its
// views), and a change starts a sync as the user's own do. The tools load
// with the first call, never with the page (foundation D145).
import type { Store } from "@astrotime/storage";

import type { AssistantAnswer, Assistants } from "../platform.ts";

export function serveAssistants(
  assistants: Assistants,
  options: { readonly store: Store; readonly timeZone: string; readonly onChanged: () => void },
): () => void {
  let loading: Promise<typeof import("@astrotime/mcp")> | undefined;
  let tools: ReturnType<(typeof import("@astrotime/mcp"))["assistantTools"]> | undefined;
  return assistants.serve(async (name, args): Promise<AssistantAnswer> => {
    const mcp = await (loading ??= import("@astrotime/mcp"));
    tools ??= mcp.assistantTools({ store: options.store, timeZone: options.timeZone });
    try {
      const ok = await tools.call(name, args);
      if (mcp.isToolName(name) && !mcp.TOOLS[name].annotations.readOnlyHint) options.onChanged();
      return { ok };
    } catch (error) {
      if (error instanceof mcp.ToolError) return { refused: error.message };
      console.error(`The assistant's ${name} failed:`, error);
      return { refused: `AstroTime could not do that: ${(error as Error).message}` };
    }
  });
}
