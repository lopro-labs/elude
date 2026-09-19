import { useMemo } from 'react';
import type { RoutePath } from '@elude/shared';
import { useStore } from '../state/store';
import { cumulativeDistances } from '../util/geo';
import { formatDistance, formatDuration } from '../util/format';

/**
 * "Exposure report": every camera the chosen/selected route actually passes,
 * in order along the drive, with how far in it happens and a timeline strip.
 * Turns a bare crossing count into something actionable.
 */
export function ExposureReport() {
  const route = useStore((s) => s.route);
  const selectedKind = useStore((s) => s.selectedKind);
  const units = useStore((s) => s.settings.units);
  const sendMapCommand = useStore((s) => s.sendMapCommand);
  const setHighlightedStep = useStore((s) => s.setHighlightedStep);

  const path: RoutePath | null = useMemo(() => {
    if (!route) return null;
    if (!selectedKind || route.chosen.kind === selectedKind) return route.chosen;
    if (selectedKind === 'fastest') return route.fastest ?? route.chosen;
    if (selectedKind === 'soft') return route.soft ?? route.chosen;
    return route.chosen;
  }, [route, selectedKind]);

  const entries = useMemo(() => {
    if (!path || path.camerasCrossed.length === 0) return [];
    const cum = cumulativeDistances(path.points);
    const total = cum[cum.length - 1] || 1;
    return path.camerasCrossed
      .map((c) => {
        const alongM = cum[Math.min(c.pathIndex, cum.length - 1)] ?? 0;
        return { cam: c, alongM, frac: Math.min(1, Math.max(0, alongM / total)), etaMs: path.time * (alongM / total) };
      })
      .sort((a, b) => a.alongM - b.alongM);
  }, [path]);

  if (!path || entries.length === 0) return null;

  const flyTo = (lngLat: [number, number]) => {
    setHighlightedStep(null);
    sendMapCommand({ type: 'fly-to', lngLat, zoom: 16 });
  };

  return (
    <section className="expo" aria-label="Camera exposure along the route">
      <div className="expo__head">
        <span>Exposure</span>
        <span>
          {entries.length} camera{entries.length === 1 ? '' : 's'} on this route
        </span>
      </div>

      <div className="expo__timeline" aria-hidden>
        <span className="expo__track" />
        {entries.map(({ cam, frac }, i) => (
          <button
            key={`${cam.id}-${i}`}
            className={`expo__pip${cam.possiblyNotVisible ? ' expo__pip--maybe' : ''}`}
            style={{ left: `${frac * 100}%` }}
            title={`${cam.manufacturer ?? 'Camera'} at ${formatDistance(cam.distanceM, units)} from the road`}
            onClick={() => flyTo(cam.lngLat)}
          />
        ))}
        <span className="expo__cap expo__cap--start">Start</span>
        <span className="expo__cap expo__cap--end">End</span>
      </div>

      <ul className="expo__list">
        {entries.map(({ cam, alongM, etaMs }, i) => (
          <li key={`${cam.id}-${i}`}>
            <button className="expo__row" onClick={() => flyTo(cam.lngLat)}>
              <span className={`expo__dot${cam.possiblyNotVisible ? ' expo__dot--maybe' : ''}`} />
              <span className="expo__at">{formatDistance(alongM, units)} in</span>
              <span className="expo__meta">
                {cam.manufacturer ?? 'ALPR camera'}
                {cam.possiblyNotVisible ? ' · bridge/tunnel, may not see you' : ''}
              </span>
              <span className="expo__eta">{formatDuration(etaMs)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
