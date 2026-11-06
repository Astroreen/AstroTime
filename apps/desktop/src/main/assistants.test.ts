// The desktop's MCP endpoint (docs/plans/assistant.md#D308) in Node: off by
// default, on 127.0.0.1 alone with a token kept with the credentials, each
// call handed to the page and answered from it, refused with no page, and
// the old token refused after "New token". The SDK's own client calls it.
import { mkdtempSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolAnswer } from "@astrotime/mcp/http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { expect, test } from "vite-plus/test";

import type { SecretSaving } from "../bridge.ts";
import { assistants, NOT_OPEN, TOKEN_KEY } from "./assistants.ts";
import type { Secrets } from "./secrets.ts";

/** Credentials in memory; `keyring: false` answers as a desktop with none does. */
function memorySecrets(keyring = true): Secrets & { saved: Map<string, SecretSaving> } {
  const values = new Map<string, string>();
  const saved = new Map<string, SecretSaving>();
  return {
    saved,
    get: async (key) => values.get(key) ?? null,
    async set(key, value, saving) {
      if (saving === "keyring" && !keyring) return "no-keyring";
      values.set(key, value);
      saved.set(key, saving);
      return "saved";
    },
    delete: async (key) => void values.delete(key),
  };
}

interface Call {
  readonly id: string;
  readonly name: string;
  readonly args: unknown;
}

/** A page that serves, or not; `next` resolves with the next call it is sent. */
function fakePage() {
  const calls: Call[] = [];
  let heard: ((call: Call) => void) | undefined;
  let withdrawn: ((id: string) => void) | undefined;
  return {
    calls,
    serving: true,
    /** Resolves with the next call the endpoint lets go of. */
    nextWithdrawn: () => new Promise<string>((resolve) => (withdrawn = resolve)),
    withdraw: (id: string) => withdrawn?.(id),
    next: () => new Promise<Call>((resolve) => (heard = resolve)),
    send(id: string, name: string, args: unknown) {
      if (!this.serving) return false;
      calls.push({ id, name, args });
      heard?.({ id, name, args });
      return true;
    },
  };
}

function setUp(options: { keyring?: boolean; path?: string } = {}) {
  const path =
    options.path ?? join(mkdtempSync(join(tmpdir(), "astrotime-assistants-")), "assistants.json");
  const secrets = memorySecrets(options.keyring);
  const page = fakePage();
  const endpoint = assistants({ path, secrets, page });
  return { path, secrets, page, endpoint };
}

async function connect(url: string, token: string) {
  const client = new Client({ name: "astrotime-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

/** Whether anything answers on the port. */
const listening = (port: number) =>
  new Promise<boolean>((resolve) => {
    const sent = request({ host: "127.0.0.1", port, path: "/mcp" }, (res) => {
      res.resume();
      resolve(true);
    });
    sent.on("error", () => resolve(false));
    sent.end();
  });

test("off by default; on, it listens on 127.0.0.1 with a 32-byte token, kept, on the same port after a restart", async () => {
  const { path, secrets, endpoint } = setUp();
  await endpoint.start();
  expect(await endpoint.state()).toEqual({ enabled: false, url: null, token: null });

  const on = await endpoint.setEnabled(true);
  expect(on.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  expect(Buffer.from(on.token!, "base64url")).toHaveLength(32);
  expect(await secrets.get(TOKEN_KEY)).toBe(on.token);
  expect(secrets.saved.get(TOKEN_KEY)).toBe("keyring");
  const port = Number(new URL(on.url!).port);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ enabled: true, port });
  await endpoint.close();

  // The next start: on again, at the same address with the same token.
  const again = assistants({ path, secrets, page: fakePage() });
  await again.start();
  expect(await again.state()).toEqual(on);
  expect(await listening(port)).toBe(true);
  await again.setEnabled(false);
  expect(await listening(port)).toBe(false);
  expect(await again.state()).toEqual({ enabled: false, url: null, token: null });
});

test("with no keyring the token is kept as the profile keeps the store", async () => {
  const { secrets, endpoint } = setUp({ keyring: false });
  const { token } = await endpoint.setEnabled(true);
  expect(secrets.saved.get(TOKEN_KEY)).toBe("unprotected");
  expect(await secrets.get(TOKEN_KEY)).toBe(token);
  await endpoint.close();
});

test("a call goes to the page and its answer comes back; with no page, or the page gone mid-call, AstroTime must be open", async () => {
  const { page, endpoint } = setUp();
  const { url, token } = await endpoint.setEnabled(true);
  const client = await connect(url!, token!);

  const sent = page.next();
  const asked = client.callTool({ name: "get_item", arguments: { id: "abc" } });
  const call = await sent;
  expect(call).toMatchObject({ name: "get_item", args: { id: "abc" } });
  endpoint.answer(call.id, { ok: { id: "abc", summary: "Lunch" } } satisfies ToolAnswer);
  expect(await asked).toMatchObject({ structuredContent: { id: "abc", summary: "Lunch" } });

  // Its input is checked before the page sees it.
  expect(await client.callTool({ name: "get_item", arguments: {} })).toMatchObject({
    isError: true,
  });
  expect(page.calls).toHaveLength(1);

  // The page went in the middle of a call (a reload): it is answered at once.
  const second = page.next();
  const pending = client.callTool({ name: "list_calendars", arguments: {} });
  await second;
  endpoint.pageGone();
  expect(await pending).toEqual({ isError: true, content: [{ type: "text", text: NOT_OPEN }] });

  page.serving = false;
  expect(await client.callTool({ name: "list_calendars", arguments: {} })).toEqual({
    isError: true,
    content: [{ type: "text", text: NOT_OPEN }],
  });
  await client.close();
  await endpoint.close();
});

test("New token refuses the old one at once, and the new one is kept", async () => {
  const { secrets, endpoint, page } = setUp();
  page.serving = false;
  const { url, token: old } = await endpoint.setEnabled(true);
  const client = await connect(url!, old!);
  const { token } = await endpoint.newToken();
  expect(token).not.toBe(old);
  expect(await secrets.get(TOKEN_KEY)).toBe(token);
  await expect(client.listTools()).rejects.toThrow();
  await expect(connect(url!, old!)).rejects.toThrow();
  await (await connect(url!, token!)).close();
  await endpoint.close();
});

test("a call whose client goes before the answer is let go, not held for ever", async () => {
  const { page, endpoint } = setUp();
  const { url, token } = await endpoint.setEnabled(true);
  const sent = page.next();
  const withdrawn = page.nextWithdrawn();
  // A client that sends its call and is gone (killed, its connection closed).
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "list_calendars", arguments: {} },
  });
  const asked = request(url!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2025-06-18",
    },
  });
  asked.on("error", () => {});
  asked.end(body);
  const call = await sent;
  asked.destroy();
  expect(await withdrawn).toBe(call.id);
  await endpoint.close();
});

test("a caller without the token is refused before its body is read", async () => {
  const { endpoint, page } = setUp();
  const { url } = await endpoint.setEnabled(true);
  // A body it never finishes: the refusal comes from the headers alone.
  const status = await new Promise<number>((resolve, reject) => {
    const sent = request(url!, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": 4 * 1024 * 1024 },
    });
    sent.on("response", (res) => {
      res.resume();
      resolve(res.statusCode!);
      sent.destroy();
    });
    sent.on("error", reject);
    sent.write("{");
  });
  expect(status).toBe(401);
  expect(page.calls).toHaveLength(0);
  await endpoint.close();
});
