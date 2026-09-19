import type { GeocodeResult, LngLat } from '@elude/shared';
import { config } from '../config.js';

interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  district?: string;
  locality?: string;
  county?: string;
  state?: string;
  country?: string;
  postcode?: string;
  osm_id?: number;
  osm_type?: string;
  osm_key?: string;
  osm_value?: string;
  type?: string;
}

interface PhotonFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: number[] };
  properties: PhotonProps;
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

export function photonFeatureToResult(f: PhotonFeature): GeocodeResult | null {
  const p = f.properties ?? {};
  const [lon, lat] = f.geometry?.coordinates ?? [];
  if (typeof lon !== 'number' || typeof lat !== 'number') return null;
  const streetLine = [p.street, p.housenumber].filter(Boolean).join(' ');
  const name = p.name || streetLine || p.city || p.state || p.country || 'Unnamed place';
  const parts: string[] = [name];
  if (streetLine && streetLine !== name) parts.push(streetLine);
  const locality = p.city || p.district || p.locality || p.county;
  if (locality && locality !== name) parts.push(locality);
  if (p.state && p.state !== name) parts.push(p.state);
  if (p.country && p.country !== 'United States' && p.country !== 'United States of America' && p.country !== name) {
    parts.push(p.country);
  }
  const result: GeocodeResult = {
    label: [...new Set(parts)].join(', '),
    name,
    lngLat: [lon, lat] as LngLat,
  };
  if (locality) result.city = locality;
  if (p.state) result.state = p.state;
  if (p.country) result.country = p.country;
  if (p.postcode) result.postcode = p.postcode;
  if (typeof p.osm_id === 'number') result.osmId = p.osm_id;
  const type = p.osm_value || p.type;
  if (type) result.type = type;
  return result;
}

export interface GeocodeQuery {
  q: string;
  lat?: number;
  lon?: number;
  limit?: number;
}

export async function geocode(query: GeocodeQuery, fetchImpl: typeof fetch = fetch): Promise<GeocodeResult[]> {
  const url = new URL(`${config.photonUrl}/api`);
  url.searchParams.set('q', query.q);
  url.searchParams.set('limit', String(query.limit ?? 6));
  url.searchParams.set('lang', 'en');
  if (typeof query.lat === 'number' && typeof query.lon === 'number') {
    url.searchParams.set('lat', String(query.lat));
    url.searchParams.set('lon', String(query.lon));
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const res = await fetchImpl(url, { headers: { 'User-Agent': config.userAgent }, signal: ac.signal });
    if (!res.ok) throw new Error(`Photon responded ${res.status}`);
    const json = (await res.json()) as PhotonResponse;
    const out: GeocodeResult[] = [];
    for (const f of json.features ?? []) {
      const r = photonFeatureToResult(f);
      if (r) out.push(r);
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}
