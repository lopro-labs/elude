import type { GeocodeResult, LngLat } from '@elude/shared';
import { config } from '../config.js';

interface NominatimReverse {
  place_id?: number;
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  display_name?: string;
  type?: string;
  category?: string;
  address?: Record<string, string>;
  error?: string;
}

const CACHE_TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; value: GeocodeResult | null }>();

function cacheKey(lat: number, lon: number): string {
  // ~1 m precision – close enough for map taps.
  return `${lat.toFixed(5)},${lon.toFixed(5)}`;
}

export function clearReverseCache(): void {
  cache.clear();
}

export function nominatimToResult(r: NominatimReverse, fallback: LngLat): GeocodeResult | null {
  if (r.error) return null;
  const a = r.address ?? {};
  const lat = r.lat ? Number(r.lat) : fallback[1];
  const lon = r.lon ? Number(r.lon) : fallback[0];
  const streetLine = [a.road, a.house_number].filter(Boolean).join(' ');
  const city = a.city || a.town || a.village || a.hamlet || a.municipality || a.county;
  const name = r.name || streetLine || city || r.display_name?.split(',')[0] || 'Unknown location';
  const parts: string[] = [name];
  if (streetLine && streetLine !== name) parts.push(streetLine);
  if (city && city !== name) parts.push(city);
  if (a.state && a.state !== name) parts.push(a.state);
  const result: GeocodeResult = {
    label: [...new Set(parts)].join(', '),
    name,
    lngLat: [lon, lat],
  };
  if (city) result.city = city;
  if (a.state) result.state = a.state;
  if (a.country) result.country = a.country;
  if (a.postcode) result.postcode = a.postcode;
  if (typeof r.osm_id === 'number') result.osmId = r.osm_id;
  if (r.type) result.type = r.type;
  return result;
}

export async function reverseGeocode(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch = fetch,
): Promise<GeocodeResult | null> {
  const key = cacheKey(lat, lon);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const url = new URL(`${config.nominatimUrl}/reverse`);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('zoom', '18');
  url.searchParams.set('addressdetails', '1');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': config.userAgent, 'Accept-Language': 'en' },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`);
    const json = (await res.json()) as NominatimReverse;
    const value = nominatimToResult(json, [lon, lat]);
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 5000) {
      // crude eviction: drop the oldest half
      const entries = [...cache.entries()].sort((x, y) => x[1].at - y[1].at);
      for (const [k] of entries.slice(0, entries.length / 2)) cache.delete(k);
    }
    return value;
  } finally {
    clearTimeout(timer);
  }
}
