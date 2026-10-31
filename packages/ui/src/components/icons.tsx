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
