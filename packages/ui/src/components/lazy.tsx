// Dialogs that load with their first opening, not with the app, and the
// Agenda with its first showing (docs/plans/foundation.md#D145): each stands in for its component with the
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
  useRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { primaryButton, textButton } from "./buttons.ts";

/** What every deferred dialog takes: whether it is open is read from the rest. */
interface Closable {
  readonly onClose: () => void;
}

/** How long a deferred part's code waits for the page to be idle before it is fetched anyway. */
const IDLE_AT_MOST_MS = 2000;

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
    /** "Try again" failed too: what failed may be a file it shares, which only a reload brings. */
    const [retried, setRetried] = useState(false);
    /** Counts tries and failures: a try's arrival speaks for that try alone. */
    const generation = useRef(0);
    // Closed after a failure: the next opening tries again.
    if (failed && !open) {
      setFailed(false);
      setRetried(false);
      setWanted(false);
      setLoaded(attempt);
    }
    useEffect(() => {
      // A failure here is met again, and said, at the opening.
      const fetch = () => void preload().catch(() => {});
      if (typeof requestIdleCallback === "function") {
        // A page that is never idle (a busy phone) still fetches it, at most
        // this long after, so its first opening need not wait (D145).
        const id = requestIdleCallback(fetch, { timeout: IDLE_AT_MOST_MS });
        return () => cancelIdleCallback(id);
      }
      const id = setTimeout(fetch);
      return () => clearTimeout(id);
    }, []);
    if (!wanted) return null;
    const retry = () => {
      const mine = ++generation.current;
      setLoaded(attempt);
      setFailed(false);
      setRetried(true);
      // Arrived, a later failure is a new one: "Try again" first again; not
      // once another failure or another try came meanwhile (a close resets it).
      void preload().then(
        () => generation.current === mine && setRetried(false),
        () => {},
      );
    };
    if (failed) return <LoadFailed again={retried} onRetry={retry} onClose={props.onClose} />;
    return (
      <Failed
        onFail={() => {
          generation.current++;
          setFailed(true);
        }}
      >
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

/**
 * What shows in a dialog's place when its code did not arrive: "Try again"
 * first, and once that failed too, "Reload AstroTime to finish updating"
 * (docs/plans/foundation.md#D145).
 */
function LoadFailed({
  again,
  onRetry,
  onClose,
}: {
  again: boolean;
  onRetry: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const reload = () => location.reload();
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="astrotime-load-failed"
      className="fixed inset-0 z-[120] grid place-items-center bg-black/45 p-4"
    >
      <div className="flex max-w-sm flex-col gap-4 rounded-3xl bg-raised p-6 text-ink shadow-2xl">
        <p id="astrotime-load-failed" className="text-[15px]">
          {t(again ? "lazy.failedAgain" : "lazy.failed")}
        </p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={textButton} onClick={onClose}>
            {t("lazy.close")}
          </button>
          {again ? (
            <>
              <button type="button" className={textButton} onClick={onRetry}>
                {t("lazy.retry")}
              </button>
              <button type="button" className={primaryButton} onClick={reload} autoFocus>
                {t("lazy.reloadToUpdate")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={textButton} onClick={reload}>
                {t("lazy.reload")}
              </button>
              <button type="button" className={primaryButton} onClick={onRetry} autoFocus>
                {t("lazy.retry")}
              </button>
            </>
          )}
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

/** Quick create (design D296): a chunk of its own, not the editor's. */
export const QuickCreate = deferred(
  () => import("./quick-create.tsx"),
  (module) => module.QuickCreate,
  (props: ComponentProps<typeof import("./quick-create.tsx").QuickCreate>) => props.state !== null,
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

/**
 * The Agenda, which a view of its own shows: drawn while it is the view
 * (design D87), its code fetched once the page is idle; closing the notice
 * of code that did not arrive leaves it for another view (`onClose`).
 */
export const AgendaView = deferred(
  () => import("./agenda-view.tsx"),
  (module) => module.AgendaView,
  (
    _props: ComponentProps<typeof import("./agenda-view.tsx").AgendaView> & { onClose: () => void },
  ) => true,
);

export const CopyNotice = deferred(
  () => import("./copy-notice.tsx"),
  (module) => module.CopyNotice,
  (props: ComponentProps<typeof import("./copy-notice.tsx").CopyNotice>) => props.copied !== null,
);

export const ItemDetails = deferred(
  () => import("./item-details.tsx"),
  (module) => module.ItemDetails,
  (props: ComponentProps<typeof import("./item-details.tsx").ItemDetails>) => props.target !== null,
);

/** The add-account dialog (docs/plans/providers.md#D255): its forms load with its first opening. */
export const SignInDialog = deferred(
  () => import("./sign-in-dialog.tsx"),
  (module) => module.SignInDialog,
  (props: ComponentProps<typeof import("./sign-in-dialog.tsx").SignInDialog>) =>
    props.request !== null,
);
