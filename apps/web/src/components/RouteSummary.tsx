import { useEffect, useMemo, useState } from 'react';
import type { RouteKind, RoutePath, RouteResponse } from '@elude/shared';
import { activePath, useStore, type Place } from '../state/store';
import { formatDelta, formatDistance, formatDistanceAlt, formatDuration } from '../util/format';
import { diagnosticsEnabled } from '../util/debug';
import { buildGpx } from '../util/gpx';
import { downloadFile } from '../util/download';
import { buildUrl } from '../util/urlState';
import { IconCheck, IconDownload, IconLink, IconMap, IconNav, IconPlay } from '../icons/Icons';

function Shield({ route, path }: { route: RouteResponse; path: RoutePath }) {
  const crossed = path.camerasCrossed.length;
  const unavoidable = route.unavoidable.length;

  // The user picked a comparison path instead of the server's choice.
  if (path.kind !== route.chosen.kind) {
    if (path.kind === 'fastest') {
      return (
        <div className={`shield ${crossed === 0 ? 'shield--neutral' : 'shield--bad'}`}>
          <div className="shield__count">{crossed}</div>
          <div className="shield__text">
            <b>Fastest route selected</b>
            <span>{crossed === 0 ? 'No cameras on this route' : `Passes ${crossed} camera${crossed === 1 ? '' : 's'} — avoidance not applied`}</span>
          </div>
        </div>
      );
    }
    return (
      <div className={`shield ${crossed === 0 ? 'shield--safe' : 'shield--warn'}`}>
        <div className="shield__count">{crossed}</div>
        <div className="shield__text">
          <b>{crossed === 0 ? 'Balanced route — no cameras crossed' : `Balanced route — crosses ${crossed} camera${crossed === 1 ? '' : 's'}`}</b>
          <span>Shorter detour than the strict route, cameras penalized but not banned</span>
        </div>
      </div>
    );
  }

  if (route.mode === 'strict') {
    return (
      <div className="shield shield--safe">
        <div className="shield__count">{crossed}</div>
        <div className="shield__text">
          <b>
            {crossed === 0
              ? 'Zero cameras — fully avoided'
              : `Only ${crossed} unavoidable camera${crossed === 1 ? '' : 's'} at start/end`}
          </b>
          <span>
            {crossed === 0
              ? `${route.camerasConsidered.toLocaleString()} cameras considered within ${route.bufferM} m`
              : `Every other camera avoided (${route.camerasConsidered.toLocaleString()} considered within ${route.bufferM} m)`}
          </span>
        </div>
      </div>
    );
  }
  if (route.mode === 'fallback') {
    return (
      <div className="shield shield--warn">
        <div className="shield__count">{crossed}</div>
        <div className="shield__text">
          <b>
            Fewest cameras: {crossed} unavoidable
            {unavoidable ? ` (${unavoidable} at start/end)` : ''}
          </b>
          <span>No camera-free route exists between these points</span>
        </div>
      </div>
    );
  }
  if (route.mode === 'balanced') {
    return (
      <div className={`shield ${crossed === 0 ? 'shield--safe' : 'shield--warn'}`}>
        <div className="shield__count">{crossed}</div>
        <div className="shield__text">
          <b>{crossed === 0 ? 'Balanced route — no cameras crossed' : `Balanced route — crosses ${crossed} camera${crossed === 1 ? '' : 's'}`}</b>
          <span>Cameras penalized, but not banned, to keep the detour reasonable</span>
        </div>
      </div>
    );
  }
  return (
    <div className={`shield ${crossed === 0 ? 'shield--neutral' : 'shield--bad'}`}>
      <div className="shield__count">{crossed}</div>
      <div className="shield__text">
        <b>Fastest route only</b>
        <span>Camera avoidance is off — {crossed === 0 ? 'no cameras on this route' : `passes ${crossed} camera${crossed === 1 ? '' : 's'}`}</span>
      </div>
    </div>
  );
}

interface Card {
  path: RoutePath;
  label: string;
}

