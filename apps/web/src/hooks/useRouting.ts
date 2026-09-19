import { useEffect, useRef } from 'react';
import { describeError, postRoute } from '../api/client';
import { activeCategories, avoidanceToSoftFactor, manufacturerParam, useStore, type Place } from '../state/store';

/**
 * Automatically requests a route whenever both points are set or the
 * avoidance settings change (debounced, cancellable). Paused while navigating,
 * where the nav hook owns re-routing.
 */
export function useRouting() {
  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);
  const stops = useStore((s) => s.stops);
  const bufferM = useStore((s) => s.settings.bufferM);
  const avoidance = useStore((s) => s.settings.avoidance);
  const strictness = useStore((s) => s.settings.strictness);
  const directionAware = useStore((s) => s.settings.directionAware);
  const manufacturerFilter = useStore((s) => s.settings.manufacturerFilter);
  const manufacturerCustom = useStore((s) => s.settings.manufacturerCustom);
  const surveillanceAvoid = useStore((s) => s.settings.surveillanceAvoid);
  const zones = useStore((s) => s.zones);
  const navActive = useStore((s) => s.nav.active);
  const avoidCatsKey = activeCategories(surveillanceAvoid).join(',');
  const zonesKey = zones.map((z) => z.id).join(',');
  const abortRef = useRef<AbortController | null>(null);
  const firstFit = useRef(true);

  // Only re-request when the coordinates of filled stops change (not while an
  // empty stop row is being added / edited).
  const waypointsKey = stops
    .filter((p): p is Place => p != null)
    .map((p) => p.lngLat.join(','))
    .join('|');

  useEffect(() => {
    if (navActive) return;
    const store = useStore.getState();
    abortRef.current?.abort();
    if (!origin || !destination) {
      store.setRoute(null);
      store.setRouteError(null);
      store.setRouteLoading(false);
      firstFit.current = true;
      return;
    }
    const ac = new AbortController();
    abortRef.current = ac;
    const timer = window.setTimeout(async () => {
      store.setRouteLoading(true);
      store.setRouteError(null);
      try {
        const s = useStore.getState().settings;
        const waypoints = useStore
          .getState()
          .stops.filter((p): p is Place => p != null)
          .map((p) => p.lngLat);
        const avoidCategories = activeCategories(s.surveillanceAvoid);
        const avoidZones = useStore.getState().zones.map((z) => z.zone);
        const res = await postRoute(
          {
            origin: origin.lngLat,
            destination: destination.lngLat,
            ...(waypoints.length ? { waypoints } : {}),
            bufferM: s.bufferM,
            softFactor: avoidanceToSoftFactor(s.avoidance),
            strictness: s.strictness,
            manufacturer: manufacturerParam(s),
            directionAware: s.directionAware,
            ...(avoidCategories.length ? { avoidCategories } : {}),
            ...(avoidZones.length ? { avoidZones } : {}),
          },
          ac.signal,
        );
        if (ac.signal.aborted) return;
        const st = useStore.getState();
        st.setRoute(res);
        st.sendMapCommand({ type: 'fit-route' });
        firstFit.current = false;
      } catch (err) {
        if (ac.signal.aborted || (err as Error).name === 'AbortError') return;
        const st = useStore.getState();
        st.setRoute(null);
        st.setRouteError(describeError(err));
      } finally {
        if (!ac.signal.aborted) useStore.getState().setRouteLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      ac.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, destination, waypointsKey, bufferM, avoidance, strictness, directionAware, manufacturerFilter, manufacturerCustom, avoidCatsKey, zonesKey, navActive]);
}
