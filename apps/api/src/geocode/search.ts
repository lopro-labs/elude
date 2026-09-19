import type { GeocodeResult } from '@elude/shared';
import { config } from '../config.js';
import { haversineM } from '../util/geo.js';
import { geocode as photonGeocode, type GeocodeQuery } from './photon.js';
import { geocodeCensus, looksLikeStreetAddress } from './census.js';

export interface SearchDeps {
  photon?: (q: GeocodeQuery) => Promise<GeocodeResult[]>;
  census?: (q: GeocodeQuery) => Promise<GeocodeResult[]>;
  /** override the address heuristic (tests) */
  isAddress?: (q: string) => boolean;
}

/** Two results refer to the same place if their points are within this distance. */
const DEDUPE_M = 45;

function samePlace(a: GeocodeResult, b: GeocodeResult): boolean {
  return haversineM(a.lngLat, b.lngLat) <= DEDUPE_M;
}

/**
 * Address search: Photon for POIs / typeahead, plus the US Census geocoder as a
 * fallback for street addresses (real house-number interpolation). Census
 * matches are surfaced first (they are precise), then Photon results with
 * near-duplicates removed. Either source failing is non-fatal.
 */
export async function searchGeocode(query: GeocodeQuery, deps: SearchDeps = {}): Promise<GeocodeResult[]> {
  const limit = query.limit ?? 6;
  const photon = deps.photon ?? ((q) => photonGeocode(q));
  const census = deps.census ?? ((q) => geocodeCensus(q));
  const isAddress = deps.isAddress ?? looksLikeStreetAddress;

  const useCensus = config.censusFallback && isAddress(query.q);
  const [photonSettled, censusSettled] = await Promise.allSettled([
    photon(query),
    useCensus ? census(query) : Promise.resolve<GeocodeResult[]>([]),
  ]);

  const photonResults = photonSettled.status === 'fulfilled' ? photonSettled.value : [];
  const censusResults = censusSettled.status === 'fulfilled' ? censusSettled.value : [];
  // If Photon failed but Census succeeded (or vice versa) we still return what we have.

  const merged: GeocodeResult[] = [];
  const take = (r: GeocodeResult): void => {
    if (merged.length >= limit) return;
    if (merged.some((m) => samePlace(m, r))) return;
    merged.push(r);
  };
  // Census first (at most 3 precise address hits), then Photon fills the rest.
  for (const r of censusResults.slice(0, 3)) take(r);
  for (const r of photonResults) take(r);
  return merged;
}
