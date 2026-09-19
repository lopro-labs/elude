import { useEffect, useRef } from 'react';
import type { LngLat, RoutePath } from '@elude/shared';
import { postRoute } from '../api/client';
import { activeCategories, activePath, avoidanceToSoftFactor, manufacturerParam, useStore, type Place } from '../state/store';
import { cumulativeDistances, instructionIndexForPoint, pointAlong, snapToRoute } from '../util/geo';
import { speakDistance } from '../util/format';
import { maneuverLabel } from '../icons/ManeuverIcon';
import { speak, stopSpeaking, unlockVoice } from './voice';
import { clearCameraAlert, raiseCameraAlert } from './alerts';

const OFF_ROUTE_M = 50;
const OFF_ROUTE_FIXES = 3;
const ADVANCE_M = 20;
const ARRIVE_M = 25;
const SIM_STEP_M = 25;
const SIM_TICK_MS = 1000;
const FAR_ANNOUNCE_M = { imperial: 305, metric: 300 }; // ~1000 ft / 300 m
const NEAR_ANNOUNCE_M = 50;
const CAM_APPROACH_M = { imperial: 305, metric: 300 };
const CAM_PASS_M = 15;

interface Fix {
  lngLat: LngLat;
  heading: number | null;
  speed: number | null;
}

/** Spoken phrase for an instruction. */
function phrase(path: RoutePath, i: number): string {
  const ins = path.instructions[i];
  if (!ins) return '';
  if (ins.sign === 4) return 'You will arrive at your destination';
  const text = ins.text?.trim();
  if (text) return text.replace(/\bonto\b/g, 'onto');
  return `${maneuverLabel(ins.sign)}${ins.streetName ? ` onto ${ins.streetName}` : ''}`;
}

/**
 * Drives navigation state: GPS (or simulation) → snap to route → current step,
 * distance to maneuver, ETA, voice prompts, off-route re-routing, wake lock.
 */
