// The accounts as the dialogs name them (design D313): a twin's name says
// its server, and its path too when the two share a host.
import type { Account } from "@astrotime/storage";
import { expect, test } from "vite-plus/test";

import { accountLabels } from "../src/components/account-labels.ts";

const account = (id: string, name: string, serverUrl: string): Account => ({
  id,
  provider: "caldav",
  name,
  serverUrl,
  username: "anna",
  createdAt: 0,
  homeUrl: null,
  syncOff: false,
});

test("a name alone, a twin's with its server, and its path when the host is shared", () => {
  const labels = accountLabels(
    [
      account("a", "anna@example.org", "https://a.example/"),
      account("b", "anna@example.org", "https://b.example/"),
      account("c", "solo@example.org", "https://a.example/"),
      account("d", "same@example.org", "https://cloud.example/personal/"),
      account("e", "same@example.org", "https://cloud.example/work/"),
    ],
    (one) => one.name,
  );
  expect([...labels.values()]).toEqual([
    "anna@example.org (a.example)",
    "anna@example.org (b.example)",
    "solo@example.org",
    "same@example.org (cloud.example/personal)",
    "same@example.org (cloud.example/work)",
  ]);
});
