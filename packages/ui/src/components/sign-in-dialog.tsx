// The add-account dialog (docs/plans/foundation.md#D19, D92): Nextcloud through
// Login Flow v2, or any CalDAV server by password. Signing in again to an
// account opens it with the account's address and user name. A single-user
// deployment's preset (D123) asks for the password alone.
import { inClear } from "@astrotime/caldav";
import type { Account } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { serverAddress, SignIn } from "../accounts/sign-in.ts";
import { addSignInStrings } from "../i18n/sign-in.ts";
import { addSubscribeStrings } from "../i18n/subscribe.ts";
import { useAccounts } from "./accounts-context.tsx";
import { primaryButton, textButton } from "./buttons.ts";
import { DialogBackdrop, DialogPopup } from "./dialog-parts.tsx";

type SignInKind = "nextcloud" | "caldav" | "ics";

export interface SignInRequest {
  /** `preset`: the deployment's server and user (D123); the full form without one. */
  readonly kind: SignInKind | "preset";
  /** Signing in again: the account whose address and user name are filled in. */
  readonly account?: Account;
  /** Takes up the Login Flow a page before this one started (D121). */
  readonly resume?: boolean;
}

const input =
  "h-11 w-full rounded-lg bg-canvas px-3 text-input text-ink ring-1 ring-line outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-accent";

