// The page's half of the desktop's credentials (docs/plans/desktop.md#D74):
// the user is asked only where no keyring would protect the password.
import { expect, test } from "vite-plus/test";

import type { Bridge, SecretSaving } from "../bridge.ts";
import { desktopSecrets } from "./secrets.ts";

function bridge(keyring: boolean) {
  const sets: SecretSaving[] = [];
  const secrets: Bridge["secrets"] = {
    get: async () => null,
    async set(_key, _value, saving) {
      sets.push(saving);
      return saving === "keyring" && !keyring ? "no-keyring" : "saved";
    },
    delete: async () => undefined,
  };
  return { secrets, sets };
}

test("with a keyring the password is saved there and nobody is asked", async () => {
  const { secrets, sets } = bridge(true);
  let asked = 0;
  await desktopSecrets(secrets, { ask: async () => (asked++, "unprotected") }).set("k", "v");
  expect(sets).toEqual(["keyring"]);
  expect(asked).toBe(0);
});

test("without one the user's choice decides how it is kept", async () => {
  for (const choice of ["until-quit", "unprotected"] as const) {
    const { secrets, sets } = bridge(false);
    await desktopSecrets(secrets, { ask: async () => choice }).set("k", "v");
    expect(sets).toEqual(["keyring", choice]);
  }
});
