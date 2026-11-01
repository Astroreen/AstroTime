// The backdrop and popup of every Dialog and AlertDialog (design D136): a
// closing one takes no pointer events, so a press on the grid just after it
// closes is not swallowed by its fade. Every dialog uses these, not Base
// UI's parts directly (`test/dialog-parts.test.ts` holds it so), so a new
// dialog cannot forget it. Menus and popovers stay Base UI's own: it makes a
// closing one inert itself.
import { AlertDialog } from "@base-ui/react/alert-dialog";
import { Dialog } from "@base-ui/react/dialog";
import type { ComponentProps } from "react";

const closing = "data-ending-style:pointer-events-none";

type WithClassName<T> = Omit<T, "className"> & { className?: string };

export function DialogBackdrop({
  className,
  ...props
}: WithClassName<ComponentProps<typeof Dialog.Backdrop>>) {
  return <Dialog.Backdrop {...props} className={`${className ?? ""} ${closing}`} />;
}

export function DialogPopup({
  className,
  ...props
}: WithClassName<ComponentProps<typeof Dialog.Popup>>) {
  return <Dialog.Popup {...props} className={`${className ?? ""} ${closing}`} />;
}

export function AlertDialogBackdrop({
  className,
  ...props
}: WithClassName<ComponentProps<typeof AlertDialog.Backdrop>>) {
  return <AlertDialog.Backdrop {...props} className={`${className ?? ""} ${closing}`} />;
}

export function AlertDialogPopup({
  className,
  ...props
}: WithClassName<ComponentProps<typeof AlertDialog.Popup>>) {
  return <AlertDialog.Popup {...props} className={`${className ?? ""} ${closing}`} />;
}
