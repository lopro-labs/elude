/**
 * Shareable-URL state: origin / stops / destination / key options encoded as
 * query params so a route survives refresh and can be sent to someone.
 *
 *   ?from=lat,lng&to=lat,lng&via=lat,lng|lat,lng&mode=strict|balanced|none&buf=30
 *
 * Coordinates are lat,lng in the URL (human/Google convention) but LngLat
 * ([lng, lat]) everywhere in code.
 */
import type { LngLat, Strictness } from '@elude/shared';

export interface UrlState {
  origin: LngLat | null;
  destination: LngLat | null;
  stops: LngLat[];
  strictness?: Strictness;
  bufferM?: number;
}

const MODE_TO_PARAM: Record<Strictness, string> = {
  'strict-then-fallback': 'strict',
  balanced: 'balanced',
  none: 'none',
};
const PARAM_TO_MODE: Record<string, Strictness> = {
  strict: 'strict-then-fallback',
  balanced: 'balanced',
  none: 'none',
};

function fmt([lng, lat]: LngLat): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function parseCoord(s: string | null | undefined): LngLat | null {
  if (!s) return null;
  const parts = s.split(',').map((v) => Number(v.trim()));
  if (parts.length !== 2 || parts.some((v) => !Number.isFinite(v))) return null;
  const [lat, lng] = parts;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

export function readUrlState(search = window.location.search): UrlState | null {
  const q = new URLSearchParams(search);
  const origin = parseCoord(q.get('from'));
  const destination = parseCoord(q.get('to'));
  if (!origin && !destination) return null;
  const stops = (q.get('via') ?? '')
    .split('|')
    .map((s) => parseCoord(s))
    .filter((p): p is LngLat => p != null)
    .slice(0, 8);
  const strictness = PARAM_TO_MODE[q.get('mode') ?? ''];
  const buf = Number(q.get('buf'));
  return {
    origin,
    destination,
    stops,
    ...(strictness ? { strictness } : {}),
    ...(Number.isFinite(buf) && buf >= 15 && buf <= 150 ? { bufferM: buf } : {}),
  };
}

export function buildUrl(state: UrlState, base = `${window.location.origin}${window.location.pathname}`): string {
  const q = new URLSearchParams();
  if (state.origin) q.set('from', fmt(state.origin));
  if (state.destination) q.set('to', fmt(state.destination));
  if (state.stops.length) q.set('via', state.stops.map(fmt).join('|'));
  if (state.strictness && state.strictness !== 'strict-then-fallback') q.set('mode', MODE_TO_PARAM[state.strictness]);
  if (state.bufferM != null && state.bufferM !== 30) q.set('buf', String(state.bufferM));
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Keep the address bar in sync without polluting history. */
export function syncUrl(state: UrlState): void {
  const url = state.origin || state.destination ? buildUrl(state) : `${window.location.origin}${window.location.pathname}`;
  if (url !== window.location.href) window.history.replaceState(null, '', url);
}
