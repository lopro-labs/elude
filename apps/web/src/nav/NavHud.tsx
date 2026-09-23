import { activePath, useStore } from '../state/store';
import { formatDistance, formatDuration, formatEta, formatManeuverDistance } from '../util/format';
import { ManeuverIcon } from '../icons/ManeuverIcon';
import { IconBinoculars, IconClose, IconMuted, IconVolume } from '../icons/Icons';

export function NavHud() {
  const nav = useStore((s) => s.nav);
  const route = useStore((s) => s.route);
  const selectedKind = useStore((s) => s.selectedKind);
  const units = useStore((s) => s.settings.units);
  const voice = useStore((s) => s.settings.voice);
  const updateSettings = useStore((s) => s.updateSettings);
  const stopNav = useStore((s) => s.stopNav);

  if (!nav.active) return null;
  if (nav.watch) return <WatchHud />;
  if (!route) return null;
  const path = activePath(route, selectedKind) ?? route.chosen;
  const step = path.instructions[nav.stepIndex] ?? path.instructions[path.instructions.length - 1];
  const next = path.instructions[nav.stepIndex + 1];
  const hasFix = nav.position != null;

  // Cameras still ahead on the route
  const camsAhead = path.camerasCrossed.filter((c) => c.pathIndex > nav.snappedIndex).length;
  const nextCam = path.camerasCrossed.find((c) => c.pathIndex > nav.snappedIndex);

  return (
    <>
      <div className="hud" aria-live="polite">
        <div className="hud__main">
          <div className="hud__icon">
            <ManeuverIcon sign={nav.arrived ? 4 : step.sign} exitNumber={step.exitNumber} />
          </div>
          <div>
            {nav.arrived ? (
              <>
                <div className="hud__dist">Arrived</div>
                <div className="hud__text">You've reached your destination</div>
              </>
            ) : hasFix ? (
              <>
                <div className="hud__dist">{formatManeuverDistance(nav.distToManeuverM, units)}</div>
                <div className="hud__text">{step.text}</div>
                {step.streetName && !step.text.includes(step.streetName) && <div className="hud__street">{step.streetName}</div>}
              </>
            ) : (
              <>
                <div className="hud__dist">GPS</div>
                <div className="hud__text">{nav.gpsError ?? 'Waiting for your location…'}</div>
              </>
            )}
          </div>
        </div>
        {nav.cameraAlert && (
          <div className={`hud__cam hud__cam--${nav.cameraAlert.phase}`} role="alert">
            <span className="hud__cam-dot" />
            <span>
              {nav.cameraAlert.phase === 'passing'
                ? `Passing camera${nav.cameraAlert.manufacturer ? ` · ${nav.cameraAlert.manufacturer}` : ''}`
                : `Camera in ${formatDistance(nav.cameraAlert.distanceM, units)}${nav.cameraAlert.manufacturer ? ` · ${nav.cameraAlert.manufacturer}` : ''}`}
              {nav.cameraAlert.facingAway ? ' (facing away)' : nav.cameraAlert.possiblyNotVisible ? ' (bridge/tunnel — may not see you)' : ''}
            </span>
          </div>
        )}
        {next && hasFix && !nav.arrived && (
          <div className="hud__next">
            <span>Then</span>
            <ManeuverIcon sign={next.sign} exitNumber={next.exitNumber} />
            <span>{next.text}</span>
          </div>
        )}
        <div className="hud__flags">
          {nav.rerouting && <span className="hud__flag hud__flag--info">Rerouting…</span>}
          {nav.offRoute && !nav.rerouting && <span className="hud__flag hud__flag--bad">Off route</span>}
          {nav.simulate && <span className="hud__flag hud__flag--info">Preview · not logged</span>}
          {nextCam && hasFix && !nav.cameraAlert && (
            <span className="hud__flag" title={nextCam.possiblyNotVisible ? 'On a bridge/tunnel — may not be visible to the camera' : undefined}>
              Camera ahead in {formatDistance(Math.max(0, cumAt(path.points, nextCam.pathIndex) - nav.alongM), units)}
              {nextCam.possiblyNotVisible ? ' (maybe not visible)' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="navbar">
        <div className="navbar__grow">
          <div className="navbar__eta">{hasFix ? formatEta(nav.remainingMs) : '—'}</div>
          <div className="navbar__sub">
            {hasFix ? `${formatDuration(nav.remainingMs)} · ${formatDistance(nav.remainingM, units)}` : 'Waiting for GPS'}
            {camsAhead > 0 ? ` · ${camsAhead} camera${camsAhead === 1 ? '' : 's'} ahead` : ' · no cameras ahead'}
          </div>
        </div>
        <div className="navbar__actions">
          <button className={`icon-btn${voice ? ' icon-btn--active' : ''}`} onClick={() => updateSettings({ voice: !voice })} title={voice ? 'Mute voice' : 'Unmute voice'} aria-label={voice ? 'Mute voice' : 'Unmute voice'}>
            {voice ? <IconVolume /> : <IconMuted />}
          </button>
          <button className="btn btn--danger btn--sm" onClick={stopNav}>
            <IconClose /> Exit
          </button>
        </div>
      </div>
    </>
  );
}

/** Route-less watch mode: speed, nearby camera count, alert strip. */
function WatchHud() {
  const nav = useStore((s) => s.nav);
  const units = useStore((s) => s.settings.units);
  const voice = useStore((s) => s.settings.voice);
  const updateSettings = useStore((s) => s.updateSettings);
  const stopNav = useStore((s) => s.stopNav);
  const passes = useStore((s) => s.tripDraft?.passes.length ?? 0);
  const hasFix = nav.position != null;
  const speed = nav.speedMps != null && nav.speedMps >= 0 ? (units === 'imperial' ? `${Math.round(nav.speedMps * 2.23694)} mph` : `${Math.round(nav.speedMps * 3.6)} km/h`) : '—';

  return (
    <>
      <div className="hud" aria-live="polite">
        <div className="hud__main">
          <div className="hud__icon">
            <IconBinoculars />
          </div>
          <div>
            <div className="hud__dist">{hasFix ? speed : 'GPS'}</div>
            <div className="hud__text">{hasFix ? 'Scouting ahead' : nav.gpsError ?? 'Waiting for your location…'}</div>
          </div>
        </div>
        {nav.cameraAlert && (
          <div className={`hud__cam hud__cam--${nav.cameraAlert.phase}`} role="alert">
            <span className="hud__cam-dot" />
            <span>
              {nav.cameraAlert.phase === 'passing'
                ? `Passing camera${nav.cameraAlert.manufacturer ? ` · ${nav.cameraAlert.manufacturer}` : ''}`
                : `Camera in ${formatDistance(nav.cameraAlert.distanceM, units)}${nav.cameraAlert.manufacturer ? ` · ${nav.cameraAlert.manufacturer}` : ''}`}
              {nav.cameraAlert.facingAway ? ' (facing away)' : ''}
            </span>
          </div>
        )}
        <div className="hud__flags">
          <span className="hud__flag hud__flag--info">Scout mode</span>
          {hasFix && (
            <span className="hud__flag">
              {nav.nearbyCount} mapped camera{nav.nearbyCount === 1 ? '' : 's'} within {formatDistance(500, units)}
            </span>
          )}
        </div>
      </div>

      <div className="navbar">
        <div className="navbar__grow">
          <div className="navbar__eta">
            {passes} passed
          </div>
          <div className="navbar__sub">{hasFix ? 'Alerts for mapped cameras near you · logging each pass' : 'Waiting for GPS'}</div>
        </div>
        <div className="navbar__actions">
          <button className={`icon-btn${voice ? ' icon-btn--active' : ''}`} onClick={() => updateSettings({ voice: !voice })} title={voice ? 'Mute voice' : 'Unmute voice'} aria-label={voice ? 'Mute voice' : 'Unmute voice'}>
            {voice ? <IconVolume /> : <IconMuted />}
          </button>
          <button className="btn btn--danger btn--sm" onClick={stopNav}>
            <IconClose /> Exit
          </button>
        </div>
      </div>
    </>
  );
}

// Cheap cumulative distance to a point index (small n; nav hook holds the exact one).
const cumCache = new WeakMap<object, number[]>();
function cumAt(points: [number, number][], idx: number): number {
  let cum = cumCache.get(points);
  if (!cum) {
    cum = [0];
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      const R = 6371000;
      const toRad = Math.PI / 180;
      const dLat = (y2 - y1) * toRad;
      const dLon = (x2 - x1) * toRad;
      const a = Math.sin(dLat / 2) ** 2 + Math.cos(y1 * toRad) * Math.cos(y2 * toRad) * Math.sin(dLon / 2) ** 2;
      cum[i] = cum[i - 1] + 2 * R * Math.asin(Math.sqrt(a));
    }
    cumCache.set(points, cum);
  }
  return cum[Math.min(idx, cum.length - 1)];
}
