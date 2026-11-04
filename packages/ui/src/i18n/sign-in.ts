// The sign-in dialog's strings that load with it (providers D255), in a
// catalog of their own (`later.ts`): an address whose password would cross
// the network unencrypted (providers D260).
import { laterStrings } from "./later.ts";

export const signInStrings = {
  en: {
    "signIn.inClear":
      "This address is not encrypted: your password could be read on the way. Use https:// if the server offers it.",
  },
  ru: {
    "signIn.inClear":
      "Этот адрес не зашифрован: пароль могут перехватить по дороге. Используйте https://, если сервер его поддерживает.",
  },
} as const satisfies Record<"en" | "ru", Record<string, string>>;

/** Adds the strings to an i18next instance in every language, once. */
export const addSignInStrings = laterStrings(signInStrings);
