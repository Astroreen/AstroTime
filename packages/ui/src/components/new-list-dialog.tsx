// "+ New list" on the tasks screen (docs/plans/design.md#D276): a name, and
// where the list goes, an account's server (made there now, providers
// D275) or this device; the list made is the one shown. Loaded with its
// first opening, its strings with it.
import type { Account, Calendar } from "@astrotime/storage";
import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { makeDeviceCalendar } from "../calendar/device-calendar.ts";
import { DEVICE, whyNotMade, type NotMade } from "../calendar/place.ts";
import { addNewListStrings } from "../i18n/new-list.ts";
import { accountName } from "./accounts.tsx";
import { useAccounts } from "./accounts-context.tsx";
import { primaryButton, textButton } from "./buttons.ts";
import { DialogBackdrop, DialogPopup, dialogIcon } from "./dialog-parts.tsx";
import { CloseIcon } from "./icons.tsx";
import { Select } from "./select.tsx";

/**
 * What makes a list on a server, loaded when the dialog opens: its name
 * stays out of the first load's list of chunks. Out of the component: the
 * React Compiler takes no `import()` in one.
 */
const loadMake = () => import("../calendar/make.ts");
type Make = Awaited<ReturnType<typeof loadMake>>;

const input =
  "h-11 w-full rounded-lg bg-canvas px-3 text-input text-ink ring-1 ring-line outline-none placeholder:text-ink-muted focus:ring-2 focus:ring-accent";

type Step =
  | { readonly name: "idle" }
  | { readonly name: "making" }
  | {
      readonly name: "failed";
      readonly why: NotMade;
      readonly account: string;
      readonly status: number;
    };

export function NewListDialog({
  open,
  onClose,
  onMade,
  near,
}: {
  open: boolean;
  onClose: () => void;
  /** The list made, to show; called for one made after the dialog closed too. */
  onMade: (calendar: Calendar) => void;
  /** The account of the list shown: the first place offered when it makes lists. */
  near: string | null;
}) {
  const { t, i18n } = useTranslation();
  addNewListStrings(i18n);
  const { store, platform } = useAccounts();
  const [name, setName] = useState("");
  /** The accounts a list can be made on; none known until what makes one has loaded. */
  const [accounts, setAccounts] = useState<readonly Account[] | null>(null);
  /** What makes one, or the accounts, could not be loaded: this device alone is offered, said. */
  const [unloaded, setUnloaded] = useState(false);
  const maker = useRef<Make | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [step, setStep] = useState<Step>({ name: "idle" });
  const nameId = useId();
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    let current = true;
    Promise.all([loadMake(), store.accounts()]).then(
      ([module, all]) => {
        maker.current = module;
        if (!current) return;
        setUnloaded(false);
        setAccounts(module.placesOf(all));
      },
      // Not loaded (offline, a release replaced it), or no accounts read.
      () => current && setUnloaded(true),
    );
    return () => {
      current = false;
    };
  }, [open, store]);
  const places = [
    ...(accounts ?? []).map((account) => ({ value: account.id, label: accountName(account, t) })),
    { value: DEVICE, label: t("local.account") },
  ];
  const place =
    places.find((one) => one.value === chosen)?.value ??
    places.find((one) => one.value === near)?.value ??
    places[0]!.value;
  const placeName = places.find((one) => one.value === place)!.label;
  const named = name.trim() !== "";
  const ready = accounts !== null || unloaded;

  // Closed while a list is being made, the dialog keeps it: it opens again
  // on "Making…" with "Create" off (no second list), and the list made is
  // still shown when it comes.
  const close = () => {
    if (step.name !== "making") {
      setStep({ name: "idle" });
      setName("");
      setChosen(null);
    }
    onClose();
  };
  const make = () => {
    if (!named || step.name === "making" || !ready) return;
    setStep({ name: "making" });
    makeList(store, platform, maker.current, place, name, t("local.account")).then(
      (calendar) => {
        onMade(calendar);
        setStep({ name: "idle" });
        setName("");
        setChosen(null);
        onClose();
      },
      (error: unknown) => setStep({ name: "failed", ...whyNotMade(error), account: placeName }),
    );
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <Dialog.Portal>
        {/* Over the tasks screen, a dialog itself on a phone: its own backdrop, which Base UI leaves out of a nested dialog by default. */}
        <DialogBackdrop
          forceRender
          className="fixed inset-0 z-[120] bg-black/45 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0"
        />
        <DialogPopup
          aria-labelledby={titleId}
          className="centred fixed z-[130] flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-4 rounded-3xl bg-raised p-5 text-ink shadow-2xl transition-[scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0"
        >
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              make();
            }}
          >
            <div className="flex items-center gap-2">
              <Dialog.Title id={titleId} className="min-w-0 flex-1 text-title">
                {t("newList.title")}
              </Dialog.Title>
              <Dialog.Close className={dialogIcon} aria-label={t("newList.close")}>
                <CloseIcon className="size-5" />
              </Dialog.Close>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={nameId} className="text-small font-medium text-ink-muted">
                {t("newList.name")}
              </label>
              <input
                id={nameId}
                className={input}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                required
                maxLength={200}
              />
            </div>
            {places.length > 1 ? (
              <Select
                label={t("newList.where")}
                labelClassName="text-small font-medium text-ink-muted"
                value={place}
                onChange={setChosen}
                options={places}
                className="h-10 w-full min-w-0 rounded-lg bg-canvas pr-1 pl-2"
              />
            ) : null}
            {unloaded ? (
              <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-note">
                {t("newList.unloaded")}
              </p>
            ) : null}
            {step.name === "making" ? (
              <p role="status" className="text-body">
                {t("newList.making", { account: placeName })}
              </p>
            ) : step.name === "failed" ? (
              <p role="alert" className="rounded-2xl bg-danger-soft p-3 text-note">
                {t(`newList.${step.why}`, { account: step.account, status: step.status })}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close type="button" className={textButton}>
                {t("newList.cancel")}
              </Dialog.Close>
              <button
                type="submit"
                className={primaryButton}
                disabled={!named || step.name === "making" || !ready}
              >
                {t("newList.make")}
              </button>
            </div>
          </form>
        </DialogPopup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * A list of tasks at `place`: on this device by the store alone, as
 * `makeCalendarAt` makes one (so it can be made when what makes one on a
 * server did not load), else on the account's server through `make.ts`.
 */
function makeList(
  store: Parameters<typeof makeDeviceCalendar>[0],
  platform: Parameters<Make["makeCalendarAt"]>[1],
  maker: Make | null,
  place: string,
  name: string,
  deviceAccount: string,
): Promise<Calendar> {
  const list = { name, color: null, component: "VTODO" } as const;
  if (place === DEVICE) return makeDeviceCalendar(store, deviceAccount, list);
  if (!maker) return Promise.reject(new Error("What makes a list on a server did not load."));
  return maker.makeCalendarAt(store, platform, place, list, deviceAccount);
}
