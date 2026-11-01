// The store over a MessagePort (docs/plans/desktop.md#D73), as the desktop's
// page reaches its store's process: here Node's MessageChannel stands in for
// Electron's, and `node:sqlite` serves both ends in one process.
import { expect, test } from "vite-plus/test";

import { Store } from "../src/index.ts";
import { nodeConnection } from "../src/node.ts";
import { portDriver, portServer, type Request } from "../src/port.ts";
import { storeContract } from "./store.contract.ts";

/** A store's process on a fresh in-memory database; `connect` opens a page's port to it. */
function process() {
  const lost: Error[] = [];
  const server = portServer(nodeConnection(), { lost: (error) => lost.push(error) });
  const connect = () => {
    const { port1, port2 } = new MessageChannel();
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a MessagePort's postMessage takes no origin
    const page = server.connect((reply) => port2.postMessage(reply));
    port2.addEventListener("message", (event: MessageEvent<Request>) => page.receive(event.data));
    port2.start();
    return { driver: portDriver(port1), page, port: port2 };
  };
  return { connect, lost };
}

storeContract("node:sqlite over a MessagePort", () => process().connect().driver);

const account = (name: string) => ({
  provider: "caldav" as const,
  name,
  serverUrl: "https://dav.example/",
  username: null,
});

test("a page gone mid-transaction leaves nothing of it, and the next page goes on", async () => {
  const { connect, lost } = process();
  const first = connect();
  const store = await Store.open(first.driver);
  await store.addAccount(account("Kept"));
  await first.driver.script("BEGIN IMMEDIATE;");
  await first.driver.query("DELETE FROM accounts", []);

  // The page reloads: its port goes, a new page connects.
  first.page.gone();
  const second = await Store.open(connect().driver);
  expect((await second.accounts()).map((a) => a.name)).toEqual(["Kept"]);
  expect(lost).toEqual([]);
});

test("a port that closes fails what was on its way and every statement after", async () => {
  const { connect } = process();
  const { driver, port } = connect();
  await driver.query("SELECT 1", []);
  port.close();
  await expect(driver.query("SELECT 1", [])).rejects.toThrow(/went/);
  await expect(driver.script("SELECT 1;")).rejects.toThrow(/went/);
});
