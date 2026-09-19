import type { CSSProperties } from 'react';

/**
 * Inline SVG maneuver arrows keyed by GraphHopper instruction sign.
 * All arrows are drawn in a 24x24 box, pointing "up" = travel direction.
 */
interface Props {
  sign: number;
  exitNumber?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

function Straight() {
  return (
    <g {...stroke}>
      <path d="M12 20V5" />
      <path d="M7 10l5-5 5 5" />
    </g>
  );
}
function Turn({ dir, sharp }: { dir: 'left' | 'right'; sharp?: 'slight' | 'sharp' }) {
  const m = dir === 'left' ? -1 : 1;
  if (sharp === 'slight') {
    return (
      <g {...stroke} transform={m < 0 ? 'scale(-1,1) translate(-24,0)' : undefined}>
        <path d="M9 20V12l7-7" />
        <path d="M10.5 5H16v5.5" />
      </g>
    );
  }
  if (sharp === 'sharp') {
    return (
      <g {...stroke} transform={m < 0 ? 'scale(-1,1) translate(-24,0)' : undefined}>
        <path d="M9 20V6l9 12" />
        <path d="M18 12.5V18h-5.5" />
      </g>
    );
  }
  return (
    <g {...stroke} transform={m < 0 ? 'scale(-1,1) translate(-24,0)' : undefined}>
      <path d="M8 20v-8a3 3 0 013-3h8" />
      <path d="M15 5l4 4-4 4" />
    </g>
  );
}
function Keep({ dir }: { dir: 'left' | 'right' }) {
  const m = dir === 'left' ? -1 : 1;
  return (
    <g {...stroke} transform={m < 0 ? 'scale(-1,1) translate(-24,0)' : undefined}>
      <path d="M8 20v-5" opacity={0.45} />
      <path d="M8 15c0-4 2-6 6-8" opacity={0.45} />
      <path d="M8 20v-3c0-4 3-6 7-9" />
      <path d="M11 6.5h4.5V11" />
    </g>
  );
}
function UTurn({ dir }: { dir: 'left' | 'right' }) {
  const m = dir === 'left' ? -1 : 1;
  return (
    <g {...stroke} transform={m > 0 ? 'scale(-1,1) translate(-24,0)' : undefined}>
      <path d="M16 20V9a4 4 0 00-8 0v6" />
      <path d="M5 12l3 3 3-3" />
    </g>
  );
}
function Roundabout({ exitNumber, leave }: { exitNumber?: number; leave?: boolean }) {
  return (
    <g {...stroke}>
      <circle cx="12" cy="13" r="5" opacity={leave ? 0.45 : 1} />
      <path d="M12 8V3" />
      <path d="M9 6l3-3 3 3" />
      <path d="M12 18v3" opacity={0.6} />
      {exitNumber ? (
        <text x="12" y="14.6" textAnchor="middle" fontSize="6.5" fontWeight="800" fill="currentColor" stroke="none" fontFamily="inherit">
          {exitNumber}
        </text>
      ) : null}
    </g>
  );
}
function Finish() {
  return (
    <g>
      <path d="M6 21V4" {...stroke} />
      <path d="M6 4h11l-2.5 3.5L17 11H6z" fill="currentColor" stroke="none" />
    </g>
  );
}
function Via() {
  return (
    <g {...stroke}>
      <path d="M12 21s-6-5.5-6-11a6 6 0 0112 0c0 5.5-6 11-6 11z" />
      <circle cx="12" cy="10" r="2" fill="currentColor" stroke="none" />
    </g>
  );
}

export function maneuverLabel(sign: number): string {
  switch (sign) {
    case -98:
      return 'Make a U-turn';
    case -8:
      return 'U-turn left';
    case -7:
      return 'Keep left';
    case -6:
      return 'Exit roundabout';
    case -3:
      return 'Sharp left';
    case -2:
      return 'Turn left';
    case -1:
      return 'Slight left';
    case 0:
      return 'Continue';
    case 1:
      return 'Slight right';
    case 2:
      return 'Turn right';
    case 3:
      return 'Sharp right';
    case 4:
      return 'Arrive';
    case 5:
      return 'Waypoint';
    case 6:
      return 'Roundabout';
    case 7:
      return 'Keep right';
    case 8:
      return 'U-turn right';
    default:
      return 'Continue';
  }
}

export function ManeuverIcon({ sign, exitNumber, className, style, title }: Props) {
  let body: JSX.Element;
  switch (sign) {
    case -98:
    case -8:
      body = <UTurn dir="left" />;
      break;
    case 8:
      body = <UTurn dir="right" />;
      break;
    case -7:
      body = <Keep dir="left" />;
      break;
    case 7:
      body = <Keep dir="right" />;
      break;
    case -6:
      body = <Roundabout leave />;
      break;
    case 6:
      body = <Roundabout exitNumber={exitNumber} />;
      break;
    case -3:
      body = <Turn dir="left" sharp="sharp" />;
      break;
    case -2:
      body = <Turn dir="left" />;
      break;
    case -1:
      body = <Turn dir="left" sharp="slight" />;
      break;
    case 1:
      body = <Turn dir="right" sharp="slight" />;
      break;
    case 2:
      body = <Turn dir="right" />;
      break;
    case 3:
      body = <Turn dir="right" sharp="sharp" />;
      break;
    case 4:
      body = <Finish />;
      break;
    case 5:
      body = <Via />;
      break;
    default:
      body = <Straight />;
  }
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} role="img" aria-label={title ?? maneuverLabel(sign)}>
      {body}
    </svg>
  );
}
