// Dialogs that load with their first opening, not with the app
// (docs/plans/foundation.md#D145): each stands in for its component with the
// same props, draws nothing until it is first open, and fetches its code
// once the page is idle, so the first opening does not wait for it.
import {
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentType,
} from "react";

function deferred<P extends object>(
  load: () => Promise<ComponentType<P>>,
  isOpen: (props: P) => boolean,
): ComponentType<P> {
  let loading: Promise<{ default: ComponentType<P> }> | undefined;
  const fetch = () => (loading ??= load().then((component) => ({ default: component })));
  const Loaded = lazy(fetch);
  return function Deferred(props: P) {
    const open = isOpen(props);
    // Once opened it stays drawn, so it closes as it would have.
    const [wanted, setWanted] = useState(open);
    if (open && !wanted) setWanted(true);
    useEffect(() => {
      if (typeof requestIdleCallback === "function") {
        const id = requestIdleCallback(() => void fetch());
        return () => cancelIdleCallback(id);
      }
      const id = setTimeout(() => void fetch());
      return () => clearTimeout(id);
    }, []);
    return wanted ? (
      <Suspense fallback={null}>
        <Loaded {...props} />
      </Suspense>
    ) : null;
  };
}

export const ItemEditor = deferred<ComponentProps<typeof import("./item-editor.tsx").ItemEditor>>(
  () => import("./item-editor.tsx").then((module) => module.ItemEditor),
  (props) => props.state !== null,
);

export const SettingsScreen = deferred<
  ComponentProps<typeof import("./settings-section.tsx").SettingsScreen>
>(
  () => import("./settings-section.tsx").then((module) => module.SettingsScreen),
  (props) => props.open,
);

export const ConflictsDialog = deferred<
  ComponentProps<typeof import("./conflicts-dialog.tsx").ConflictsDialog>
>(
  () => import("./conflicts-dialog.tsx").then((module) => module.ConflictsDialog),
  (props) => props.open,
);
