import { useEffect, useRef } from 'react';
import type { LngLat } from '@elude/shared';
import { reverseGeocode } from '../api/client';
import { useStore, type Place, type PointRole } from '../state/store';
import { shortCoord } from '../util/format';
import { readUrlState, syncUrl } from '../util/urlState';

function coordPlace(lngLat: LngLat): Place {
  return { lngLat, label: shortCoord(lngLat) };
}

/** Best-effort human label for a URL-seeded point. */
function backfillLabel(role: PointRole | number, lngLat: LngLat): void {
  void reverseGeocode(lngLat)
    .then((r) => {
      if (!r?.label) return;
      const now = useStore.getState();
      if (typeof role === 'number') {
        const cur = now.stops[role];
        if (cur && cur.lngLat[0] === lngLat[0] && cur.lngLat[1] === lngLat[1]) now.setStop(role, { lngLat, label: r.label });
      } else {
        const cur = now[role];
        if (cur && cur.lngLat[0] === lngLat[0] && cur.lngLat[1] === lngLat[1]) now.setPlace(role, { lngLat, label: r.label });
      }
    })
    .catch(() => undefined);
}

function applySeed(): void {
  const st = readUrlState();
  if (!st) return;
  const s = useStore.getState();
  if (st.origin) s.setPlace('origin', coordPlace(st.origin));
  if (st.destination) s.setPlace('destination', coordPlace(st.destination));
  s.setStops(st.stops.map(coordPlace));
  if (st.strictness || st.bufferM != null) {
    s.updateSettings({ ...(st.strictness ? { strictness: st.strictness } : {}), ...(st.bufferM != null ? { bufferM: st.bufferM } : {}) });
  }
  if (st.origin) backfillLabel('origin', st.origin);
  if (st.destination) backfillLabel('destination', st.destination);
  st.stops.forEach((p, i) => backfillLabel(i, p));
}

let seeded = false;

/**
 * Apply ?from/?to/?via/?mode/?buf from the address bar to the store. Called
 * from main.tsx BEFORE React renders, so the first render already sees the
 * shared route (URL params beat persisted state). Waits for zustand persist
 * hydration when that happens asynchronously, so the persisted snapshot can
 * never clobber the seeded values.
 */
export function seedUrlState(): void {
  if (seeded) return;
  seeded = true;
  const persistApi = (useStore as unknown as { persist?: { hasHydrated?: () => boolean; onFinishHydration?: (fn: () => void) => void } }).persist;
  if (persistApi?.hasHydrated && !persistApi.hasHydrated() && persistApi.onFinishHydration) {
    persistApi.onFinishHydration(() => applySeed());
  } else {
    applySeed();
  }
}

/**
 * Keeps the address bar in sync with the route state (replaceState, no history
 * spam) so the current route is always shareable and refresh-proof.
 */
export function useUrlSync() {
  const origin = useStore((s) => s.origin);
  const destination = useStore((s) => s.destination);
  const stops = useStore((s) => s.stops);
  const strictness = useStore((s) => s.settings.strictness);
  const bufferM = useStore((s) => s.settings.bufferM);
  const first = useRef(true);

  useEffect(() => {
    // Skip the very first run so a not-yet-seeded render never rewrites the URL.
    if (first.current) {
      first.current = false;
      if (!origin && !destination) return;
    }
    syncUrl({
      origin: origin?.lngLat ?? null,
      destination: destination?.lngLat ?? null,
      stops: stops.filter((p): p is Place => p != null).map((p) => p.lngLat),
      strictness,
      bufferM,
    });
  }, [origin, destination, stops, strictness, bufferM]);
}