export function useNavigation() {
  const active = useStore((s) => s.nav.active);
  const simulate = useStore((s) => s.nav.simulate);
  const watch = useStore((s) => s.nav.watch);
  const route = useStore((s) => s.route);
  const selectedKind = useStore((s) => s.selectedKind);
  const chosen = activePath(route, selectedKind);

  const cumRef = useRef<number[]>([]);
  const announced = useRef<Set<string>>(new Set());
  const offRouteCount = useRef(0);
  const rerouting = useRef(false);
  const simAlong = useRef(0);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const routeVersion = useRef(0);

  // Recompute cumulative distances whenever the route changes while navigating.
  useEffect(() => {
    if (!chosen) return;
    cumRef.current = cumulativeDistances(chosen.points);
    announced.current.clear();
    routeVersion.current += 1;
    // Reset simulation to the start of the (new) route.
    simAlong.current = 0;
  }, [chosen]);

  useEffect(() => {
    if (!active || watch || !chosen) return;
    const store = useStore.getState();
    unlockVoice();

    // Wake lock keeps the screen on while driving.
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) wakeLock.current = await navigator.wakeLock.request('screen');
      } catch {
        /* not available */
      }
    };
    void requestWakeLock();
    const onVis = () => {
      if (document.visibilityState === 'visible' && useStore.getState().nav.active) void requestWakeLock();
    };
    document.addEventListener('visibilitychange', onVis);

    // First instruction spoken immediately.
    if (store.settings.voice && chosen.instructions.length) {
      speak(phrase(chosen, 0));
      announced.current.add('0:near');
      announced.current.add('0:far');
    }

    let watchId: number | null = null;
    let simTimer: number | null = null;

    const processFix = (fix: Fix) => {
      const state = useStore.getState();
      const path = activePath(state.route, state.selectedKind);
      if (!path || !state.nav.active) return;
      const cum = cumRef.current.length === path.points.length ? cumRef.current : (cumRef.current = cumulativeDistances(path.points));
      const total = cum[cum.length - 1] || 1;
      const snap = snapToRoute(fix.lngLat, path, cum);
      if (!snap) return;

      // Heading: GPS if moving, otherwise the route segment direction.
      const segIdx = Math.min(snap.index, path.points.length - 2);
      const a = path.points[segIdx];
      const b = path.points[segIdx + 1];
      let heading = fix.heading;
      if (heading == null || Number.isNaN(heading) || (fix.speed != null && fix.speed < 1)) {
        heading = a && b ? bearingSimple(a, b) : null;
      }

      // Off-route detection
      const off = snap.offRouteM > OFF_ROUTE_M;
      offRouteCount.current = off ? offRouteCount.current + 1 : 0;
      const isOffRoute = offRouteCount.current >= OFF_ROUTE_FIXES;

      // Upcoming instruction: the one after the interval we are inside.
      const curIns = instructionIndexForPoint(path, snap.index);
      let stepIndex = Math.min(curIns + 1, path.instructions.length - 1);
      const startOf = (i: number) => cum[Math.min(path.instructions[i].interval[0], cum.length - 1)];
      let distToManeuver = Math.max(0, startOf(stepIndex) - snap.alongM);
      if (distToManeuver < ADVANCE_M && stepIndex < path.instructions.length - 1) {
        stepIndex += 1;
        distToManeuver = Math.max(0, startOf(stepIndex) - snap.alongM);
      }
      const remainingM = Math.max(0, total - snap.alongM);
      const remainingMs = path.time * (remainingM / total);
      const arrived = remainingM < ARRIVE_M;

      state.updateNav({
        position: fix.lngLat,
        heading,
        speedMps: fix.speed,
        snapped: snap.lngLat,
        snappedIndex: snap.index,
        alongM: snap.alongM,
        stepIndex,
        distToManeuverM: distToManeuver,
        remainingM,
        remainingMs,
        offRoute: isOffRoute,
        arrived,
        gpsError: null,
      });
      state.setHighlightedStep(stepIndex);

      // Camera approach / pass detection (always runs: the trip log records passes even with alerts muted)
      for (const cam of path.camerasCrossed) {
        const camAlong = cum[Math.min(cam.pathIndex, cum.length - 1)];
        const dist = camAlong - snap.alongM;
        const passKey = `cam:${cam.id}:pass`;
        const nearKey = `cam:${cam.id}:near`;
        if (dist <= CAM_PASS_M && !announced.current.has(passKey)) {
          announced.current.add(passKey);
          announced.current.add(nearKey);
          state.recordPass({
            at: new Date().toISOString(),
            cameraId: cam.id,
            osmType: cam.osmType ?? 'node',
            lngLat: cam.lngLat,
            manufacturer: cam.manufacturer,
            operator: cam.operator,
            direction: cam.direction,
            distanceM: cam.distanceM,
            possiblyNotVisible: cam.possiblyNotVisible,
            alongM: camAlong,
          });
          if (state.settings.cameraAlerts) {
            raiseCameraAlert({ cameraId: cam.id, phase: 'passing', distanceM: 0, manufacturer: cam.manufacturer, possiblyNotVisible: cam.possiblyNotVisible, at: Date.now() }, 'Passing camera');
          }
        } else if (dist > CAM_PASS_M && dist <= CAM_APPROACH_M[state.settings.units] && !announced.current.has(nearKey)) {
          // Only mark announced once actually shown; a deferred approach retries on the next fix.
          const shown =
            !state.settings.cameraAlerts ||
            raiseCameraAlert(
              { cameraId: cam.id, phase: 'approaching', distanceM: dist, manufacturer: cam.manufacturer, possiblyNotVisible: cam.possiblyNotVisible, at: Date.now() },
              `Camera in ${speakDistance(dist, state.settings.units)}`,
            );
          if (shown) announced.current.add(nearKey);
        }
      }

      // Voice prompts
      if (state.settings.voice) {
        const units = state.settings.units;
        const farKey = `${stepIndex}:far`;
        const nearKey = `${stepIndex}:near`;
        if (arrived && !announced.current.has('arrived')) {
          announced.current.add('arrived');
          speak('You have arrived at your destination.');
        } else if (distToManeuver <= NEAR_ANNOUNCE_M && !announced.current.has(nearKey)) {
          announced.current.add(nearKey);
          announced.current.add(farKey);
          speak(phrase(path, stepIndex));
        } else if (distToManeuver <= FAR_ANNOUNCE_M[units] && !announced.current.has(farKey)) {
          announced.current.add(farKey);
          speak(`In ${speakDistance(distToManeuver, units)}, ${phrase(path, stepIndex).replace(/^./, (c) => c.toLowerCase())}`);
        }
      }

      // Re-route when persistently off route
      if (isOffRoute && !rerouting.current && state.destination) {
        rerouting.current = true;
        state.updateNav({ rerouting: true });
        if (state.settings.voice) speak('Rerouting');
        const s = state.settings;
        // Keep only the stops still ahead of us on the current route.
        const remainingStops = state.stops
          .filter((p): p is Place => p != null)
          .filter((p) => {
            const sn = snapToRoute(p.lngLat, path, cum);
            return sn ? sn.alongM > snap.alongM + 100 : true;
          })
          .map((p) => p.lngLat);
        const avoidCategories = activeCategories(s.surveillanceAvoid);
        const avoidZones = state.zones.map((z) => z.zone);
        postRoute({
          origin: fix.lngLat,
          destination: state.destination.lngLat,
          ...(remainingStops.length ? { waypoints: remainingStops } : {}),
          bufferM: s.bufferM,
          softFactor: avoidanceToSoftFactor(s.avoidance),
          strictness: s.strictness,
          manufacturer: manufacturerParam(s),
          directionAware: s.directionAware,
          ...(avoidCategories.length ? { avoidCategories } : {}),
          ...(avoidZones.length ? { avoidZones } : {}),
        })
          .then((res) => {
            const now = useStore.getState();
            if (!now.nav.active) return;
            now.setRoute(res);
            offRouteCount.current = 0;
            now.updateNav({ rerouting: false, offRoute: false });
            simAlong.current = 0;
          })
          .catch(() => {
            const now = useStore.getState();
            now.updateNav({ rerouting: false });
          })
          .finally(() => {
            rerouting.current = false;
          });
      }
    };

    if (simulate) {
      // Playback along the route: advance SIM_STEP_M per tick.
      const tick = () => {
        const s = useStore.getState();
        const path = activePath(s.route, s.selectedKind);
        if (!path || !s.nav.active) return;
        const cum = cumRef.current.length === path.points.length ? cumRef.current : (cumRef.current = cumulativeDistances(path.points));
        const total = cum[cum.length - 1];
        const along = Math.min(total, simAlong.current);
        const p = pointAlong(path.points, cum, along);
        processFix({ lngLat: p.lngLat, heading: p.heading, speed: SIM_STEP_M / (SIM_TICK_MS / 1000) });
        if (along >= total) return; // arrived; stop advancing
        simAlong.current = along + SIM_STEP_M;
      };
      tick();
      simTimer = window.setInterval(tick, SIM_TICK_MS);
    } else if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          processFix({
            lngLat: [pos.coords.longitude, pos.coords.latitude],
            heading: pos.coords.heading,
            speed: pos.coords.speed,
          });
        },
        (err) => {
          useStore.getState().updateNav({ gpsError: err.code === err.PERMISSION_DENIED ? 'Location permission denied. Allow location access or use Simulate.' : 'Waiting for a GPS fix…' });
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
      );
    } else {
      useStore.getState().updateNav({ gpsError: 'Geolocation is not available in this browser.' });
    }

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (simTimer) window.clearInterval(simTimer);
      document.removeEventListener('visibilitychange', onVis);
      wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
      stopSpeaking();
      clearCameraAlert();
      offRouteCount.current = 0;
      rerouting.current = false;
      useStore.getState().setHighlightedStep(null);
    };
    // Intentionally only re-run when nav starts/stops or mode changes; route changes are read from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, watch, simulate]);
}

function bearingSimple(a: LngLat, b: LngLat): number {
  const toRad = Math.PI / 180;
  const φ1 = a[1] * toRad;
  const φ2 = b[1] * toRad;
  const Δλ = (b[0] - a[0]) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
