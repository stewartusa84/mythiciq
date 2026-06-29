import { describe, it, expect } from 'vitest';

import {
  presetToRule,
  normalizeSharedMetrics,
  exportSharedMetrics,
  type MetricPreset,
} from '../src/analytics/customMetricsShare.js';

describe('customMetricsShare — preset → rule conversion', () => {
  it('maps a resource preset (name → power id, allies → players)', () => {
    const p: MetricPreset = {
      id: 'x',
      class: 'Death Knight',
      spec: 'Blood',
      role: 'tank',
      name: 'Avoid capping Runic Power',
      metric: { type: 'resource', target: 'allies', resource: 'runic_power', comparator: '>=', value: 90 },
    };
    const r = presetToRule(p);
    expect(r.target).toBe('players');
    expect(r.subject).toEqual({ kind: 'resource', powerType: 6, cmp: '>=', value: 90 });
    expect(r.label).toBe('Avoid capping Runic Power');
    expect(r.id).toBeTruthy();
  });

  it('maps the four spell-based metric types', () => {
    const mk = (metric: MetricPreset['metric']): MetricPreset => ({ id: 'i', class: 'C', spec: 'S', role: 'dps', name: 'n', metric });
    expect(presetToRule(mk({ type: 'buff_missing', spellId: 195181, auraKind: 'any', inCombatOnly: true })).subject).toEqual({
      kind: 'aura-missing', spellId: 195181, inCombatOnly: true,
    });
    expect(presetToRule(mk({ type: 'cooldown_sitting_on', spellId: 49028, cooldownSeconds: 120, idleThresholdSeconds: 5 })).subject).toEqual({
      kind: 'cooldown', spellId: 49028, cooldownSeconds: 120, minIdleSeconds: 5,
    });
    expect(presetToRule(mk({ type: 'charges_capped', spellId: 217200, maxCharges: 2, rechargeSeconds: 18 })).subject).toEqual({
      kind: 'charges', spellId: 217200, maxCharges: 2, rechargeSeconds: 18,
    });
    expect(presetToRule(mk({ type: 'aura', spellId: 454015, stackComparator: '>=', stacks: 2, auraKind: 'buff' })).subject).toEqual({
      kind: 'aura', spellId: 454015, minStacks: 2, auraType: 'BUFF',
    });
  });

  it('throws on an unknown resource name', () => {
    const p: MetricPreset = { id: 'x', class: 'C', spec: 'S', role: 'dps', name: 'n', metric: { type: 'resource', resource: 'mojo', comparator: '>=', value: 1 } };
    expect(() => presetToRule(p)).toThrow(/unknown resource/);
  });
});

describe('customMetricsShare — import normalization', () => {
  it('accepts the export wrapper', () => {
    const json = JSON.stringify({ format: 'wow-mplus-custom-metrics', version: 1, rules: [{ label: 'a', target: 'self', subject: { kind: 'resource', powerType: 11, cmp: '>', value: 90 } }] });
    const { rules, errors } = normalizeSharedMetrics(json);
    expect(errors).toHaveLength(0);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.subject).toEqual({ kind: 'resource', powerType: 11, cmp: '>', value: 90 });
  });

  it('accepts a bare engine rule, a raw template metric, and a templates array', () => {
    expect(normalizeSharedMetrics({ target: 'enemies', subject: { kind: 'aura', spellId: 5, minStacks: 1 } }).rules).toHaveLength(1);
    expect(normalizeSharedMetrics({ type: 'resource', resource: 'fury', comparator: '>=', value: 90 }).rules[0]!.subject).toEqual({ kind: 'resource', powerType: 17, cmp: '>=', value: 90 });
    expect(normalizeSharedMetrics({ templates: [{ name: 'a', metric: { type: 'cooldown_sitting_on', spellId: 1, cooldownSeconds: 60 } }, { name: 'b', metric: { type: 'charges_capped', spellId: 2, maxCharges: 2, rechargeSeconds: 9 } }] }).rules).toHaveLength(2);
  });

  it('reports per-item errors but keeps the good ones', () => {
    const { rules, errors } = normalizeSharedMetrics([
      { type: 'resource', resource: 'energy', comparator: '>=', value: 90 },
      { type: 'resource', resource: 'nope', comparator: '>=', value: 90 },
    ]);
    expect(rules).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/item 2/);
  });

  it('surfaces invalid JSON', () => {
    expect(normalizeSharedMetrics('{ not json').errors[0]).toMatch(/invalid JSON/);
  });

  it('round-trips export → import', () => {
    const rules = normalizeSharedMetrics({ type: 'buff_missing', spellId: 195181, auraKind: 'any' }).rules;
    const json = exportSharedMetrics(rules);
    const back = normalizeSharedMetrics(json);
    expect(back.errors).toHaveLength(0);
    expect(back.rules[0]!.subject).toEqual(rules[0]!.subject);
  });
});
