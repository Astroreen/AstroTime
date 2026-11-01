// AstroTime's own icons: 24-unit strokes, drawn here so no icon font or CDN
// is loaded (design D43).
import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type Props = SVGProps<SVGSVGElement>;

export const MenuIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);

export const CaretIcon = (props: Props) => (
  <Icon {...props} stroke="none" fill="currentColor">
    <path d="M7 10l5 5 5-5z" />
  </Icon>
);

export const ChevronIcon = ({
  direction,
  ...props
}: Props & { direction: "up" | "down" | "left" | "right" }) => (
  <Icon {...props}>
    <path
      d={
        {
          up: "M6 15l6-6 6 6",
          down: "M6 9l6 6 6-6",
          left: "M15 6l-6 6 6 6",
          right: "M9 6l6 6-6 6",
        }[direction]
      }
    />
  </Icon>
);

export const PlusIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

/** A task's mark on its chip (design D51). */
export const CheckCircleIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 12.5l2.5 2.5 4.5-5" />
  </Icon>
);

/** The "today" button: a calendar page with today's day of the month. */
export const TodayIcon = ({ day, ...props }: Props & { day: string }) => (
  <Icon {...props}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
    <path d="M8 3v4M16 3v4" />
    <text
      x="12"
      y="17.6"
      textAnchor="middle"
      fontSize="9"
      fontWeight="600"
      fill="currentColor"
      stroke="none"
    >
      {day}
    </text>
  </Icon>
);

/** A view's icon: a calendar page with one, three or many day columns. */
export const ViewIcon = ({ columns, ...props }: Props & { columns: number }) => (
  <Icon {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9h17" />
    {columns === 3 && <path d="M9.2 9v10.5M14.8 9v10.5" />}
    {columns === 7 && <path d="M7.75 9v10.5M12 9v10.5M16.25 9v10.5" strokeWidth="1.5" />}
  </Icon>
);

/** The Month view's icon: a calendar page of weeks. */
export const MonthIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9h17M3.5 14.25h17M9.2 9v10.5M14.8 9v10.5" strokeWidth="1.5" />
  </Icon>
);

/** The Agenda's icon: lines of a list. */
export const AgendaIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12" />
    <path d="M4 6.5h.01M4 12h.01M4 17.5h.01" strokeWidth="2.6" />
  </Icon>
);

export const SearchIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="M15 15l5 5" />
  </Icon>
);

export const BackIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);

export const CloseIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

/** The tasks screen's star (design D52), outlined or filled. */
export const StarIcon = ({ filled, ...props }: Props & { filled: boolean }) => (
  <Icon {...props} fill={filled ? "currentColor" : "none"} strokeWidth="1.6">
    <path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
  </Icon>
);

/** Sorting: an arrow up and an arrow down. */
export const SortIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M8 19V5M4.5 8.5L8 5l3.5 3.5M16 5v14M12.5 15.5L16 19l3.5-3.5" />
  </Icon>
);

export const MoreIcon = (props: Props) => (
  <Icon {...props} stroke="none" fill="currentColor">
    <circle cx="12" cy="5.5" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="12" cy="18.5" r="1.8" />
  </Icon>
);

export const CheckIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

/** A series: two arrows in a loop. */
export const RepeatIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M17 3l3 3-3 3M4 11V9.5A3.5 3.5 0 0 1 7.5 6H20M7 21l-3-3 3-3M20 13v1.5a3.5 3.5 0 0 1-3.5 3.5H4" />
  </Icon>
);
