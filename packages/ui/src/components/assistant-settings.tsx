// Settings → Assistants (docs/plans/assistant.md#D308, D310, D311): the MCP
// endpoint on or off, its address and token, "New token", a ready
// configuration for each assistant, and "Changed by an assistant", each
// change with its Undo while the item is still what the assistant left.
// The log's code (`@astrotime/mcp`) loads with this group, not with Settings.
import { CalendarObject } from "@astrotime/core";
import type { LoggedChange } from "@astrotime/mcp";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { CLIENTS, configFor, type Client } from "../assistants/configs.ts";
import { liveQuery, whileShown } from "../calendar/live.ts";
import { addAssistantStrings } from "../i18n/assistants.ts";
import type { Assistants, AssistantsState } from "../platform.ts";
import { useAccounts } from "./accounts-context.tsx";
import { textButton } from "./buttons.ts";
import { targetOf, useEditing } from "./editing.tsx";
import { MenuButton } from "./select.tsx";
import { Toggle } from "./settings-section.tsx";

const loadMcp = () => import("@astrotime/mcp");

const row = "flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-body";
const value = "min-w-0 flex-1 basis-56 font-mono text-small break-all select-text";

export function AssistantSettings({
  assistants,
  onLeave,
}: {
  assistants: Assistants;
  /** Closes Settings before an item opens over the calendar. */
  onLeave: () => void;
}) {
  const { t, i18n } = useTranslation();
  addAssistantStrings(i18n);
  const [state, setState] = useState<AssistantsState | null>(null);
  const [copied, setCopied] = useState<{ what: string; failed?: boolean } | null>(null);
  const [config, setConfig] = useState<{
    client: Client;
    text: string;
    where: string | null;
  } | null>(null);
  useEffect(() => {
    let current = true;
    void assistants.state().then((next) => current && setState(next));
    return () => void (current = false);
  }, [assistants]);

  // No clipboard to write to (an insecure page): the text stays to select.
  const copy = (text: string, what: string) => {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
    if (!clipboard) return setCopied({ what, failed: true });
    void clipboard.writeText(text).then(
      () => setCopied({ what }),
      () => setCopied({ what, failed: true }),
    );
  };
  const copiedWord = (what: string) =>
    copied?.what === what
      ? copied.failed
        ? t("assistants.copyFailed")
        : t("assistants.copied")
      : null;

  const where = (client: Client, at: string | null = "") =>
    client === "claude-desktop" ||
    client === "claude-code" ||
    client === "vscode" ||
    client === "lm-studio" ||
    client === "json"
      ? t(`assistants.where.${client}`, { where: at ?? "" })
      : t("assistants.where.file", {
          client: String(t(`assistants.client.${client}`)),
          where: at ?? "",
        });

  const on = state?.enabled ?? false;
  return (
    <>
      <Toggle
        label={t("assistants.enable")}
        checked={on}
        onChange={(enabled) => void assistants.setEnabled(enabled).then(setState)}
        hint={t("assistants.enable.hint")}
      />
      {on && state?.error ? (
        <p role="alert" className="px-4 pb-2 text-note text-danger">
          {t("assistants.failed", { error: state.error })}
        </p>
      ) : null}
      {on && state?.url && state.token ? (
        <>
          <Field
            label={t("assistants.address")}
            text={state.url}
            copyLabel={t("assistants.copy.address")}
            onCopy={() => copy(state.url!, "address")}
            status={copiedWord("address")}
          />
          <Field
            label={t("assistants.token")}
            text={state.token}
            copyLabel={t("assistants.copy.token")}
            onCopy={() => copy(state.token!, "token")}
            status={copiedWord("token")}
          />
          <div className={`${row} border-t border-line`}>
            <p className="min-w-0 flex-1 basis-56 text-note text-ink-muted">
              {t("assistants.newToken.hint")}
            </p>
            <button
              type="button"
              className={textButton}
              onClick={() =>
                void assistants.newToken().then((next) => {
                  setState(next);
                  setConfig(null);
                  setCopied(null);
                })
              }
            >
              {t("assistants.newToken")}
            </button>
          </div>
          <div className={`${row} border-t border-line`}>
            <MenuButton
              label={t("assistants.config")}
              options={CLIENTS.map((client) => ({
                value: client,
                label: t(`assistants.client.${client}`),
              }))}
              onChoose={(chosen) => {
                const client = chosen as Client;
                const made = configFor(client, state.url!, state.token!);
                setConfig({ client, ...made });
                copy(made.text, "config");
              }}
              className="h-9 min-w-56 rounded-lg bg-raised pr-1 pl-2"
            />
          </div>
          {config ? (
            <div className="flex flex-col gap-2 px-4 pb-3">
              <p role="status" className="text-note text-ink-muted">
                {copied?.what === "config" && copied.failed
                  ? t("assistants.copyFailed")
                  : where(config.client, config.where)}
              </p>
              <pre
                aria-label={t(`assistants.client.${config.client}`)}
                className="max-h-56 overflow-auto rounded-lg bg-raised p-3 font-mono text-small whitespace-pre-wrap break-all select-text"
              >
                {config.text}
              </pre>
            </div>
          ) : null}
        </>
      ) : null}
      <ChangeLog onLeave={onLeave} />
    </>
  );
}

