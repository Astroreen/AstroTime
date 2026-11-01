// The icons of the accounts and their syncing, drawn like `icons.tsx` (design D43).
import type { SVGProps } from "react";

type Props = SVGProps<SVGSVGElement>;

const base = {
  viewBox: "0 0 24 24",
  width: 24,
  height: 24,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
  focusable: false,
} as const;

/** An account's menu: three dots, one above the other. */
export const MoreIcon = (props: Props) => (
  <svg {...base} {...props} stroke="none" fill="currentColor">
    <circle cx="12" cy="5.5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="18.5" r="1.8" />
  </svg>
);

/** Syncing: two arrows chasing each other. */
export const SyncIcon = (props: Props) => (
  <svg {...base} {...props}>
    <path d="M20 12a8 8 0 0 1-14 5.3M4 12a8 8 0 0 1 14-5.3" />
    <path d="M18 3v4h-4M6 21v-4h4" />
  </svg>
);

/** Adding an account: a person and a plus. */
export const AddPersonIcon = (props: Props) => (
  <svg {...base} {...props}>
    <circle cx="10" cy="8" r="3.5" />
    <path d="M3.5 19.5c.8-3.4 3.4-5.5 6.5-5.5s5.7 2.1 6.5 5.5M19 8v6M16 11h6" />
  </svg>
);
