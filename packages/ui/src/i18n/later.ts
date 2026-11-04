// Strings of a part that loads later, in a catalog of their own that loads
// with it, not with the app (foundation D145): `pictures.ts`, `files.ts`.
// Their keys are part of the app's `Catalog` type (`index.ts`), so `t`
// checks them as it checks the others.
import type { i18n } from "i18next";

/** Adds `strings` to an i18next instance in every language, once per instance. */
export function laterStrings(
  strings: Record<"en" | "ru", Record<string, string>>,
): (instance: i18n) => void {
  const added = new WeakSet<i18n>();
  return (instance) => {
    if (added.has(instance)) return;
    added.add(instance);
    for (const [language, catalog] of Object.entries(strings))
      instance.addResources(language, "translation", catalog);
  };
}
