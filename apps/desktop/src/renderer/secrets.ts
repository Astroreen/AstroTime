import type { SecretStore } from "@astrotime/core";
import type { UnprotectedPrompt } from "@astrotime/ui";

import type { Bridge } from "../bridge.ts";

/**
 * Credentials through the main process (docs/plans/desktop.md#D74): in the
 * keyring's care where there is one; where there is none, nothing is written
 * until the user chooses, through `prompt`, how to keep the password.
 */
export function desktopSecrets(
  secrets: Bridge["secrets"],
  prompt: Pick<UnprotectedPrompt, "ask">,
): SecretStore {
  return {
    get: (key) => secrets.get(key),
    async set(key, value) {
      if ((await secrets.set(key, value, "keyring")) === "saved") return;
      await secrets.set(key, value, await prompt.ask());
    },
    delete: (key) => secrets.delete(key),
  };
}
