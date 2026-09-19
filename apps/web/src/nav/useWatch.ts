import { useEffect, useRef } from 'react';
import type { BBox, CameraFeature, LngLat } from '@elude/shared';
import { getCameras, reverseGeocode } from '../api/client';
import { activeCategories, manufacturerParam, useStore } from '../state/store';
import { bearingDeg, haversineM } from '../util/geo';
import { speakDistance } from '../util/format';
import { stopSpeaking, unlockVoice } from './voice';
import { raiseCameraAlert, clearCameraAlert } from './alerts';

/** Half-size of the camera fetch window around the fix, metres. */
const FETCH_HALF_M = 1000;
/** Refetch once the fix leaves the inner half of the last window. */
const REFETCH_AT_M = FETCH_HALF_M / 2;
const APPROACH_M = { imperial: 305, metric: 300 };
/** GPS is 5–20 m on phones and there is no route to snap to; 30 m counts as passing. */
const PASS_M = 30;
/** Having been this close, moving away again also counts as a pass (parallel street). */
const NEAR_MISS_M = 60;
const NEARBY_M = 500;
/** Approach needs the fix to be closing in: heading within this of the bearing to the camera. */
const CLOSING_HEADING_DEG = 60;
const CLOSING_MIN_DELTA_M = 2;

interface CamTrack {
  minDist: number;
  prevDist: number;
  approached: boolean;
  passed: boolean;
}

function bearingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function bboxAround([lng, lat]: LngLat, halfM: number): BBox {
  const dLat = halfM / 111_320;
  const dLng = halfM / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
}

/**
 * Watch mode: GPS tracking without a route. Loads cameras around the fix,
 * alerts on approach/pass using straight-line distance, and records passes
 * into the trip draft exactly like navigation does.
 */
export function useWatch() {
  const active = useStore((s) => s.nav.active);
  const watch = useStore((s) => s.nav.watch);
  const cameras = useRef<Map<number, CameraFeature>>(new Map());
  const tracks = useRef<Map<number, CamTrack>>(new Map());
  const fetchCenter = useRef<LngLat | null>(null);
  const fetchAbort = useRef<AbortController | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!active || !watch) return;
    unlockVoice();
    cameras.current.clear();
    tracks.current.clear();
    fetchCenter.current = null;

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

    const refetch = (center: LngLat) => {
      fetchAbort.current?.abort();
      const ac = new AbortController();
      fetchAbort.current = ac;
      fetchCenter.current = center;
      const settings = useStore.getState().settings;
      const cats = activeCategories(settings.surveillanceAvoid);
      getCameras(bboxAround(center, FETCH_HALF_M), manufacturerParam(settings), cats.length ? cats : ['alpr'], ac.signal)
        .then((fc) => {
          if (ac.signal.aborted) return;
          for (const f of fc.features) cameras.current.set(f.properties.id, f);
        })
        .catch(() => {
          // Retry from the next fix.
          if (fetchCenter.current === center) fetchCenter.current = null;
        });
    };

    const processFix = (lngLat: LngLat, heading: number | null, speed: number | null) => {
      const state = useStore.getState();
      if (!state.nav.active) return;
      if (!fetchCenter.current || haversineM(fetchCenter.current, lngLat) > REFETCH_AT_M) refetch(lngLat);
      state.recordWatchFix(lngLat);
      const travelledM = state.tripDraft?.travelledM ?? 0;
      const units = state.settings.units;
      const alertsOn = state.settings.cameraAlerts;

      let nearby = 0;
      for (const cam of cameras.current.values()) {
        const camLngLat = cam.geometry.coordinates as LngLat;
        const dist = haversineM(lngLat, camLngLat);
        if (dist <= NEARBY_M) nearby++;
        let t = tracks.current.get(cam.properties.id);
        if (!t) {
          t = { minDist: dist, prevDist: dist, approached: false, passed: false };
          tracks.current.set(cam.properties.id, t);
        }
        if (t.passed) continue;
        const p = cam.properties;
        // A tagged camera pointed away from us cannot read the plate: informational only.
        const facingAway = p.direction !== undefined && bearingDiff(bearingDeg(camLngLat, lngLat), p.direction) > 90;
        const movingAway = t.minDist <= NEAR_MISS_M && dist > t.minDist + 10;

        if (dist <= PASS_M || movingAway) {
          t.passed = true;
          state.recordPass({
            at: new Date().toISOString(),
            cameraId: p.id,
            osmType: p.osmType,
            lngLat: camLngLat,
            manufacturer: p.manufacturer,
            operator: p.operator,
            direction: p.direction,
            distanceM: Math.round(Math.min(t.minDist, dist) * 10) / 10,
            possiblyNotVisible: false,
            ...(facingAway ? { facingAway } : {}),
            alongM: travelledM,
          });
          if (alertsOn) {
            raiseCameraAlert(
              { cameraId: p.id, phase: 'passing', distanceM: 0, manufacturer: p.manufacturer, possiblyNotVisible: false, facingAway, at: Date.now() },
              facingAway ? 'Passing camera, facing away' : 'Passing camera',
            );
          }
        } else if (!t.approached && dist <= APPROACH_M[units]) {
          const closing = dist < t.prevDist - CLOSING_MIN_DELTA_M || (heading != null && bearingDiff(heading, bearingDeg(lngLat, camLngLat)) <= CLOSING_HEADING_DEG);
          if (closing) {
            const shown =
              !alertsOn ||
              raiseCameraAlert(
                { cameraId: p.id, phase: 'approaching', distanceM: dist, manufacturer: p.manufacturer, possiblyNotVisible: false, facingAway, at: Date.now() },
                facingAway ? `Camera in ${speakDistance(dist, units)}, facing away` : `Camera in ${speakDistance(dist, units)}`,
              );
            if (shown) t.approached = true;
          }
        }
        t.prevDist = dist;
        if (dist < t.minDist) t.minDist = dist;
      }

      state.updateNav({ position: lngLat, heading, speedMps: speed, nearbyCount: nearby, gpsError: null });
    };

    let watchId: number | null = null;
    if (navigator.geolocation) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => processFix([pos.coords.longitude, pos.coords.latitude], pos.coords.heading, pos.coords.speed),
        (err) => {
          useStore.getState().updateNav({ gpsError: err.code === err.PERMISSION_DENIED ? 'Location permission denied. Allow location access to watch for cameras.' : 'Waiting for a GPS fix…' });
        },
        { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
      );
    } else {
      useStore.getState().updateNav({ gpsError: 'Geolocation is not available in this browser.' });
    }

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      fetchAbort.current?.abort();
      document.removeEventListener('visibilitychange', onVis);
      wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
      stopSpeaking();
      clearCameraAlert();
      // stopNav has already saved the trip with coordinate labels; swap in place names when the geocoder knows them.
      const trip = useStore.getState().trips[0];
      if (trip?.mode === 'watch' && trip.from && trip.to) {
        void Promise.all([reverseGeocode(trip.from), reverseGeocode(trip.to)])
          .then(([a, b]) => {
            const patch: { originLabel?: string; destinationLabel?: string } = {};
            if (a?.label) patch.originLabel = a.label;
            if (b?.label) patch.destinationLabel = b.label;
            if (patch.originLabel || patch.destinationLabel) useStore.getState().relabelTrip(trip.id, patch);
          })
          .catch(() => undefined);
      }
    };
  }, [active, watch]);
}