export function SignInDialog({
  request,
  onClose,
  onSignedIn,
}: {
  request: SignInRequest | null;
  onClose: () => void;
  onSignedIn: () => void;
}) {
  const { t } = useTranslation();
  const { preset } = useAccounts().platform;
  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <DialogBackdrop className="fixed inset-0 z-[100] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPopup className="centred z-[110] w-[min(26rem,calc(100vw-2rem))] rounded-3xl bg-raised p-6 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <Dialog.Title className="mb-4 text-headline leading-tight">
            {request?.account
              ? t("signIn.titleAgain")
              : request?.kind === "preset" && preset
                ? t("signIn.preset.title", { host: new URL(preset.server).host })
                : t("signIn.title")}
          </Dialog.Title>
          {request && (
            <SignInForm
              request={request}
              onCancel={onClose}
              onDone={() => {
                onSignedIn();
                onClose();
              }}
            />
          )}
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SignInForm({
  request,
  onCancel,
  onDone,
}: {
  request: SignInRequest;
  onCancel: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation();
  addSignInStrings(i18n);
  // The subscription tab's name is among them (providers D251).
  addSubscribeStrings(i18n);
  const { platform, store } = useAccounts();
  const [signIn] = useState(
    () =>
      new SignIn({
        store,
        secrets: platform.secrets,
        http: platform.http,
        openExternal: platform.openExternal,
        ...(platform.signingInTo ? { signingInTo: platform.signingInTo } : {}),
        ...(platform.pendingSignIn ? { pending: platform.pendingSignIn } : {}),
      }),
  );
  const state = useSyncExternalStore(
    (onChange) => signIn.subscribe(onChange),
    () => signIn.state,
  );
  const preset = request.kind === "preset" && !request.account ? platform.preset : undefined;
  // The preset's form, until the user asks for another server.
  const [presetOnly, setPresetOnly] = useState(preset !== undefined);
  const [kind, setKind] = useState<SignInKind>(request.kind === "preset" ? "caldav" : request.kind);
  const [server, setServer] = useState(() =>
    request.account ? request.account.serverUrl.replace(/^https:\/\//, "").replace(/\/$/, "") : "",
  );
  const [username, setUsername] = useState(request.account?.username ?? "");
  const [password, setPassword] = useState("");

  // Closing the dialog stops whatever the attempt was doing.
  useEffect(() => () => void signIn.cancel(), [signIn]);
  // Once, as the attempt ends: the state changes to `done` once. A flow
  // taken up again that another page ended closes the dialog: the account,
  // if it was approved, comes through the store.
  const ended = useEffectEvent(() => onCancel());
  useEffect(
    () =>
      signIn.subscribe(() => {
        if (signIn.state.step === "done") onDone();
        if (signIn.state.step === "elsewhere") ended();
      }),
    [signIn, onDone],
  );
  // A Login Flow a page before this one started (D121); none after all, nothing to show.
  const resume = Boolean(request.resume);
  useEffect(() => {
    if (!resume) return;
    let live = true;
    void signIn.resume().then((resumed) => live && !resumed && ended());
    return () => {
      live = false;
    };
  }, [signIn, resume]);
  // Back from Nextcloud's page: ask at once whether it was approved (android
  // D65). A tab comes back visible; a desktop window beside the browser was
  // visible all along and comes back focused (desktop D77).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") signIn.pollNow();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [signIn]);

  if (state.step === "checking" || state.step === "done" || state.step === "elsewhere") {
    return (
      <Busy onCancel={() => void signIn.cancel()}>
        <p>{t("signIn.checking")}</p>
      </Busy>
    );
  }
  if (state.step === "waiting") {
    return (
      <Busy
        onCancel={() => void signIn.cancel()}
        action={
          <button type="button" className={textButton} onClick={() => signIn.reopen()}>
            {t("signIn.waiting.reopen")}
          </button>
        }
      >
        <h3 className="font-medium text-ink">{t("signIn.waiting.title")}</h3>
        <p>{t("signIn.waiting.body")}</p>
      </Busy>
    );
  }

  const problem =
    state.step === "failed" ? (
      <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-body text-danger">
        {t(`signIn.problem.${state.problem}`, { location: state.location ?? "" })}
      </p>
    ) : null;
  const actions = (submit: string) => (
    <div className="mt-2 flex justify-end gap-2">
      <button type="button" className={textButton} onClick={onCancel}>
        {t("signIn.cancel")}
      </button>
      <button type="submit" className={primaryButton}>
        {submit}
      </button>
    </div>
  );
  // A password to this address would cross the network unencrypted (D260).
  const typed = serverAddress(server);
  const inClearAddress = typed !== null && inClear(typed);
  const serverField = (
    <Field label={t("signIn.server")}>
      {(id) => (
        <>
          <input
            id={id}
            className={input}
            value={server}
            onChange={(event) => setServer(event.target.value)}
            placeholder={t("signIn.serverPlaceholder")}
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-describedby={inClearAddress ? `${id}-clear` : undefined}
          />
          {inClearAddress && (
            <p id={`${id}-clear`} className="text-small text-danger">
              {t("signIn.inClear")}
            </p>
          )}
        </>
      )}
    </Field>
  );

  if (preset && presetOnly) {
    return (
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void signIn.withPassword({
            server: preset.server,
            username: preset.username ?? username,
            password,
          });
        }}
      >
        {preset.username === null ? (
          <Field label={t("signIn.username")}>
            {(id) => (
              <input
                id={id}
                className={input}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            )}
          </Field>
        ) : (
          <>
            <p className="text-body text-ink-muted">
              {t("signIn.preset.as", { username: preset.username })}
            </p>
            {/* For the browser's password manager, which keys a password by its user. */}
            <input type="text" hidden readOnly value={preset.username} autoComplete="username" />
          </>
        )}
        <Field label={t("signIn.password")}>
          {(id) => (
            <input
              id={id}
              className={input}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              // The one thing asked: the dialog opens on it.
              autoFocus
              required
            />
          )}
        </Field>
        {problem}
        {actions(t("signIn.submit"))}
        <div className="flex flex-wrap justify-end gap-1 border-t border-line pt-2">
          <button
            type="button"
            className={textButton}
            onClick={() => void signIn.withNextcloud({ server: preset.server })}
          >
            {t("signIn.preset.loginFlow")}
          </button>
          <button
            type="button"
            className={textButton}
            onClick={() => {
              setPresetOnly(false);
              setServer("");
            }}
          >
            {t("signIn.preset.other")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <Tabs.Root value={kind} onValueChange={(value: SignInKind) => setKind(value)}>
      <Tabs.List
        aria-label={t("signIn.kind")}
        className="mb-4 grid grid-cols-3 rounded-full bg-canvas p-1 text-body font-medium"
      >
        {(["nextcloud", "caldav", "ics"] as const).map((value) => (
          <Tabs.Tab
            key={value}
            value={value}
            className="h-9 rounded-full text-ink-muted data-active:bg-accent-soft data-active:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            {t(`signIn.kind.${value}`)}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      <Tabs.Panel value="nextcloud">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn.withNextcloud({ server });
          }}
        >
          <p className="text-body text-ink-muted">{t("signIn.nextcloudHelp")}</p>
          {serverField}
          {problem}
          {actions(t("signIn.continue"))}
        </form>
      </Tabs.Panel>
      <Tabs.Panel value="caldav">
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void signIn.withPassword({ server, username, password });
          }}
        >
          <p className="text-body text-ink-muted">{t("signIn.caldavHelp")}</p>
          {serverField}
          <Field label={t("signIn.username")}>
            {(id) => (
              <input
                id={id}
                className={input}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            )}
          </Field>
          <Field label={t("signIn.password")}>
            {(id) => (
              <input
                id={id}
                className={input}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            )}
          </Field>
          {problem}
          {actions(t("signIn.submit"))}
        </form>
      </Tabs.Panel>
      <Tabs.Panel value="ics">
        <SubscribeForm onCancel={onCancel} onDone={onDone} />
      </Tabs.Panel>
    </Tabs.Root>
  );
}

/** Outside the component: the React Compiler does not compile an `import()` (design D194). */
const subscriptions = () => import("@astrotime/sync/subscriptions");

type SubscribeProblem = "address" | "not-calendar" | "refused" | "failed";

/** A subscription's problem, by the error's name: the classes load with the subscription's code. */
const subscribeProblem = (
  error: unknown,
): SubscribeProblem | "offline" | "not-allowed" | "certificate" => {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotCalendarError") return "not-calendar";
  if (name === "AuthError") return "refused";
  if (name === "OfflineError" || name === "ServerBusyError") return "offline";
  if (name === "ProxyRefusedError") return "not-allowed";
  if (name === "CertificateError") return "certificate";
  return "failed";
};

/**
 * Subscribing to a calendar at an address (providers D251): the file is read
 * once before anything is kept, so a wrong address is said here.
 */
function SubscribeForm({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  addSubscribeStrings(i18n);
  const { platform, store } = useAccounts();
  const [address, setAddress] = useState("");
  const [state, setState] = useState<
    | { readonly step: "idle" | "checking" }
    | { readonly step: "failed"; readonly problem: ReturnType<typeof subscribeProblem> }
  >({ step: "idle" });
  // A reading the user left (Cancel, or the dialog closed) says nothing after.
  const attempt = useRef(0);
  useEffect(() => () => void (attempt.current += 1), []);
  if (state.step === "checking") {
    return (
      <Busy
        onCancel={() => {
          attempt.current += 1;
          setState({ step: "idle" });
        }}
      >
        <p>{t("subscribe.checking")}</p>
      </Busy>
    );
  }
  const subscribe = async () => {
    const mine = ++attempt.current;
    setState({ step: "checking" });
    try {
      const { addSubscription } = await subscriptions();
      const found = await addSubscription(
        { store, secrets: platform.secrets, http: platform.http },
        address,
      );
      if (mine !== attempt.current) return;
      if (found) onDone();
      else setState({ step: "failed", problem: "address" });
    } catch (error) {
      if (mine === attempt.current) setState({ step: "failed", problem: subscribeProblem(error) });
    }
  };
  const problem = state.step === "failed" ? state.problem : null;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void subscribe();
      }}
    >
      <p className="text-body text-ink-muted">{t("subscribe.help")}</p>
      <Field label={t("subscribe.address")}>
        {(id) => (
          <input
            id={id}
            className={input}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={t("subscribe.placeholder")}
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        )}
      </Field>
      {problem && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-body text-danger">
          {problem === "offline" || problem === "not-allowed" || problem === "certificate"
            ? t(`signIn.problem.${problem}`)
            : t(`subscribe.problem.${problem}`)}
        </p>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button type="button" className={textButton} onClick={onCancel}>
          {t("signIn.cancel")}
        </button>
        <button type="submit" className={primaryButton}>
          {t("subscribe.submit")}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-small font-medium text-ink-muted">
        {label}
      </label>
      {children(id)}
    </div>
  );
}

/** A step in progress: what is happening, and a way out. */
function Busy({
  children,
  action,
  onCancel,
}: {
  children: ReactNode;
  action?: ReactNode;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 text-body text-ink-muted" aria-busy="true">
      <div
        data-spinner
        className="size-6 animate-spin rounded-full border-[3px] border-accent-soft border-t-accent"
        aria-hidden="true"
      />
      <div role="status" className="flex flex-col gap-2">
        {children}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        {action}
        <button type="button" className={textButton} onClick={onCancel}>
          {t("signIn.cancel")}
        </button>
      </div>
    </div>
  );
}