function Field({
  label,
  text,
  copyLabel,
  onCopy,
  status,
}: {
  label: string;
  text: string;
  copyLabel: string;
  onCopy: () => void;
  status: string | null;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className={`${row} border-t border-line`}>
      <span id={id} className="w-20 shrink-0">
        {label}
      </span>
      <span className={value}>{text}</span>
      <button type="button" aria-label={copyLabel} className={textButton} onClick={onCopy}>
        {status ?? t("assistants.copy")}
      </button>
    </div>
  );
}

/** "Changed by an assistant": the latest changes, each with its Undo, or why there is none. */
function ChangeLog({ onLeave }: { onLeave: () => void }) {
  const { t, i18n } = useTranslation();
  const { store, scheduler } = useAccounts();
  const editing = useEditing();
  const [changes, setChanges] = useState<readonly LoggedChange[] | null>(null);
  const headingId = useId();
  useEffect(
    () =>
      liveQuery(whileShown(store), async () => (await loadMcp()).loggedChanges(store), setChanges),
    [store],
  );
  const when = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const open = async (objectId: string) => {
    const stored = await store.object(objectId);
    if (!stored || stored.pending === "delete") return;
    const object = CalendarObject.parse(stored.ics);
    const item = object.master ?? object.exceptions[0];
    if (!item) return;
    onLeave();
    editing.open(targetOf(stored, object, null, item));
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col border-t border-line">
      <h3 id={headingId} className="px-4 pt-3 pb-1 text-body font-medium">
        {t("assistants.log")}
      </h3>
      {changes !== null && changes.length === 0 ? (
        <p className="px-4 pb-3 text-note text-ink-muted">{t("assistants.log.empty")}</p>
      ) : null}
      {changes && changes.length > 0 ? (
        <ul className="flex flex-col pb-1">
          {changes.map((change) => {
            const title = change.summary || t("assistants.log.untitled");
            return (
              <li key={change.id} className={`${row} border-t border-line first:border-t-0`}>
                <span className="flex min-w-0 flex-1 basis-48 flex-col">
                  <span className="truncate">{title}</span>
                  <span className="text-note text-ink-muted">
                    {t(`assistants.tool.${change.tool as "change_item"}`)} ·{" "}
                    {when.format(change.at)}
                  </span>
                </span>
                {change.state === "undoable" ? (
                  <button
                    type="button"
                    aria-label={t("assistants.undo.label", { title })}
                    className={textButton}
                    onClick={() =>
                      void loadMcp()
                        .then(({ undoChange }) => undoChange(store, change.id))
                        // Sent as the user's own change is (foundation D91).
                        .then((state) => state === "undone" && scheduler.changed())
                    }
                  >
                    {t("assistants.undo")}
                  </button>
                ) : change.state === "undone" ? (
                  <span className="text-note text-ink-muted">{t("assistants.undone")}</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-note text-ink-muted">{t("assistants.changedSince")}</span>
                    {change.objectId ? (
                      <button
                        type="button"
                        aria-label={t("assistants.open.label", { title })}
                        className={textButton}
                        onClick={() => void open(change.objectId!)}
                      >
                        {t("assistants.open")}
                      </button>
                    ) : null}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
