// Where a new item's copies go when it goes to every account (design D314):
// only CalDAV accounts, and no account's own file.
import type { Account } from "@astrotime/storage";
import { expect, test } from "vite-plus/test";

import { accountsOnServers, goesToEveryCopy } from "../src/calendar/editing.ts";

const account = (
  id: string,
  name: string,
  serverUrl: string,
  provider: Account["provider"] = "caldav",
): Account => ({
  id,
  provider,
  name,
  serverUrl,
  username: "anna",
  createdAt: 0,
  homeUrl: null,
  syncOff: false,
});

test("copies go only to CalDAV accounts, with no account's own file (design D314)", () => {
  const accounts = [
    account("a", "a", "https://a.example/"),
    account("device", "On this device", "local:", "local"),
    account("demo", "Demo", "demo:", "demo"),
    account("holidays", "Holidays", "https://h.example/", "ics"),
  ];
  expect(accountsOnServers(accounts).map((one) => one.id)).toEqual(["a"]);
  expect([
    goesToEveryCopy({ uri: "https://example.com/agenda.pdf", type: "application/pdf" }),
    goesToEveryCopy({ content: "aGk=", name: "hi.txt" }),
    goesToEveryCopy({
      uri: "https://a.example/index.php/f/1",
      parameters: { "X-NC-FILE-ID": "1" },
    }),
    goesToEveryCopy({ uri: "/index.php/f/1" }),
  ]).toEqual([true, true, false, false]);
});
