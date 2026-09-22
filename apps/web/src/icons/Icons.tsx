import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** App mark: an eye crossed by a route line. */
export function Logo(props: P) {
  // Elude mark: a route that slips around the camera's gaze.
  return (
    <svg viewBox="0 0 40 40" {...props}>
      <defs>
        <linearGradient id="elude-route" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#4f8cff" />
          <stop offset="1" stopColor="#7fd3ff" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="#0f151d" stroke="#26323e" />
      {/* camera gaze */}
      <circle cx="25.5" cy="15" r="7.5" fill="none" stroke="#ff5a5f" strokeOpacity="0.35" strokeWidth="1.2" strokeDasharray="2 2.6" />
      <circle cx="25.5" cy="15" r="3.1" fill="#ff5a5f" />
      {/* the route eludes it */}
      <path
        d="M8 33.5c6.5-1 9.5-5.5 9.5-11.5 0-6 3.5-9 8-9"
        fill="none"
        stroke="url(#elude-route)"
        strokeWidth="3.4"
        strokeLinecap="round"
        transform="translate(-1.5 -3) rotate(-8 20 20)"
      />
      <circle cx="7.2" cy="31" r="2.6" fill="#7fd3ff" />
    </svg>
  );
}

export const IconSearch = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);
export const IconClose = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconSwap = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 4v13" />
    <path d="M4 14l3 3 3-3" />
    <path d="M17 20V7" />
    <path d="M14 10l3-3 3 3" />
  </svg>
);
export const IconLocate = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    <circle cx="12" cy="12" r="8" />
  </svg>
);
export const IconSettings = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);
export const IconPin = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z" />
    <circle cx="12" cy="10" r="2" />
  </svg>
);
export const IconNav = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3l7 18-7-4-7 4z" fill="currentColor" stroke="none" />
  </svg>
);
export const IconVolume = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 10v4h4l5 4V6L8 10z" />
    <path d="M16 9a4 4 0 010 6" />
    <path d="M18.5 6.5a8 8 0 010 11" />
  </svg>
);
export const IconMuted = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 10v4h4l5 4V6L8 10z" />
    <path d="M17 9l4 6M21 9l-4 6" />
  </svg>
);
export const IconLayers = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
  </svg>
);
export const IconChevron = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const IconList = (p: P) => (
  <svg {...base} {...p}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <circle cx="4" cy="6" r="1" fill="currentColor" />
    <circle cx="4" cy="12" r="1" fill="currentColor" />
    <circle cx="4" cy="18" r="1" fill="currentColor" />
  </svg>
);
export const IconPlay = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 4l13 8-13 8z" fill="currentColor" stroke="none" />
  </svg>
);
export const IconExternal = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M19 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1h5" />
  </svg>
);
export const IconCamera = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 8h4l2-3h6l2 3h4v11H3z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
export const IconWarning = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3l10 18H2z" />
    <path d="M12 10v5M12 18h.01" />
  </svg>
);
export const IconArrowRight = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconFlag = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 21V4" />
    <path d="M5 4h12l-2.5 4L17 12H5" />
  </svg>
);
export const IconDot = (p: P) => (
  <svg viewBox="0 0 24 24" aria-hidden {...p}>
    <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2.5" />
  </svg>
);
export const IconMap = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
    <path d="M9 4v14M15 6v14" />
  </svg>
);
export const IconPlus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconLink = (p: P) => (
  <svg {...base} {...p}>
    <path d="M10 14a5 5 0 007.07 0l2.12-2.12a5 5 0 00-7.07-7.07L11 5.93" />
    <path d="M14 10a5 5 0 00-7.07 0l-2.12 2.12a5 5 0 007.07 7.07L13 18.07" />
  </svg>
);
export const IconDownload = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3v12" />
    <path d="M7 11l5 5 5-5" />
    <path d="M4 20h16" />
  </svg>
);
export const IconGrip = (p: P) => (
  <svg viewBox="0 0 24 24" aria-hidden {...p}>
    <circle cx="9" cy="6" r="1.4" fill="currentColor" />
    <circle cx="15" cy="6" r="1.4" fill="currentColor" />
    <circle cx="9" cy="12" r="1.4" fill="currentColor" />
    <circle cx="15" cy="12" r="1.4" fill="currentColor" />
    <circle cx="9" cy="18" r="1.4" fill="currentColor" />
    <circle cx="15" cy="18" r="1.4" fill="currentColor" />
  </svg>
);
export const IconCheck = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 12.5l5 5L20 6.5" />
  </svg>
);
/** Scout mode: field binoculars. */
export const IconBinoculars = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 5h2.5v5.5l1.5 8.5H3l2-8.5V5z" />
    <path d="M14.5 5H17v5.5l2 8.5h-8l1.5-8.5V5z" />
    <path d="M9.5 9h5" />
  </svg>
);
