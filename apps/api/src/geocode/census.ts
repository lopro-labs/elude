import type { GeocodeResult, LngLat } from '@elude/shared';
import { config } from '../config.js';
import type { GeocodeQuery } from './photon.js';

/**
 * US Census Bureau geocoder — free, no key, US-only, with real house-number
 * interpolation along street segments. Used as a fallback when the query looks
 * like a street address, since Photon only finds addresses explicitly tagged in
 * OpenStreetMap and does no interpolation.
 * https://geocoding.geo.census.gov/geocoder/  (onelineaddress / locations)
 */

interface CensusCoordinates {
  x?: number; // longitude
  y?: number; // latitude
}
interface CensusAddressComponents {
  city?: string;
  state?: string;
  zip?: string;
}
interface CensusMatch {
  matchedAddress?: string;
  coordinates?: CensusCoordinates;
  addressComponents?: CensusAddressComponents;
}
interface CensusResponse {
  result?: { addressMatches?: CensusMatch[] };
}

/**
 * Heuristic: does the query look like a US street address worth sending to the
 * Census geocoder? Requires a leading house number and at least a street name
 * (a couple more tokens), so we don't fire off requests for bare POIs or single
 * words while the user is still typing.
 */
export function looksLikeStreetAddress(q: string): boolean {
  const s = q.trim();
  // house number, then at least two more whitespace-separated tokens (street name + type/city)
  return /^\d{1,6}\s+\S+\s+\S+/.test(s);
}

/** Title-case a segment while keeping 2-letter state codes upper and zips/numbers intact. */
function titleSegment(seg: string): string {
  const t = seg.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase(); // state code
  if (/^\d[\d-]*$/.test(t)) return t; // zip / numeric
  return t
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(\d+)(St|Nd|Rd|Th)\b/gi, (_m, n, s) => `${n}${s.toLowerCase()}`); // 5Th -> 5th
}

function titleCaseAddress(s: string): string {
  return s
    .split(',')
    .map((seg) => titleSegment(seg))
    .join(', ');
}

export function censusMatchToResult(m: CensusMatch): GeocodeResult | null {
  const x = m.coordinates?.x;
  const y = m.coordinates?.y;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  const matched = (m.matchedAddress ?? '').trim();
  if (!matched) return null;
  const pretty = titleCaseAddress(matched);
  const segments = pretty.split(',').map((s) => s.trim());
  const name = segments[0] || pretty; // street line ("123 Main St")
  const a = m.addressComponents ?? {};
  const result: GeocodeResult = {
    label: pretty,
    name,
    lngLat: [x, y] as LngLat,
    type: 'address',
  };
  if (a.city) result.city = titleSegment(a.city);
  if (a.state) result.state = a.state.toUpperCase();
  if (a.zip) result.postcode = a.zip;
  return result;
}

export async function geocodeCensus(query: GeocodeQuery, fetchImpl: typeof fetch = fetch): Promise<GeocodeResult[]> {
  const url = new URL(`${config.censusUrl}/geocoder/locations/onelineaddress`);
  url.searchParams.set('address', query.q);
  url.searchParams.set('benchmark', 'Public_AR_Current');
  url.searchParams.set('format', 'json');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3500);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': config.userAgent }, signal: ac.signal });
    if (!res.ok) throw new Error(`Census geocoder responded ${res.status}`);
    const json = (await res.json()) as CensusResponse;
    const matches = json.result?.addressMatches ?? [];
    const out: GeocodeResult[] = [];
    for (const m of matches) {
      const r = censusMatchToResult(m);
      if (r) out.push(r);
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}