export function RouteSummary() {
  const route = useStore((s) => s.route);
  const selectedKind = useStore((s) => s.selectedKind);
  const setSelectedKind = useStore((s) => s.setSelectedKind);
  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);
  const stops = useStore((s) => s.stops);
  const units = useStore((s) => s.settings.units);
  const strictness = useStore((s) => s.settings.strictness);
  const bufferM = useStore((s) => s.settings.bufferM);
  const startNav = useStore((s) => s.startNav);
  const sendMapCommand = useStore((s) => s.sendMapCommand);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const showDiagnostics = diagnosticsEnabled(useStore((s) => s.settings.showDiagnostics));
  const [copied, setCopied] = useState(false);

  // When diagnostics are on, also echo the per-stage timings to the console.
  const timings = route?.timings;
  useEffect(() => {
    if (showDiagnostics && timings && Object.keys(timings).length > 0) {
      // eslint-disable-next-line no-console
      console.debug('[elude] route timings (ms):', timings);
    }
  }, [showDiagnostics, timings]);

  const cards = useMemo<Card[]>(() => {
    if (!route) return [];
    const list: Card[] = [];
    const push = (p: RoutePath | null | undefined, label: string) => {
      if (p && !list.some((c) => c.path.kind === p.kind)) list.push({ path: p, label });
    };
    push(
      route.chosen,
      route.chosen.kind === 'strict'
        ? route.mode === 'fallback'
          ? 'Fewest cameras'
          : 'Camera-free'
        : route.chosen.kind === 'soft'
          ? route.mode === 'fallback'
            ? 'Fewest cameras'
            : 'Balanced'
          : 'Fastest',
    );
    push(route.soft, 'Balanced');
    push(route.fastest, 'Fastest');
    return list;
  }, [route]);

  if (!route) return null;

  const active = activePath(route, selectedKind) ?? route.chosen;
  const { fastest } = route;
  const deltaMs = fastest && fastest !== active ? active.time - fastest.time : 0;
  const avoided = fastest && fastest !== active ? Math.max(0, fastest.camerasCrossed.length - active.camerasCrossed.length) : 0;
  const notVisible = active.camerasCrossed.filter((c) => c.possiblyNotVisible).length;
  const facingAway = active.avoidedByDirection ?? 0;

  const pick = (kind: RouteKind) => {
    setSelectedKind(kind === route.chosen.kind ? null : kind);
    sendMapCommand({ type: 'fit-route' });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        buildUrl({
          origin: origin?.lngLat ?? null,
          destination: destination?.lngLat ?? null,
          stops: stops.filter((p): p is Place => p != null).map((p) => p.lngLat),
          strictness,
          bufferM,
        }),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const exportGpx = () => {
    downloadFile(
      buildGpx(
        active,
        origin,
        stops.filter((p): p is Place => p != null),
        destination,
      ),
      'elude-route.gpx',
      'application/gpx+xml',
    );
  };

  return (
    <section className="summary" aria-label="Route summary">
      <div className="summary__top">
        <div>
          <div className="summary__time">{formatDuration(active.time)}</div>
          <div className="summary__dist">
            {formatDistance(active.distance, units)} <span>({formatDistanceAlt(active.distance, units)})</span>
          </div>
        </div>
        <div className="summary__actions">
          <button className="icon-btn" title={copied ? 'Link copied!' : 'Copy a shareable link to this route'} aria-label="Copy route link" onClick={() => void copyLink()}>
            {copied ? <IconCheck /> : <IconLink />}
          </button>
          <button className="icon-btn" title="Export GPX (open in OsmAnd, Garmin, …)" aria-label="Export GPX" onClick={exportGpx}>
            <IconDownload />
          </button>
          <button className="icon-btn" title="Fit route on map" aria-label="Fit route on map" onClick={() => sendMapCommand({ type: 'fit-route' })}>
            <IconMap />
          </button>
        </div>
      </div>

      {cards.length > 1 && (
        <div className="cards" role="group" aria-label="Route alternatives">
          {cards.map(({ path, label }) => {
            const isActive = path.kind === active.kind;
            const cams = path.camerasCrossed.length;
            return (
              <button key={path.kind} className={`card${isActive ? ' card--active' : ''}`} onClick={() => pick(path.kind)} aria-pressed={isActive}>
                <span className="card__label">{label}</span>
                <span className="card__time">{formatDuration(path.time)}</span>
                <span className="card__meta">
                  {formatDistance(path.distance, units)} · <span className={`card__cams ${cams === 0 ? 'card__cams--ok' : 'card__cams--bad'}`}>{cams === 0 ? 'no cameras' : `${cams} camera${cams === 1 ? '' : 's'}`}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <Shield route={route} path={active} />

      {fastest && fastest !== active && (
        <div className="compare">
          <div className="compare__row">
            <span className="compare__swatch compare__swatch--chosen" />
            <span>This route</span>
            <span className="compare__delta">{formatDuration(active.time)}</span>
          </div>
          <div className="compare__row">
            <span className="compare__swatch compare__swatch--fast" />
            <span>
              Fastest route: {formatDuration(fastest.time)}, crosses {fastest.camerasCrossed.length} camera{fastest.camerasCrossed.length === 1 ? '' : 's'}
            </span>
            <span className={`compare__delta${avoided > 0 ? ' compare__delta--good' : ''}`}>
              {formatDelta(deltaMs)}
              {avoided > 0 ? ` to avoid ${avoided}` : ''}
            </span>
          </div>
        </div>
      )}

      {facingAway > 0 && (
        <div className="unavoid unavoid--ok">
          {facingAway} directional camera{facingAway === 1 ? ' faces' : 's face'} away where this route passes — not counted as crossings.
        </div>
      )}

      {notVisible > 0 && (
        <div className="unavoid">
          {notVisible} crossing{notVisible === 1 ? '' : 's'} on a bridge or tunnel may not actually be visible to the camera (shown hollow on the map).
        </div>
      )}

      {route.unavoidable.length > 0 && (
        <div className="unavoid">
          Cameras within {route.bufferM} m of your start, stops, or destination can't be avoided:
          <ul>
            {route.unavoidable.map((c) => (
              <li key={c.properties.id}>
                <a href={`https://www.openstreetmap.org/node/${c.properties.id}`} target="_blank" rel="noopener noreferrer">
                  {c.properties.manufacturer ?? 'ALPR'} #{c.properties.id}
                </a>
                {c.properties.operator ? ` · ${c.properties.operator}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="summary__cta">
        <button className="btn btn--primary" onClick={() => startNav(false)}>
          <IconNav /> Start
        </button>
        <button className="btn btn--ghost" onClick={() => startNav(true)} title="Play back the route without GPS to see the alerts. Previews are not saved to the trip log.">
          <IconPlay /> Preview
        </button>
        <button className="btn btn--ghost" onClick={() => setSettingsOpen(true)} title="Adjust avoidance">
          Options
        </button>
      </div>

      {showDiagnostics && route.timings && Object.keys(route.timings).length > 0 && (
        <div className="timings">
          {Object.entries(route.timings)
            .map(([k, v]) => `${k} ${Math.round(v)}ms`)
            .join(' · ')}
        </div>
      )}
    </section>
  );
}
