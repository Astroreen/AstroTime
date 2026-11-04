// The buttons every dialog shares: one filled for its main action, text for
// the rest. Apart from the sign-in dialog, which loads with its first
// opening (docs/plans/providers.md#D255), so the others need not load it.
export const primaryButton =
  "rounded-full bg-accent px-5 py-2 text-body font-medium text-on-accent hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50";
export const textButton =
  "rounded-full px-4 py-2 text-body font-medium text-accent hover:bg-raised-hover focus-visible:outline-2 focus-visible:outline-accent";
