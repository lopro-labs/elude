import { describe, expect, it } from 'vitest';
import { parseDirection, parseDirectionValue } from '../src/cameras/overpass.js';

describe('parseDirectionValue', () => {
  it('parses numeric degrees and normalizes to [0,360)', () => {
    expect(parseDirectionValue('90')).toBe(90);
    expect(parseDirectionValue('0')).toBe(0);
    expect(parseDirectionValue('360')).toBe(0);
    expect(parseDirectionValue('450')).toBe(90);
    expect(parseDirectionValue('-90')).toBe(270);
    expect(parseDirectionValue('22.5')).toBe(22.5);
    expect(parseDirectionValue(' 135 ')).toBe(135);
  });

  it('parses 16-wind cardinals case-insensitively', () => {
    expect(parseDirectionValue('N')).toBe(0);
    expect(parseDirectionValue('ne')).toBe(45);
    expect(parseDirectionValue('ENE')).toBe(67.5);
    expect(parseDirectionValue('south')).toBe(180);
    expect(parseDirectionValue('North-East')).toBe(45);
    expect(parseDirectionValue('ssw')).toBe(202.5);
    expect(parseDirectionValue('w')).toBe(270);
  });

  it('strips a degree suffix on a single clean value', () => {
    expect(parseDirectionValue('360°')).toBe(0);
    expect(parseDirectionValue('45°')).toBe(45);
    expect(parseDirectionValue('45 °')).toBe(45);
  });

  it('returns undefined for ranges', () => {
    expect(parseDirectionValue('90-180')).toBeUndefined();
    expect(parseDirectionValue('0-360')).toBeUndefined();
  });

  it('returns undefined for multi-values', () => {
    expect(parseDirectionValue('45;225')).toBeUndefined();
    expect(parseDirectionValue('N;S')).toBeUndefined();
    expect(parseDirectionValue('45,225')).toBeUndefined();
  });

  it('returns undefined for junk / empty', () => {
    expect(parseDirectionValue('forward')).toBeUndefined();
    expect(parseDirectionValue('')).toBeUndefined();
    expect(parseDirectionValue('   ')).toBeUndefined();
    expect(parseDirectionValue(undefined)).toBeUndefined();
    expect(parseDirectionValue('12deg34')).toBeUndefined();
    expect(parseDirectionValue('NaN')).toBeUndefined();
    expect(parseDirectionValue('90°N')).toBeUndefined();
  });
});

describe('parseDirection', () => {
  it('prefers camera:direction over direction', () => {
    expect(parseDirection({ 'camera:direction': '10', direction: '20' })).toBe(10);
    expect(parseDirection({ direction: 'W' })).toBe(270);
  });

  it('handles missing tags', () => {
    expect(parseDirection(undefined)).toBeUndefined();
    expect(parseDirection({})).toBeUndefined();
    expect(parseDirection({ manufacturer: 'Flock Safety' })).toBeUndefined();
  });
});
