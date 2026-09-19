import { describe, expect, it } from 'vitest';
import type { BBox } from '@elude/shared';
import { buildCategoryQuery, categoriseTags, elementToFeature } from '../src/cameras/overpass.js';

describe('categoriseTags', () => {
  it('classifies ALPR first', () => {
    expect(categoriseTags({ 'surveillance:type': 'ALPR' })).toBe('alpr');
    expect(categoriseTags({ 'surveillance:type': 'alpr', man_made: 'surveillance' })).toBe('alpr');
    // ALPR wins even if speed-ish tags are present
    expect(categoriseTags({ 'surveillance:type': 'ALPR', enforcement: 'maxspeed' })).toBe('alpr');
  });

  it('classifies speed cameras', () => {
    expect(categoriseTags({ highway: 'speed_camera' })).toBe('speed');
    expect(categoriseTags({ enforcement: 'maxspeed' })).toBe('speed');
    expect(categoriseTags({ enforcement: 'average_speed' })).toBe('speed');
    expect(categoriseTags({ 'surveillance:type': 'speed_camera' })).toBe('speed');
  });

  it('classifies red-light cameras', () => {
    expect(categoriseTags({ enforcement: 'traffic_signals' })).toBe('redlight');
    expect(categoriseTags({ enforcement: 'red_light' })).toBe('redlight');
    expect(categoriseTags({ 'surveillance:type': 'traffic_signals' })).toBe('redlight');
  });

  it('falls back to generic CCTV', () => {
    expect(categoriseTags({ man_made: 'surveillance' })).toBe('cctv');
    expect(categoriseTags({ 'surveillance:type': 'camera' })).toBe('cctv');
    expect(categoriseTags({ 'surveillance:type': 'public' })).toBe('cctv');
    expect(categoriseTags({})).toBe('cctv');
  });

  it('is applied by elementToFeature', () => {
    const f = elementToFeature({ type: 'node', id: 1, lat: 37, lon: -122, tags: { 'surveillance:type': 'ALPR' } });
    expect(f?.properties.category).toBe('alpr');
    const g = elementToFeature({ type: 'node', id: 2, lat: 37, lon: -122, tags: { highway: 'speed_camera' } });
    expect(g?.properties.category).toBe('speed');
  });
});

describe('buildCategoryQuery', () => {
  const bbox: BBox = [-122.5, 37.7, -122.3, 37.9];

  it('emits only the clauses for the requested categories', () => {
    const alprOnly = buildCategoryQuery(bbox, ['alpr']);
    expect(alprOnly).toContain('surveillance:type');
    expect(alprOnly).toContain('ALPR');
    expect(alprOnly).not.toContain('speed_camera');

    const speed = buildCategoryQuery(bbox, ['speed']);
    expect(speed).toContain('speed_camera');
    expect(speed).toContain('enforcement');

    const cctv = buildCategoryQuery(bbox, ['cctv']);
    expect(cctv).toContain('man_made');

    const redlight = buildCategoryQuery(bbox, ['redlight']);
    expect(redlight).toContain('traffic_signals');
  });

  it('combines multiple categories', () => {
    const q = buildCategoryQuery(bbox, ['speed', 'redlight']);
    expect(q).toContain('speed_camera');
    expect(q).toContain('traffic_signals');
    // bbox coords appear (south,west,north,east)
    expect(q).toContain('37.7,-122.5,37.9,-122.3');
  });
});
