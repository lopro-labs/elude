export type Units = 'imperial' | 'metric';

const M_PER_MI = 1609.344;
const M_PER_FT = 0.3048;

/** Long-form distance for summaries: "12.4 mi (20 km)" style pieces. */
export function formatDistance(meters: number, units: Units): string {
  if (!Number.isFinite(meters)) return '—';
  if (units === 'imperial') {
    const mi = meters / M_PER_MI;
    if (mi < 0.1) return `${Math.round(meters / M_PER_FT / 10) * 10} ft`;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** Secondary unit shown in parentheses. */
export function formatDistanceAlt(meters: number, units: Units): string {
  return formatDistance(meters, units === 'imperial' ? 'metric' : 'imperial');
}

/** Short maneuver distance for navigation ("450 ft", "0.8 mi", "200 m", "1.2 km"). */
export function formatManeuverDistance(meters: number, units: Units): string {
  if (!Number.isFinite(meters)) return '';
  if (units === 'imperial') {
    const ft = meters / M_PER_FT;
    if (ft < 1000) return `${Math.max(0, Math.round(ft / 10) * 10)} ft`;
    const mi = meters / M_PER_MI;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (meters < 1000) return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** Spoken distance for voice guidance. */
export function speakDistance(meters: number, units: Units): string {
  if (units === 'imperial') {
    const ft = meters / M_PER_FT;
    if (ft < 1000) return `${Math.round(ft / 50) * 50} feet`;
    const mi = meters / M_PER_MI;
    if (mi < 0.3) return 'a quarter mile';
    if (mi < 0.6) return 'half a mile';
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} miles`;
  }
  if (meters < 1000) return `${Math.round(meters / 50) * 50} meters`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} kilometers`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const totalMin = Math.round(ms / 60000);
  if (totalMin < 1) return '< 1 min';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

export function formatDelta(ms: number): string {
  const sign = ms >= 0 ? '+' : '−';
  return `${sign}${formatDuration(Math.abs(ms))}`;
}

export function formatEta(msFromNow: number): string {
  const d = new Date(Date.now() + msFromNow);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown date';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** "Aug 16, 9:54 AM" — drops the year, for tight header space. */
export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}

export function shortCoord([lon, lat]: [number, number]): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
