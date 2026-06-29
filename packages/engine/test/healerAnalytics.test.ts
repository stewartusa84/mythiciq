import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import { Primitives } from '../src/analytics/primitives/index.js';
import { aggregate, summarizeCensored, formatCensored } from '../src/analytics/stats/aggregate.js';
import { computeHealResponse, DEFAULT_HEAL_RESPONSE_PARAMS } from '../src/analytics/seed/healResponse.js';
import { computeRecovery, DEFAULT_RECOVERY_PARAMS } from '../src/analytics/seed/recovery.js';

// ---- hand-built advanced-logging fixture (HP values are the hand-checked truth) ----
const BOSS = 'Creature-0-0-0-0-0BOSS';
const HEALER = 'Player-1-1003';
const HEALME = 'Player-1-1001';
const SQUISHY = 'Player-1-1002';

const FULL = Infinity;
const WHOLE = { startMs: -Infinity, endMs: FULL };

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}

// 19-field advanced block; infoGuid = the snapshot's unit, currentHp/maxHp the hand truth.
function adv(infoGuid: string, currentHp: number, maxHp: number): string {
  return [infoGuid, '0000000000000000', currentHp, maxHp, 0, 0, 0, 0, 0, 0, 0, 100, 100, 0, '0.0', '0.0', '2000', '0.0', 600].join(',');
}

function advDamage(t: number, src: string, srcN: string, dst: string, dstN: string, cur: number, max: number, amount: number): string {
  // 42 fields -> advanced detection fires (12 base/spell + 19 advanced + 11 suffix)
  return `${ts(t)}  SPELL_DAMAGE,${src},"${srcN}",0xa48,0x0,${dst},"${dstN}",0x512,0x0,99999,"Boss Hit",0x1,${adv(dst, cur, max)},${amount},${amount},0,1,0,0,0,nil,nil,nil,ST`;
}

function advHeal(t: number, src: string, srcN: string, dst: string, dstN: string, cur: number, max: number, amount: number, overheal: number): string {
  // 36 fields -> advanced detection fires (12 + 19 + 5 heal suffix)
  return `${ts(t)}  SPELL_HEAL,${src},"${srcN}",0x512,0x0,${dst},"${dstN}",0x512,0x0,2061,"Flash Heal",0x2,${adv(dst, cur, max)},${cur},${amount},${overheal},0,nil`;
}

function unitDied(t: number, dst: string, dstN: string): string {
  return `${ts(t)}  UNIT_DIED,0000000000000000,nil,0x0,0x0,${dst},"${dstN}",0x512,0x0`;
}

const LOG = [
  // Healme: .8 -> .4 -> .2, then healed to .9166 (note maxHp jumps 100k -> 120k mid-fight)
  advDamage(0.5, BOSS, 'Boss', HEALME, 'Healme', 80000, 100000, 20000),
  advDamage(1.0, BOSS, 'Boss', HEALME, 'Healme', 40000, 100000, 40000),
  advDamage(2.0, BOSS, 'Boss', HEALME, 'Healme', 20000, 100000, 20000),
  advHeal(3.0, HEALER, 'Healbot', HEALME, 'Healme', 110000, 120000, 90000, 0),
  // Squishy: .8 -> .3, then dies before any heal lands
  advDamage(0.5, BOSS, 'Boss', SQUISHY, 'Squishy', 80000, 100000, 20000),
  advDamage(1.0, BOSS, 'Boss', SQUISHY, 'Squishy', 30000, 100000, 50000),
  unitDied(1.5, SQUISHY, 'Squishy'),
].join('\n') + '\n';

let parsed: ParsedLog;
let prim: Primitives;

function unitIdByName(name: string): number {
  const hp = prim.hpTimeline();
  for (const t of hp.byUnit.values()) if (t.name === name) return t.unitId;
  throw new Error(`no HP timeline for ${name}`);
}

