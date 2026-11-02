// AstroTime's own dropdowns (design D167), instead of the browser's lists:
// `Select` picks one value (Base UI's Select), `MenuButton` runs one action
// from a list (Base UI's Menu). Both open a rounded popup under their button,
// as Material's exposed dropdown menu does on Android, the chosen value
// checked and scrolled into view; on a touch screen the rows are 48 px.
import { Menu } from "@base-ui/react/menu";
import { Select as BaseSelect } from "@base-ui/react/select";
import type { ReactNode } from "react";

import { CaretIcon, CheckIcon } from "./icons.tsx";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  /** Drawn before the label, in the list and on the button: a colour's dot. */
  readonly leading?: ReactNode;
}

/** The button's own look; the caller gives its size and background. */
const button =
  "flex cursor-default items-center gap-2 text-left text-input text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent data-popup-open:ring-2 data-popup-open:ring-accent";

/** The popup's look, which Location's place list shares (design D175). */
export const popup =
  "max-h-[min(var(--available-height),24rem)] max-w-[var(--available-width)] min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-y-auto overscroll-contain rounded-xl bg-raised p-1 text-ink shadow-xl ring-1 ring-line transition-[scale,opacity] duration-100 outline-none data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0";

export const row =
  "flex min-h-10 cursor-default items-center gap-3 rounded-lg py-1 pr-4 pl-2 text-body outline-none select-none pointer-coarse:min-h-12 data-highlighted:bg-raised-hover";

/**
 * One value from a list. With `labelClassName` its label shows in that
 * style next to the button (the caller's layout places both); without, the
 * label only names the button for a screen reader.
 */
export function Select({
  label,
  labelClassName,
  value,
  onChange,
  options,
  className = "",
}: {
  label: string;
  labelClassName?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** The button's size and background. */
  className?: string;
}) {
  const chosen = options.find((option) => option.value === value);
  return (
    <BaseSelect.Root value={value} onValueChange={(next) => next !== null && onChange(next)}>
      {labelClassName !== undefined && (
        <BaseSelect.Label className={labelClassName}>{label}</BaseSelect.Label>
      )}
      <BaseSelect.Trigger
        aria-label={labelClassName === undefined ? label : undefined}
        className={`${button} ${className}`}
      >
        <BaseSelect.Value className="flex min-w-0 flex-1 items-center gap-2">
          {chosen?.leading}
          <span className="min-w-0 flex-1 truncate">{chosen?.label}</span>
        </BaseSelect.Value>
        <BaseSelect.Icon className="shrink-0 text-ink-muted">
          <CaretIcon className="size-5" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          alignItemWithTrigger={false}
          sideOffset={4}
          collisionPadding={8}
          className="z-[200] outline-none"
        >
          <BaseSelect.Popup className={popup}>
            <BaseSelect.List>
              {options.map((option) => (
                <BaseSelect.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  className={`${row} data-selected:text-accent`}
                >
                  <span className="grid size-5 shrink-0 place-items-center">
                    <BaseSelect.ItemIndicator>
                      <CheckIcon className="size-5" />
                    </BaseSelect.ItemIndicator>
                  </span>
                  {option.leading}
                  <BaseSelect.ItemText className="min-w-0 flex-1">
                    {option.label}
                  </BaseSelect.ItemText>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

/**
 * A button whose list runs one action: "Add reminder" and its choices; with
 * `icon`, an icon button named `label`, as the details' "⋯" (design D163).
 */
export function MenuButton({
  label,
  options,
  onChoose,
  icon,
  className = "",
}: {
  label: string;
  options: readonly SelectOption[];
  onChoose: (value: string) => void;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <Menu.Root>
      {icon ? (
        <Menu.Trigger aria-label={label} title={label} className={className}>
          {icon}
        </Menu.Trigger>
      ) : (
        <Menu.Trigger className={`${button} ${className}`}>
          <span className="min-w-0 flex-1 truncate text-ink-muted">{label}</span>
          <CaretIcon className="size-5 shrink-0 text-ink-muted" />
        </Menu.Trigger>
      )}
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} collisionPadding={8} className="z-[200] outline-none">
          <Menu.Popup className={popup}>
            {options.map((option) => (
              <Menu.Item
                key={option.value}
                label={option.label}
                onClick={() => onChoose(option.value)}
                className={`${row} pl-3`}
              >
                {option.leading}
                <span className="min-w-0 flex-1">{option.label}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
