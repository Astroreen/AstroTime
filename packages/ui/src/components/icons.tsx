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

export const SettingsIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

export const EditIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
  </Icon>
);

export const TrashIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </Icon>
);

export const ClockIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
);

export const BellIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20.5a2 2 0 0 0 4 0" />
  </Icon>
);

export const PlaceIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Icon>
);

export const NotesIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M4 6h16M4 11h16M4 16h10" />
  </Icon>
);

export const CalendarIcon = (props: Props) => (
  <Icon {...props}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Icon>
);

export const PeopleIcon = (props: Props) => (
  <Icon {...props}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.8c1.8.6 3 2.2 3.4 4.7" />
  </Icon>
);

export const PaletteIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.3-1-1.6-1-2.6 0-.9.7-1.4 1.6-1.4h2.1a4 4 0 0 0 4-4C20.5 6.8 16.7 3.5 12 3.5z" />
    <circle cx="7.8" cy="11" r="1" />
    <circle cx="10.5" cy="7.5" r="1" />
    <circle cx="15" cy="7.8" r="1" />
  </Icon>
);

export const SubtasksIcon = (props: Props) => (
  <Icon {...props}>
    <path d="M5 4v11a3 3 0 0 0 3 3h11M15 14l4 4-4 4" />
  </Icon>
);
