// The shell's manners on Android (docs/plans/android.md#D65, D68): the back
// button, and the system bars following the theme the app shows. The native
// side is AstroTime's own plugin (`AstroTimeShell`, in
// android/app/src/main/java/io/github/astroreen/astrotime/shell/).

/** AstroTime's shell plugin. */
export interface NativeShell {
  /**
   * The system bars' icons light (`dark`) or dark, and `background` (`#rrggbb`)
   * behind the bars where the window draws them (a WebView before Chromium
   * 140, which Capacitor keeps clear of the bars).
   */
  setBars(options: { dark: boolean; background: string | null }): Promise<void>;
}

/** What the shell uses of `@capacitor/app`. */
export interface NativeApp {
  addListener(event: "backButton", listener: () => void): Promise<{ remove(): Promise<void> }>;
  minimizeApp(): Promise<void>;
}

/**
 * The back button, heard from the start, so it never does nothing: the UI's
 * function (`Platform.onBack`, the latest one handed) closes what is open;
 * when nothing was, or the UI has none (the store did not open), the app goes
 * to the background, as Android does for launcher apps.
 */
export function backButton(app: NativeApp): (close: () => boolean) => () => void {
  let latest: (() => boolean) | null = null;
  void app.addListener("backButton", () => {
    if (!latest?.()) void app.minimizeApp();
  });
  return (close) => {
    latest = close;
    return () => {
      if (latest === close) latest = null;
    };
  };
}

/**
 * Keeps the system bars on the theme the page shows: the setting's
 * (`data-theme` on the root, design D53), else the system's. Returns the
 * function that stops it.
 */
export function followTheme(shell: NativeShell): () => void {
  const system = matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const chosen = document.documentElement.dataset["theme"];
    void shell.setBars({
      dark: chosen ? chosen === "dark" : system.matches,
      background: hexOf(getComputedStyle(document.body).backgroundColor),
    });
  };
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  system.addEventListener("change", apply);
  apply();
  return () => {
    observer.disconnect();
    system.removeEventListener("change", apply);
  };
}

/** `rgb(27, 29, 35)` as `#1b1d23`; `null` for anything else (no colour yet, a transparent one). */
export function hexOf(color: string): string | null {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(color);
  if (!match) return null;
  return `#${match
    .slice(1)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}
