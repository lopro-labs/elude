import type { RoutePath } from '@elude/shared';
import type { Place } from '../state/store';

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}

function wpt(lng: number, lat: number, name: string, sym?: string): string {
  return `  <wpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">\n    <name>${esc(name)}</name>${sym ? `\n    <sym>${esc(sym)}</sym>` : ''}\n  </wpt>`;
}

/** Build a GPX 1.1 document for a route: origin/stops/destination as waypoints, the path as a track, crossed cameras flagged. */
export function buildGpx(path: RoutePath, origin: Place | null, stops: Place[], destination: Place | null): string {
  const waypoints: string[] = [];
  if (origin) waypoints.push(wpt(origin.lngLat[0], origin.lngLat[1], `Start: ${origin.label}`, 'Flag, Green'));
  stops.forEach((s, i) => waypoints.push(wpt(s.lngLat[0], s.lngLat[1], `Stop ${i + 1}: ${s.label}`, 'Pin, Blue')));
  if (destination) waypoints.push(wpt(destination.lngLat[0], destination.lngLat[1], `Destination: ${destination.label}`, 'Flag, Red'));
  for (const c of path.camerasCrossed) {
    waypoints.push(wpt(c.lngLat[0], c.lngLat[1], `ALPR camera${c.manufacturer ? ` (${c.manufacturer})` : ''}`, 'Danger Area'));
  }
  const trkpts = path.points.map(([lng, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"/>`).join('\n');
  const name =
    origin && destination ? `Elude: ${origin.label} → ${destination.label}` : 'Elude route';
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Elude — drive unseen" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(name)}</name>
    <desc>${esc(`${(path.distance / 1609.344).toFixed(1)} mi, ${Math.round(path.time / 60000)} min, ${path.camerasCrossed.length} camera crossing(s). Camera data: DeFlock / OpenStreetMap (ODbL).`)}</desc>
  </metadata>
${waypoints.join('\n')}
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}