beforeAll(async () => {
  const wasm = await loadWasmBytes();
  parsed = await parseLog(wasm, new TextEncoder().encode(LOG));
  prim = Primitives.for(parsed.store);
});

describe('#1 HP-timeline primitive', () => {
  it('reconstructs per-unit samples with per-sample maxHp', () => {
    const hp = prim.hpTimeline();
    const healme = hp.unit(unitIdByName('Healme'))!;
    expect(healme.samples.map((s) => [s.ms - healme.samples[0]!.ms, s.currentHp, s.maxHp])).toEqual([
      [0, 80000, 100000],
      [500, 40000, 100000],
      [1500, 20000, 100000],
      [2500, 110000, 120000], // maxHp is NOT constant
    ]);
  });

  it('answers hpAt() as hold-last and returns undefined before first sample', () => {
    const hp = prim.hpTimeline();
    const id = unitIdByName('Healme');
    const base = hp.unit(id)!.samples[0]!.ms;
    expect(hp.hpAt(id, base - 100)).toBeUndefined(); // before first snapshot: unknown
    expect(hp.hpAt(id, base + 700)?.fraction).toBeCloseTo(0.4); // hold-last from the 1.0s sample
    expect(hp.hpAt(id, base + 2500)?.maxHp).toBe(120000);
  });

  it('records sample density (samples/sec over the observed window)', () => {
    const healme = prim.hpTimeline().unit(unitIdByName('Healme'))!;
    expect(healme.sampleDensity).toBeCloseTo(4 / 2.5); // 4 samples over 2.5s
  });
});

describe('#4 aggregate / percentile helper', () => {
  it('mean + nearest-rank percentiles, always with count', () => {
    const a = aggregate([10, 20, 30, 40, 50], [50, 95]);
    expect(a.count).toBe(5);
    expect(a.mean).toBe(30);
    expect(a.percentiles.p50).toBe(30);
    expect(a.percentiles.p95).toBe(50);
  });

  it('empty input reports count 0 with null statistics (not dropped)', () => {
    const a = aggregate([], [50]);
    expect(a.count).toBe(0);
    expect(a.mean).toBeNull();
    expect(a.percentiles.p50).toBeNull();
  });

  it('reports censored population separately and formats both', () => {
    const c = summarizeCensored([1000], 1, [50, 95]);
    expect(c.completed.count).toBe(1);
    expect(c.censoredByDeath).toBe(1);
    expect(formatCensored('Recovery', c, { unit: 's', divisor: 1000 })).toBe(
      'Recovery: 1 episode, p50 1.0s, p95 1.0s; 1 additional ended in death.',
    );
  });
});

describe('#2 heal-response latency', () => {
  it('triggers on falling edge, finds next effective heal, buckets died-while-low', () => {
    const r = computeHealResponse(parsed.store, prim, DEFAULT_HEAL_RESPONSE_PARAMS, WHOLE);
    expect(r.latenciesMs).toEqual([2000]); // Healme: low at 1.0s, healed at 3.0s
    expect(r.byType).toEqual({ direct: 1, hot: 0 });
    expect(r.diedWhileLow).toBe(1); // Squishy died low before any heal — bucketed, not dropped
    expect(r.unresolved).toBe(0);
    expect(r.stats.count).toBe(1);
    expect(r.stats.mean).toBe(2000);
  });
});

describe('#3 recovery-time hysteresis', () => {
  it('measures reach-healthy recovery and censors death episodes', () => {
    const r = computeRecovery(parsed.store, prim, DEFAULT_RECOVERY_PARAMS, WHOLE);
    expect(r.durationsMs).toEqual([1000]); // Healme: crosses <0.4 at 2.0s, reaches >=0.9 at 3.0s
    expect(r.censoredByDeath).toBe(1); // Squishy: damaged then died
    expect(r.stats.completed.count).toBe(1);
    expect(r.stats.censoredByDeath).toBe(1);
  });
});
