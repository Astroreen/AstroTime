// The add-account dialog (docs/plans/foundation.md#D19, D92): Nextcloud through
// Login Flow v2, or any CalDAV server by password. Signing in again to an
// account opens it with the account's address and user name.
import type { Account } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import { Tabs } from "@base-ui/react/tabs";
import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { SignIn } from "../accounts/sign-in.ts";
import { useAccounts } from "./accounts-context.tsx";

type SignInKind = "nextcloud" | "caldav";

export interface SignInRequest {
  readonly kind: SignInKind;
  /** Signing in again: the account whose address and user name are filled in. */
  readonly account?: Account;
}

export const primaryButton =
  "rounded-full bg-accent px-5 py-2 text-sm font-medium text-on-accent hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
export const textButton =
  "rounded-full px-4 py-2 text-sm font-medium text-accent hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent";
const input =
  "h-11 w-full rounded-lg bg-canvas px-3 text-[15px] text-ink ring-1 ring-line outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-accent";

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
  return (
    <Dialog.Root open={request !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[100] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-[110] max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl bg-raised p-6 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0">
          <Dialog.Title className="mb-4 text-[22px] leading-tight">
            {t(request?.account ? "signIn.titleAgain" : "signIn.title")}
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
        </Dialog.Popup>
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
  const { t } = useTranslation();
  const { platform, store } = useAccounts();
  const [signIn] = useState(
    () =>
      new SignIn({
        store,
        secrets: platform.secrets,
        http: platform.http,
        openExternal: platform.openExternal,
        ...(platform.signingInTo ? { signingInTo: platform.signingInTo } : {}),
      }),
  );
  const state = useSyncExternalStore(
    (onChange) => signIn.subscribe(onChange),
    () => signIn.state,
  );
  const [kind, setKind] = useState<SignInKind>(request.kind);
  const [server, setServer] = useState(() =>
    request.account ? request.account.serverUrl.replace(/^https:\/\//, "").replace(/\/$/, "") : "",
  );
  const [username, setUsername] = useState(request.account?.username ?? "");
  const [password, setPassword] = useState("");

  // Closing the dialog stops whatever the attempt was doing.
  useEffect(() => () => signIn.cancel(), [signIn]);
  // Once, as the attempt ends: the state changes to `done` once.
  useEffect(
    () =>
      signIn.subscribe(() => {
        if (signIn.state.step === "done") onDone();
      }),
    [signIn, onDone],
  );
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

  if (state.step === "checking" || state.step === "done") {
    return (
      <Busy onCancel={() => signIn.cancel()}>
        <p>{t("signIn.checking")}</p>
      </Busy>
    );
  }
  if (state.step === "waiting") {
    return (
      <Busy
        onCancel={() => signIn.cancel()}
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
      <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
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
  const serverField = (
    <Field label={t("signIn.server")}>
      {(id) => (
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
        />
      )}
    </Field>
  );

  return (
    <Tabs.Root value={kind} onValueChange={(value: SignInKind) => setKind(value)}>
      <Tabs.List
        aria-label={t("signIn.kind")}
        className="mb-4 grid grid-cols-2 rounded-full bg-canvas p-1 text-sm font-medium"
      >
        {(["nextcloud", "caldav"] as const).map((value) => (
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
          <p className="text-sm text-ink-muted">{t("signIn.nextcloudHelp")}</p>
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
          <p className="text-sm text-ink-muted">{t("signIn.caldavHelp")}</p>
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
    </Tabs.Root>
  );
}

function Field({ label, children }: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
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
    <div className="flex flex-col gap-3 text-sm text-ink-muted" aria-busy="true">
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
