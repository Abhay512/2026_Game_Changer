/** Hand-drawn 1.5px stroke icons on a 20px grid. */
type P = { title?: string };

function Svg({ title, children }: P & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? "img" : undefined}>
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

export const SunIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="3.25" />
    <path d="M10 2.5v1.75M10 15.75v1.75M2.5 10h1.75M15.75 10h1.75M4.7 4.7l1.24 1.24M14.06 14.06l1.24 1.24M4.7 15.3l1.24-1.24M14.06 5.94l1.24-1.24" />
  </Svg>
);

export const MoonIcon = (p: P) => (
  <Svg {...p}>
    <path d="M15.5 12.4A6.25 6.25 0 0 1 7.6 4.5a6.25 6.25 0 1 0 7.9 7.9Z" />
  </Svg>
);

export const InfoIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 9v4.5M10 6.6v.1" />
  </Svg>
);

export const SearchIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="5.25" />
    <path d="m13 13 3.5 3.5" />
  </Svg>
);

export const ChevronLeft = (p: P) => (
  <Svg {...p}>
    <path d="m12 5-5 5 5 5" />
  </Svg>
);

export const ChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="m8 5 5 5-5 5" />
  </Svg>
);

export const SlidersIcon = (p: P) => (
  <Svg {...p}>
    <path d="M4 6h7M15 6h1M4 14h1M9 14h7" />
    <circle cx="13" cy="6" r="1.75" />
    <circle cx="7" cy="14" r="1.75" />
  </Svg>
);

export const CloseIcon = (p: P) => (
  <Svg {...p}>
    <path d="m5.5 5.5 9 9M14.5 5.5l-9 9" />
  </Svg>
);

export const CalendarIcon = (p: P) => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" />
    <path d="M3.5 8.5h13M7 3v3M13 3v3" />
  </Svg>
);

export const Mark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="mark">
    <path d="M6 4v16M12 2v20M18 6v12" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" />
    <rect x="4" y="8" width="4" height="7" rx="1" fill="var(--up)" />
    <rect x="10" y="5" width="4" height="9" rx="1" fill="var(--down)" />
    <rect x="16" y="9" width="4" height="5" rx="1" fill="var(--up)" />
  </svg>
);

export const LogoutIcon = (p: P) => (
  <Svg {...p}>
    <path d="M8 3.5H5a1.5 1.5 0 0 0-1.5 1.5v10A1.5 1.5 0 0 0 5 16.5h3M12.5 13.5 16 10l-3.5-3.5M16 10H8" />
  </Svg>
);

export const ClockIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="10" cy="10" r="7" />
    <path d="M10 6v4.25l2.75 1.75" />
  </Svg>
);
