// A ready configuration for each assistant (docs/plans/assistant.md#D310),
// in the form its own documentation gives for a streamable HTTP server with
// a bearer token, as of 2026-11. Where a client keeps it is said beside it.
// Claude Desktop's file takes only local (stdio) servers, and its custom
// connectors are reached from Anthropic's cloud, never from this machine:
// it goes through `mcp-remote`, as modelcontextprotocol.io describes.

export const CLIENTS = [
  "claude-desktop",
  "claude-code",
  "cursor",
  "vscode",
  "codex",
  "gemini",
  "lm-studio",
  "json",
] as const;

export type Client = (typeof CLIENTS)[number];

/** The server's name in each configuration. */
const NAME = "astrotime";

export interface ClientConfig {
  /** What to copy: a file's part, or a command. */
  readonly text: string;
  /** Where it goes: a file's path, or how the client opens it; `null` for a command. */
  readonly where: string | null;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** The configuration of `client` for the endpoint at `url` with `token`. */
export function configFor(client: Client, url: string, token: string): ClientConfig {
  const bearer = `Bearer ${token}`;
  const headers = { Authorization: bearer };
  switch (client) {
    case "claude-desktop":
      // The space of "Bearer …" lives in the environment: some clients split arguments on it.
      return {
        text: json({
          mcpServers: {
            [NAME]: {
              command: "npx",
              args: ["-y", "mcp-remote", url, "--header", "Authorization:${AUTH_HEADER}"],
              env: { AUTH_HEADER: bearer },
            },
          },
        }),
        where: "~/.config/Claude/claude_desktop_config.json",
      };
    case "claude-code":
      return {
        text: `claude mcp add --transport http --scope user ${NAME} ${url} --header "Authorization: ${bearer}"`,
        where: null,
      };
    case "cursor":
      return {
        text: json({ mcpServers: { [NAME]: { url, headers } } }),
        where: "~/.cursor/mcp.json",
      };
    case "vscode":
      return {
        text: json({ servers: { [NAME]: { type: "http", url, headers } } }),
        where: "MCP: Open User Configuration",
      };
    case "codex":
      return {
        text: `[mcp_servers.${NAME}]\nurl = "${url}"\nhttp_headers = { "Authorization" = "${bearer}" }\n`,
        where: "~/.codex/config.toml",
      };
    case "gemini":
      return {
        text: json({ mcpServers: { [NAME]: { httpUrl: url, headers } } }),
        where: "~/.gemini/settings.json",
      };
    case "lm-studio":
      return { text: json({ mcpServers: { [NAME]: { url, headers } } }), where: "mcp.json" };
    case "json":
      return {
        text: json({ mcpServers: { [NAME]: { type: "http", url, headers } } }),
        where: null,
      };
  }
}
