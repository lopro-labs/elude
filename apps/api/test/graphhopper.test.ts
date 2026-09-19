import { describe, expect, it } from 'vitest';
import { avoidCustomModel, avoidCustomModelMulti } from '../src/routing/graphhopper.js';
import type { AvoidFeature } from '../src/routing/avoidGeometry.js';

function area(id: string): AvoidFeature {
  return {
    type: 'Feature',
    id,
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [1, 0],
          [0, 0],
        ],
      ],
    },
  };
}

describe('avoidCustomModelMulti', () => {
  it('emits two distinct in_<id> rule sets and collects both areas', () => {
    const model = avoidCustomModelMulti([
      { area: area('cams'), factor: 0 },
      { area: area('zones'), factor: 0, hardBlock: true },
    ]);
    expect(model.areas?.features.map((f) => f.id)).toEqual(['cams', 'zones']);

    const rules = model.priority!;
    const cams = rules.filter((r) => JSON.stringify(r).includes('in_cams'));
    const zones = rules.filter((r) => JSON.stringify(r).includes('in_zones'));

    // camera area: bridge/tunnel rule then else_if
    expect(cams).toHaveLength(2);
    expect(cams[0]!.if).toContain('in_cams');
    expect(cams[0]!.if).toContain('BRIDGE');
    expect('else_if' in cams[1]!).toBe(true);
    expect(cams[1]!.else_if).toBe('in_cams');
    expect(Number(cams[1]!.multiply_by)).toBe(0);
  });

  it('zones rule is a single hard 0 with no bridge/tunnel exemption', () => {
    const model = avoidCustomModelMulti([{ area: area('zones'), factor: 0, hardBlock: true }]);
    const rules = model.priority!;
    expect(rules).toHaveLength(1);
    expect(rules[0]!.if).toBe('in_zones');
    expect(Number(rules[0]!.multiply_by)).toBe(0);
    // no rule references BRIDGE/TUNNEL
    expect(JSON.stringify(rules)).not.toContain('BRIDGE');
    expect(JSON.stringify(rules)).not.toContain('TUNNEL');
  });

  it('keeps each area bridge rule before its else_if (order-sensitive)', () => {
    const model = avoidCustomModelMulti([
      { area: area('zones'), factor: 0, hardBlock: true },
      { area: area('cams'), factor: 0.02 },
    ]);
    const rules = model.priority!;
    // zones hard block first, then camera bridge rule, then camera else_if
    expect(rules[0]!.if).toBe('in_zones');
    expect(rules[1]!.if).toContain('in_cams');
    expect(rules[1]!.if).toContain('BRIDGE');
    expect(rules[2]!.else_if).toBe('in_cams');
    expect(Number(rules[2]!.multiply_by)).toBeCloseTo(0.02);
  });

  it('avoidCustomModel is a thin wrapper producing the single-area rules', () => {
    const model = avoidCustomModel(area('cams'), 0);
    expect(model.areas?.features).toHaveLength(1);
    expect(model.priority).toHaveLength(2);
    expect(model.priority![1]!.else_if).toBe('in_cams');
  });
});
