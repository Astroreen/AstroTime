// Dialogs that load with their first opening, not with the app
// (docs/plans/foundation.md#D145): each stands in for its component with the
// same props, draws nothing until it is first open, and fetches its code
// once the page is idle, so the first opening does not wait for it. Code that
// did not arrive (offline, or a release replaced it) is asked for again: the
// dialog says so, with "Try again" and "Reload", and the next opening tries
// again too.
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { primaryButton, textButton } from "./sign-in-dialog.tsx";

/** What every deferred dialog takes: whether it is open is read from the rest. */
interface Closable {
  readonly onClose: () => void;
}

export function deferred<P extends Closable, M = unknown>(
  load: () => Promise<M>,
  pick: (module: M) => ComponentType<P>,
  isOpen: (props: P) => boolean,
): ComponentType<P> {
  // One load at a time, kept once it arrived; a failed one is forgotten, so
  // the next asks again. The browser keeps a module that failed to load as
  // failed (HTML's module map), so the next asks for its file under another
  // URL: the one the failure names, with a query of its own.
  let loading: Promise<ComponentType<P>> | undefined;
  let source: string | undefined;
  let tries = 0;
  const preload = () => {
    if (loading) return loading;
    const module = source
      ? (import(/* @vite-ignore */ `${source}?try=${++tries}`) as Promise<M>)
      : load();
    loading = module.then(pick).catch((error: unknown) => {
      loading = undefined;
      source ??= chunkOf(error);
      throw error;
    });
    return loading;
  };
  // React keeps what a lazy component's load gave, a failure too: a new one per try.
  const attempt = () => lazy(() => preload().then((component) => ({ default: component })));
  return function Deferred(props: P) {
    const open = isOpen(props);
    // Once opened it stays drawn, so it closes as it would have.
    const [wanted, setWanted] = useState(open);
    if (open && !wanted) setWanted(true);
    const [Loaded, setLoaded] = useState(attempt);
    const [failed, setFailed] = useState(false);
    // Closed after a failure: the next opening tries again.
    if (failed && !open) {
      setFailed(false);
      setWanted(false);
      setLoaded(attempt);
    }
    useEffect(() => {
      // A failure here is met again, and said, at the opening.
      const fetch = () => void preload().catch(() => {});
      if (typeof requestIdleCallback === "function") {
        const id = requestIdleCallback(fetch);
        return () => cancelIdleCallback(id);
      }
      const id = setTimeout(fetch);
      return () => clearTimeout(id);
    }, []);
    if (!wanted) return null;
    const retry = () => {
      setLoaded(attempt);
      setFailed(false);
    };
    if (failed) return <LoadFailed onRetry={retry} onClose={props.onClose} />;
    return (
      <Failed onFail={() => setFailed(true)}>
        <Suspense fallback={null}>
          <Loaded {...props} />
        </Suspense>
      </Failed>
    );
  };
}

/** The file a failed `import()` names (Chromium's and Firefox's messages do), if any. */
function chunkOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const url = /(https?:\/\/\S+?\.js)\b/.exec(error.message)?.[1];
  return url && new URL(url).origin === location.origin ? url : undefined;
}

/** Catches a load that failed below it. */
class Failed extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch() {
    this.props.onFail();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** What shows in a dialog's place when its code did not arrive. */
function LoadFailed({ onRetry, onClose }: { onRetry: () => void; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="astrotime-load-failed"
      className="fixed inset-0 z-[120] grid place-items-center bg-black/45 p-4"
    >
      <div className="flex max-w-sm flex-col gap-4 rounded-3xl bg-raised p-6 text-ink shadow-2xl">
        <p id="astrotime-load-failed" className="text-[15px]">
          {t("lazy.failed")}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={textButton} onClick={onClose}>
            {t("lazy.close")}
          </button>
          <button type="button" className={textButton} onClick={() => location.reload()}>
            {t("lazy.reload")}
          </button>
          <button type="button" className={primaryButton} onClick={onRetry} autoFocus>
            {t("lazy.retry")}
          </button>
        </div>
      </div>
    </div>
  );
}

export const ItemEditor = deferred(
  () => import("./item-editor.tsx"),
  (module) => module.ItemEditor,
  (props: ComponentProps<typeof import("./item-editor.tsx").ItemEditor>) => props.state !== null,
);

export const SettingsScreen = deferred(
  () => import("./settings-section.tsx"),
  (module) => module.SettingsScreen,
  (props: ComponentProps<typeof import("./settings-section.tsx").SettingsScreen>) => props.open,
);

export const ConflictsDialog = deferred(
  () => import("./conflicts-dialog.tsx"),
  (module) => module.ConflictsDialog,
  (props: ComponentProps<typeof import("./conflicts-dialog.tsx").ConflictsDialog>) => props.open,
);
