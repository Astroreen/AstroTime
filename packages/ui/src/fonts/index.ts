// The app's font (design D294): the system's, or one of seven AstroTime
// bundles, each with Cyrillic. A bundled one's files (`faces.ts`, a chunk of
// its own) are fetched only once it is chosen, never at the first load
// (foundation D145); its faces join `document.fonts` only once every file
// has come, so a font that cannot be fetched (offline, never kept) leaves
// the text as it was, and says so (`useFontFailure`), instead of drawing in
// a fallback silently. Kept in the settings (D96); applied by `app.tsx`.
import { useSyncExternalStore } from "react";

export const FONTS = [
  "system",
  "inter",
  "roboto",
  "noto-sans",
  "pt-sans",
  "nunito",
  "literata",
  "jetbrains-mono",
] as const;
export type Font = (typeof FONTS)[number];
export type BundledFont = Exclude<Font, "system">;

/** What draws what a font lacks: the system's (Tailwind's `--font-sans`), after a serif's or mono's own kind. */
const SANS = "var(--font-sans)";

/** Each font's family, its own name (never translated), and what draws what it lacks. */
export const FAMILIES: Readonly<Record<BundledFont, { name: string; fallback: string }>> = {
  inter: { name: "Inter", fallback: SANS },
  roboto: { name: "Roboto", fallback: SANS },
  "noto-sans": { name: "Noto Sans", fallback: SANS },
  "pt-sans": { name: "PT Sans", fallback: SANS },
  nunito: { name: "Nunito", fallback: SANS },
  literata: { name: "Literata", fallback: `ui-serif, Georgia, serif, ${SANS}` },
  "jetbrains-mono": { name: "JetBrains Mono", fallback: `ui-monospace, monospace, ${SANS}` },
};

/** The CSS `font-family` a bundled font is drawn with (`--font-chosen` in styles.css). */
export const familyOf = (font: BundledFont) =>
  `"${FAMILIES[font].name}", ${FAMILIES[font].fallback}`;

const loaded = new Map<BundledFont, Promise<void>>();

/**
 * Fetches every file of `font` (all four subsets, so it is all kept for
 * offline, and the language can change with no network) and adds its faces
 * to `document.fonts`. Rejects when one does not come; a later call asks
 * again, with new faces, since a face that failed stays failed.
 */
export function loadFont(font: BundledFont): Promise<void> {
  let loading = loaded.get(font);
  if (!loading) {
    loading = import("./faces.ts")
      .then(({ facesOf }) => {
        const faces = facesOf(font);
        return Promise.all(faces.map((face) => face.load()));
      })
      .then((faces) => {
        for (const face of faces) document.fonts.add(face);
        // A font that came is drawn now: an older failure says nothing more.
        failure.set(null);
      });
    loading.catch(() => {
      loaded.delete(font);
      failure.set(font);
    });
    loaded.set(font, loading);
  }
  return loading;
}

/** The font that last could not be fetched, until it or another comes. */
const failure = {
  font: null as BundledFont | null,
  listeners: new Set<() => void>(),
  set(font: BundledFont | null) {
    if (font === this.font) return;
    this.font = font;
    for (const listener of this.listeners) listener();
  },
};

const subscribe = (listener: () => void) => {
  failure.listeners.add(listener);
  return () => failure.listeners.delete(listener);
};

/** The bundled font that last could not be fetched, or `null`. */
export function useFontFailure(): BundledFont | null {
  return useSyncExternalStore(
    subscribe,
    () => failure.font,
    () => null,
  );
}
