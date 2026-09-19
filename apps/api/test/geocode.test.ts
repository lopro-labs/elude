import { describe, expect, it } from 'vitest';
import type { GeocodeResult } from '@elude/shared';
import { censusMatchToResult, looksLikeStreetAddress } from '../src/geocode/census.js';
import { searchGeocode } from '../src/geocode/search.js';
import type { GeocodeQuery } from '../src/geocode/photon.js';

describe('looksLikeStreetAddress', () => {
  it('accepts a house number + street name', () => {
    expect(looksLikeStreetAddress('123 Main St')).toBe(true);
    expect(looksLikeStreetAddress('1600 Amphitheatre Parkway')).toBe(true);
    expect(looksLikeStreetAddress('  742 Evergreen Terrace  ')).toBe(true);
  });
  it('rejects bare POIs / partial input', () => {
    expect(looksLikeStreetAddress('Blue Bottle Coffee')).toBe(false);
    expect(looksLikeStreetAddress('Springfield')).toBe(false);
    expect(looksLikeStreetAddress('123')).toBe(false);
    expect(looksLikeStreetAddress('123 Main')).toBe(false); // needs street + one more token
  });
});

describe('censusMatchToResult', () => {
  it('maps a match to a titled GeocodeResult', () => {
    const r = censusMatchToResult({
      matchedAddress: '123 MAIN ST, SPRINGFIELD, IL, 62701',
      coordinates: { x: -89.65, y: 39.78 },
      addressComponents: { city: 'SPRINGFIELD', state: 'IL', zip: '62701' },
    })!;
    expect(r).not.toBeNull();
    expect(r.lngLat).toEqual([-89.65, 39.78]);
    expect(r.name).toBe('123 Main St');
    expect(r.label).toBe('123 Main St, Springfield, IL, 62701');
    expect(r.city).toBe('Springfield');
    expect(r.state).toBe('IL');
    expect(r.postcode).toBe('62701');
    expect(r.type).toBe('address');
  });
  it('returns null without coordinates', () => {
    expect(censusMatchToResult({ matchedAddress: '1 X St' })).toBeNull();
  });
});

const res = (name: string, lng: number, lat: number): GeocodeResult => ({ label: name, name, lngLat: [lng, lat] });

describe('searchGeocode', () => {
  const q: GeocodeQuery = { q: '123 Main St, Springfield', limit: 5 };

  it('puts Census address matches ahead of Photon for street queries', async () => {
    const out = await searchGeocode(q, {
      photon: async () => [res('Some Main Street POI', -121.4, 38.5)],
      census: async () => [res('123 Main St, Springfield', -89.65, 39.78)],
      isAddress: () => true,
    });
    expect(out[0].name).toBe('123 Main St, Springfield');
    expect(out).toHaveLength(2);
  });

  it('deduplicates a Photon result that coincides with a Census match', async () => {
    const out = await searchGeocode(q, {
      photon: async () => [res('123 Main St (OSM)', -89.65001, 39.78001)], // ~1 m away
      census: async () => [res('123 Main St, Springfield', -89.65, 39.78)],
      isAddress: () => true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('123 Main St, Springfield');
  });

  it('does not call Census for non-address queries', async () => {
    let censusCalled = false;
    const out = await searchGeocode(
      { q: 'Blue Bottle Coffee' },
      {
        photon: async () => [res('Blue Bottle Coffee', -122.2, 37.8)],
        census: async () => {
          censusCalled = true;
          return [];
        },
        isAddress: () => false,
      },
    );
    expect(censusCalled).toBe(false);
    expect(out).toHaveLength(1);
  });

  it('still returns Photon results when Census throws', async () => {
    const out = await searchGeocode(q, {
      photon: async () => [res('Fallback POI', -121.4, 38.5)],
      census: async () => {
        throw new Error('census down');
      },
      isAddress: () => true,
    });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Fallback POI');
  });

  it('respects the limit', async () => {
    const out = await searchGeocode(
      { q: 'x', limit: 2 },
      {
        photon: async () => [res('a', 0, 0), res('b', 1, 1), res('c', 2, 2)],
        census: async () => [],
        isAddress: () => false,
      },
    );
    expect(out).toHaveLength(2);
  });
});
