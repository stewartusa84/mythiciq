import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import {
  ReplayModel,
  ReplayView,
  toReplayData,
  inferGcdMs,
  GCD_BASE_MS,
  type ReplayModelData,
  type CastInterval,
  type AuraInterval,
} from '../src/analytics/primitives/replayModel.js';
import { interruptForSpec, cooldownsForSpec, talentCooldownsForSpec } from '../src/spells/importantCooldowns.js';

const BOSS = 'Creature-0-0-0-0-0BOSS';
const TANK = 'Player-1-3001';
const HEALER = 'Player-1-3002';
const DPS = 'Player-1-3003';

// Timeline/overlay fields required by ReplayModelData — empty for hand-built fixtures.
const EXTRAS = {
  timeline: { bucketMs: 1000, startMs: 0, dmgDone: [] as number[], dmgTaken: [] as number[], healDone: [] as number[], healTaken: [] as number[] },
  avoidableHits: [] as never[],
  encounters: [] as never[],
  dmgByUnit: new Map<number, never[]>(),
  healByUnit: new Map<number, never[]>(),
  incomingByUnit: new Map<number, never[]>(),
  cooldownsByUnit: new Map<number, never[]>(),
  dispellableBySpell: new Map<number, string[]>(),
  dangerousDebuffs: new Set<number>(),
  dmgDoneByUnit: new Map<number, number[]>(),
  healDoneByUnit: new Map<number, number[]>(),
  capacityByUnit: new Map<number, number[]>(),
};

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}
// Anchor every log at second 0 (earliest event) so store.ts[0] === epoch(second 0); query times are
// then q(sec). Timestamps in the store are EPOCH ms, not 0-based — q() bridges that for assertions.
const anchor = () => castSuccess(0, DPS, DPS, 1);
function aura(t: number, ev: string, src: string, dst: string, spellId: number, kind: string): string {
  return `${ts(t)}  ${ev},${src},"Src",0x512,0x0,${dst},"Dst",0x512,0x0,${spellId},"Aura",0x1,${kind}`;
}
function castStart(t: number, src: string, dst: string, spellId: number): string {
  return `${ts(t)}  SPELL_CAST_START,${src},"Src",0x512,0x0,${dst},"Dst",0xa48,0x0,${spellId},"Big Cast",0x1`;
}
function castSuccess(t: number, src: string, dst: string, spellId: number): string {
  return `${ts(t)}  SPELL_CAST_SUCCESS,${src},"Src",0x512,0x0,${dst},"Dst",0xa48,0x0,${spellId},"Big Cast",0x1`;
}
function interrupt(t: number, src: string, caster: string, extraSpellId: number): string {
  return `${ts(t)}  SPELL_INTERRUPT,${src},"Kicker",0x512,0x0,${caster},"Caster",0xa48,0x0,116705,"Kick",0x1,${extraSpellId},"Big Cast",0x1`;
}
function unitDied(t: number, dst: string): string {
  return `${ts(t)}  UNIT_DIED,0000000000000000,nil,0x0,0x0,${dst},"Caster",0xa48,0x0`;
}
function encStart(t: number, id: number, name: string): string {
  return `${ts(t)}  ENCOUNTER_START,${id},"${name}",8,5,2000`;
}
function encEnd(t: number, id: number, name: string, success: number): string {
  return `${ts(t)}  ENCOUNTER_END,${id},"${name}",8,5,${success}`;
}

let wasm: Awaited<ReturnType<typeof loadWasmBytes>>;
async function build(lines: string[]): Promise<{ m: ReplayModel; parsed: ParsedLog; q: (sec: number) => number }> {
  const parsed = await parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
  const base = parsed.store.ts[0]!; // epoch ms of the second-0 anchor
  return { m: ReplayModel.build(parsed.store), parsed, q: (sec: number) => base + sec * 1000 };
}
const guid = (parsed: ParsedLog, g: string): number => parsed.store.actorIds().find((id) => parsed.store.str(id) === g)!;

beforeAll(async () => {
  wasm = await loadWasmBytes();
});

describe('ReplayModel — aura timeline', () => {
  it('reports an aura active only within [applied, removed]', async () => {
    const { m, parsed, q } = await build([
      anchor(),
      aura(5, 'SPELL_AURA_APPLIED', HEALER, TANK, 17, 'BUFF'), // Power Word: Shield
      aura(20, 'SPELL_AURA_REMOVED', HEALER, TANK, 17, 'BUFF'),
    ]);
    const tank = guid(parsed, TANK);
    expect(m.aurasAt(tank, q(2)).length).toBe(0); // before applied
    const at10 = m.aurasAt(tank, q(10));
    expect(at10).toHaveLength(1);
    expect(at10[0]!.spellId).toBe(17);
    expect(at10[0]!.auraType).toBe('BUFF');
    expect(m.aurasAt(tank, q(20)).length).toBe(0); // at removal (end exclusive)
    expect(m.aurasAt(tank, q(25)).length).toBe(0); // after
  });

  it('tracks stacks across DOSE events', async () => {
    const { m, parsed, q } = await build([
      anchor(),
      aura(10, 'SPELL_AURA_APPLIED', BOSS, TANK, 1258459, 'DEBUFF'), // Rotting Strikes
      aura(12, 'SPELL_AURA_APPLIED_DOSE', BOSS, TANK, 1258459, 'DEBUFF'),
      aura(14, 'SPELL_AURA_APPLIED_DOSE', BOSS, TANK, 1258459, 'DEBUFF'),
      aura(20, 'SPELL_AURA_REMOVED', BOSS, TANK, 1258459, 'DEBUFF'),
    ]);
    const tank = guid(parsed, TANK);
    expect(m.aurasAt(tank, q(11))[0]!.stacks).toBe(1);
    expect(m.aurasAt(tank, q(13))[0]!.stacks).toBe(2);
    expect(m.aurasAt(tank, q(16))[0]!.stacks).toBe(3);
    expect(m.aurasAt(tank, q(16))[0]!.appliedMs).toBe(m.aurasAt(tank, q(11))[0]!.appliedMs); // same run
  });

  it('keeps an aura active to the end when never removed', async () => {
    const { m, parsed, q } = await build([anchor(), aura(10, 'SPELL_AURA_APPLIED', HEALER, TANK, 21562, 'BUFF')]);
    const tank = guid(parsed, TANK);
    expect(m.aurasAt(tank, q(9999)).length).toBe(1);
  });
});

describe('ReplayModel — cast bars', () => {
  it('builds a cast bar from START to SUCCESS', async () => {
    const { m, parsed, q } = await build([anchor(), castStart(10, BOSS, TANK, 9999), castSuccess(13, BOSS, TANK, 9999)]);
    const boss = guid(parsed, BOSS);
    expect(m.castAt(boss, q(9))).toBeNull();
    const c = m.castAt(boss, q(11.5))!;
    expect(c.spellId).toBe(9999);
    expect(c.result).toBe('success');
    expect(c.startMs).toBe(q(10));
    expect(c.endMs).toBe(q(13));
    expect(c.targetUnit).toBe(guid(parsed, TANK));
    expect(m.castAt(boss, q(13))).toBeNull(); // end exclusive
  });

  it('marks an interrupted cast and stops the bar at the interrupt', async () => {
    const { m, parsed, q } = await build([anchor(), castStart(10, BOSS, TANK, 8888), interrupt(12, TANK, BOSS, 8888)]);
    const boss = guid(parsed, BOSS);
    const c = m.castAt(boss, q(11))!;
    expect(c.result).toBe('interrupted');
    expect(c.endMs).toBe(q(12));
    expect(c.interruptedBy).toBe(guid(parsed, TANK));
  });

  it('treats a SUCCESS with no START as an instant (no cast bar)', async () => {
    const { m, parsed, q } = await build([anchor(), castSuccess(10, BOSS, TANK, 7777)]);
    const boss = guid(parsed, BOSS);
    expect(m.castAt(boss, q(10))).toBeNull(); // instants are not bars
    expect(m.castsByUnit.get(boss)!.some((c) => c.instant && c.spellId === 7777)).toBe(true);
  });

  it('closes an open cast when the caster dies mid-cast (no lingering to run end)', async () => {
    const { m, parsed, q } = await build([
      anchor(),
      castStart(10, BOSS, TANK, 8888),
      unitDied(13, BOSS),
      castSuccess(100, DPS, DPS, 1), // later activity extends the window well past the death
    ]);
    const boss = guid(parsed, BOSS);
    const c = m.castsByUnit.get(boss)!.find((x) => x.spellId === 8888)!;
    expect(c.result).toBe('cancelled');
    expect(c.endMs).toBe(q(13)); // ends at death, NOT at the window end (q(100))
    expect(m.castAt(boss, q(50))).toBeNull(); // not still "in progress" long after
  });

  it('caps an unresolved cast instead of painting a bar to the window end', async () => {
    const { m, parsed, q } = await build([
      anchor(),
      castStart(10, BOSS, TANK, 7777),
      castSuccess(40, DPS, DPS, 1), // window ends ~30s after the open cast (> 15s cap)
    ]);
    const boss = guid(parsed, BOSS);
    const c = m.castsByUnit.get(boss)!.find((x) => x.spellId === 7777)!;
    expect(c.result).toBe('in-progress');
    expect(c.endMs).toBe(q(25)); // capped at startMs + MAX_OPEN_CAST_MS (15s), not q(40)
  });
});

describe('ReplayView — enemy cast lane (no lingering)', () => {
  // The reported bug: uninterrupted/unresolved enemy casts stayed on the lane indefinitely and piled
  // up when scrubbing forward. Only definitive outcomes (interrupted / went-off) should linger briefly.
  const data: ReplayModelData = {
    firstMs: 0,
    lastMs: 100_000,
    units: [{ unitId: 1, name: 'Boss', isPlayer: false }],
    aurasByUnit: new Map(),
    castsByUnit: new Map([
      [
        1,
        [
          { spellId: 1, targetUnit: 0, startMs: 1000, endMs: 3000, result: 'success', instant: false, interruptible: true },
          { spellId: 2, targetUnit: 0, startMs: 5000, endMs: 7000, result: 'cancelled', instant: false, interruptible: true },
        ],
      ],
    ]),
    hpByUnit: new Map(),
    powerByUnit: new Map(),
    deaths: [],
    spellNames: new Map(),
    importantBuffIds: [],
    bookmarks: [],
    targetNames: new Map(), ...EXTRAS,
  };
  const v = new ReplayView(data);

  it('shows a cast while in progress', () => {
    expect(v.enemyCastsAround(2000)).toHaveLength(1); // mid success-cast
    expect(v.enemyCastsAround(6500)).toHaveLength(1); // mid cancelled-cast (success tail cleared by now)
  });

  it('keeps a went-off (success) cast briefly after it ends, then drops it', () => {
    expect(v.enemyCastsAround(3500)).toHaveLength(1); // just after end — outcome lingers
    expect(v.enemyCastsAround(20000)).toHaveLength(0); // long after — gone
  });

  it('drops a cancelled cast the moment it ends (no lingering, no pile-up)', () => {
    expect(v.enemyCastsAround(7500)).toHaveLength(0); // ended at 7000, not shown at 7500
    expect(v.enemyCastsAround(90000)).toHaveLength(0); // scrubbed far forward — nothing piled up
  });
});

describe('ReplayView — low-HP danger windows', () => {
  const make = (hp: { ms: number; currentHp: number; maxHp: number }[], deaths: { ms: number }[], lastMs: number): ReplayView => {
    const data: ReplayModelData = {
      firstMs: 0,
      lastMs,
      units: [{ unitId: 1, name: 'Tank', isPlayer: true }],
      aurasByUnit: new Map(),
      castsByUnit: new Map(),
      hpByUnit: new Map([[1, hp]]),
      powerByUnit: new Map(),
      deaths: deaths.map((d) => ({ ms: d.ms, unitId: 1, name: 'Tank', isPlayer: true })),
      spellNames: new Map(),
      importantBuffIds: [],
      bookmarks: [],
      targetNames: new Map(), ...EXTRAS,
    };
    return new ReplayView(data);
  };

  it('flags each dip below 25% (near-misses), recovering between them', () => {
    const v = make(
      [
        { ms: 1000, currentHp: 100, maxHp: 100 }, // 100%
        { ms: 2000, currentHp: 20, maxHp: 100 }, // 20% → dip opens
        { ms: 3000, currentHp: 50, maxHp: 100 }, // 50% → recovered, dip closes
        { ms: 4000, currentHp: 10, maxHp: 100 }, // 10% → dip opens, never recovers
      ],
      [],
      5000,
    );
    const g = v.criticalWindows(0.25)[0]!;
    expect(g.name).toBe('Tank');
    expect(g.windows).toEqual([
      { startMs: 2000, endMs: 3000 },
      { startMs: 4000, endMs: 5000 }, // still low at the last sample → runs to lastMs
    ]);
  });

  it('clips a dip that ends in death at the death (not the run end)', () => {
    const v = make(
      [
        { ms: 1000, currentHp: 100, maxHp: 100 },
        { ms: 4000, currentHp: 10, maxHp: 100 }, // dips low, then dies
      ],
      [{ ms: 4500 }],
      9000,
    );
    expect(v.criticalWindows(0.25)[0]!.windows).toEqual([{ startMs: 4000, endMs: 4500 }]);
  });

  it('does not flag a corpse sitting at 0 HP while waiting on a battle-rez', () => {
    const v = make(
      [
        { ms: 1000, currentHp: 100, maxHp: 100 },
        { ms: 4000, currentHp: 10, maxHp: 100 }, // dips low (~2s of real danger)
        { ms: 5000, currentHp: 0, maxHp: 100 }, // corpse — dead, not "critical"
        { ms: 15000, currentHp: 0, maxHp: 100 }, // still a corpse ~10s later (waiting on rez)
        { ms: 25000, currentHp: 80, maxHp: 100 }, // battle-rezzed back up
      ],
      [{ ms: 4500 }],
      30000,
    );
    // Only the genuine pre-death dip; the long dead stretch is NOT a low-HP band.
    expect(v.criticalWindows(0.25)[0]!.windows).toEqual([{ startMs: 4000, endMs: 4500 }]);
  });

  it('reopens a window if revived at low HP (a rez into danger is real)', () => {
    const v = make(
      [
        { ms: 4000, currentHp: 10, maxHp: 100 }, // dies low
        { ms: 5000, currentHp: 0, maxHp: 100 }, // corpse
        { ms: 12000, currentHp: 15, maxHp: 100 }, // rezzed at 15% → new danger window
        { ms: 13000, currentHp: 90, maxHp: 100 }, // healed up → closes
      ],
      [{ ms: 4500 }],
      20000,
    );
    expect(v.criticalWindows(0.25)[0]!.windows).toEqual([
      { startMs: 4000, endMs: 4500 },
      { startMs: 12000, endMs: 13000 },
    ]);
  });
});

describe('inferGcdMs — GCD from cast cadence', () => {
  const inst = (startMs: number, spellId = 100): CastInterval => ({
    spellId,
    targetUnit: 0,
    startMs,
    endMs: startMs,
    result: 'success',
    instant: true,
  });
  const hard = (startMs: number, endMs: number, spellId = 200): CastInterval => ({
    spellId,
    targetUnit: 0,
    startMs,
    endMs,
    result: 'success',
    instant: false,
  });

  it('reads the GCD off the floor of instant-cast spacing', () => {
    // 13 instants spaced exactly 1200ms → every in-band gap is 1200.
    const casts = Array.from({ length: 13 }, (_, i) => inst(i * 1200));
    expect(inferGcdMs(casts)).toBe(1200);
  });

  it('ignores the long waiting tail (slow gaps) and reports the fast floor', () => {
    const casts: CastInterval[] = [];
    let t = 0;
    // Alternate a 1200ms (GCD-bound) gap with a long idle gap; the floor is still 1200.
    for (let i = 0; i < 10; i++) {
      casts.push(inst(t));
      t += 1200;
      casts.push(inst(t));
      t += 8000; // idle (out of band, excluded)
    }
    expect(inferGcdMs(casts)).toBe(1200);
  });

  it('excludes Bloodlust windows so haste does not bias the estimate low', () => {
    const casts: CastInterval[] = [];
    // Un-hasted block: 13 instants @ 1200ms.
    for (let i = 0; i < 13; i++) casts.push(inst(i * 1200));
    // Hasted (lust) block far later: 12 instants @ 800ms.
    for (let i = 0; i < 12; i++) casts.push(inst(100_000 + i * 800));
    const lust = [{ startMs: 99_999, endMs: 110_000 }];
    expect(inferGcdMs(casts, lust)).toBe(1200); // lust gaps dropped → un-hasted floor
    expect(inferGcdMs(casts, [])).toBe(800); // without exclusion the hasted floor dominates
  });

  it('anchors on instants only — hard casts do not seed gaps', () => {
    // Only hard casts (cast-time gated): no instant anchors → no signal.
    const casts = Array.from({ length: 13 }, (_, i) => hard(i * 2000, i * 2000 + 1500));
    expect(inferGcdMs(casts)).toBeUndefined();
  });

  it('returns undefined below the minimum sample count', () => {
    expect(inferGcdMs([inst(0), inst(1200), inst(2400)])).toBeUndefined();
  });

  it('ReplayView.gcdMsFor falls back to the base GCD when none was inferred', () => {
    const data: ReplayModelData = {
      firstMs: 0,
      lastMs: 10_000,
      units: [
        { unitId: 1, name: 'NoInfo', isPlayer: true },
        { unitId: 2, name: 'Hasted', isPlayer: true, gcdMs: 1100 },
      ],
      aurasByUnit: new Map(),
      castsByUnit: new Map(),
      hpByUnit: new Map(),
      powerByUnit: new Map(),
      deaths: [],
      spellNames: new Map(),
      importantBuffIds: [],
      bookmarks: [],
      targetNames: new Map(), ...EXTRAS,
    };
    const v = new ReplayView(data);
    expect(v.gcdMsFor(1)).toBe(GCD_BASE_MS);
    expect(v.gcdMsFor(2)).toBe(1100);
  });
});

describe('ReplayView.playerCastAt — instant casts as estimated GCD bars', () => {
  const view = (casts: CastInterval[], gcdMs = 1200): ReplayView => {
    const data: ReplayModelData = {
      firstMs: 0,
      lastMs: 100_000,
      units: [{ unitId: 1, name: 'Player', isPlayer: true, gcdMs }],
      aurasByUnit: new Map(),
      castsByUnit: new Map([[1, casts]]),
      hpByUnit: new Map(),
      powerByUnit: new Map(),
      deaths: [],
      spellNames: new Map(),
      importantBuffIds: [],
      bookmarks: [],
      targetNames: new Map(), ...EXTRAS,
    };
    return new ReplayView(data);
  };
  const inst = (startMs: number, spellId = 100, targetUnit = 0): CastInterval => ({
    spellId,
    targetUnit,
    startMs,
    endMs: startMs,
    result: 'success',
    instant: true,
  });
  const hard = (startMs: number, endMs: number, spellId = 200): CastInterval => ({
    spellId,
    targetUnit: 0,
    startMs,
    endMs,
    result: 'success',
    instant: false,
  });

  it('fills the GCD window after an instant cast (flagged gcd, synthesized endMs)', () => {
    const v = view([inst(1000)]);
    const pc = v.playerCastAt(1, 1500)!;
    expect(pc.gcd).toBe(true);
    expect(pc.cast.spellId).toBe(100);
    expect(pc.cast.startMs).toBe(1000);
    expect(pc.cast.endMs).toBe(1000 + 1200); // start + inferred GCD
  });

  it('drops the GCD bar once the window elapses', () => {
    const v = view([inst(1000)]);
    expect(v.playerCastAt(1, 2200)).toBeNull(); // exactly at start+gcd (end exclusive)
    expect(v.playerCastAt(1, 5000)).toBeNull();
  });

  it('shows a real cast as a true cast bar (not gcd)', () => {
    const v = view([hard(5000, 7000)]);
    const pc = v.playerCastAt(1, 6000)!;
    expect(pc.gcd).toBe(false);
    expect(pc.cast.endMs).toBe(7000); // the real cast end, not a synthesized GCD
  });

  it('lets a real cast win over an overlapping instant GCD window', () => {
    const v = view([inst(4900), hard(5000, 7000)]);
    const pc = v.playerCastAt(1, 5500)!;
    expect(pc.gcd).toBe(false); // real hard cast in progress takes precedence
    expect(pc.cast.endMs).toBe(7000);
  });

  it('uses the latest instant when several fire within a GCD', () => {
    const v = view([inst(1000, 100), inst(1100, 101)]); // off-GCD weave
    const pc = v.playerCastAt(1, 1500)!;
    expect(pc.cast.spellId).toBe(101); // the most recent instant's window
    expect(pc.cast.endMs).toBe(1100 + 1200);
  });
});

describe('ReplayView.playerJournal — spell filter + journalSpellIds', () => {
  const cast = (spellId: number, ms: number): CastInterval => ({
    spellId, targetUnit: 0, startMs: ms, endMs: ms, result: 'success', instant: true,
  });
  const deb = (spellId: number, ms: number): AuraInterval => ({
    spellId, auraType: 'DEBUFF', sourceUnit: 9, appliedMs: ms, startMs: ms, endMs: ms + 5000, stacks: 1,
  });
  const make = (): ReplayView => {
    const data: ReplayModelData = {
      firstMs: 0,
      lastMs: 100_000,
      units: [{ unitId: 1, name: 'Player', isPlayer: true }, { unitId: 9, name: 'Boss', isPlayer: false }],
      aurasByUnit: new Map([[1, [deb(500, 2000)]]]),
      castsByUnit: new Map([[1, [cast(100, 1000), cast(101, 1500)]]]),
      hpByUnit: new Map(),
      powerByUnit: new Map(),
      deaths: [],
      spellNames: new Map([[100, 'Alpha'], [101, 'Bravo'], [500, 'Curse']]),
      importantBuffIds: [],
      bookmarks: [],
      targetNames: new Map(), ...EXTRAS,
    };
    return new ReplayView(data);
  };

  it('lists every journal-eligible spell (casts + debuffs) name-sorted', () => {
    const ids = make().journalSpellIds();
    expect(ids).toEqual([
      { id: 100, name: 'Alpha', ids: [100] },
      { id: 101, name: 'Bravo', ids: [101] },
      { id: 500, name: 'Curse', ids: [500] },
    ]);
  });

  it('excludes filtered spellIds from the journal', () => {
    const v = make();
    const all = v.playerJournal(1, 100_000);
    expect(all.some((e) => e.spellId === 100)).toBe(true);
    expect(all.some((e) => e.spellId === 500)).toBe(true);

    const filtered = v.playerJournal(1, 100_000, 40, new Set([100, 500]));
    expect(filtered.some((e) => e.spellId === 100)).toBe(false); // cast hidden
    expect(filtered.some((e) => e.spellId === 500)).toBe(false); // aura hidden
    expect(filtered.some((e) => e.spellId === 101)).toBe(true); // unfiltered remains
  });

  it('collapses spells that share a display name into one row carrying every id', () => {
    const data: ReplayModelData = {
      firstMs: 0, lastMs: 100_000,
      units: [{ unitId: 1, name: 'Player', isPlayer: true }],
      aurasByUnit: new Map(),
      // 200 and 201 are rank/talent variants that log under different ids but the same name.
      castsByUnit: new Map([[1, [cast(200, 1000), cast(201, 1500), cast(300, 2000)]]]),
      hpByUnit: new Map(), powerByUnit: new Map(), deaths: [],
      spellNames: new Map([[200, 'Renew'], [201, 'Renew'], [300, 'Smite']]),
      importantBuffIds: [], bookmarks: [], targetNames: new Map(), ...EXTRAS,
    };
    const rows = new ReplayView(data).journalSpellIds();
    expect(rows).toEqual([
      { id: 200, name: 'Renew', ids: [200, 201] }, // collapsed, both ids carried
      { id: 300, name: 'Smite', ids: [300] },
    ]);
  });
});

describe('toReplayData — run timeline + encounter spans', () => {
  const adv = (g: string) => [g, '0000000000000000', 1000, 1000, 0, 0, 0, 0, 0, 0, 0, 100, 100, 0, '0.0', '0.0', '2000', '0.0', 600].join(',');
  const dmg = (t: number, src: string, sf: string, dst: string, df: string, amount: number) =>
    `${ts(t)}  SPELL_DAMAGE,${src},"S",${sf},0x0,${dst},"D",${df},0x0,99999,"Hit",0x1,${adv(dst)},${amount},${amount},0,1,0,0,0,nil,nil,nil,ST`;
  const heal = (t: number, src: string, dst: string, amount: number, overheal: number) =>
    `${ts(t)}  SPELL_HEAL,${src},"S",0x512,0x0,${dst},"D",0x512,0x0,2061,"Heal",0x2,${adv(dst)},${amount},${amount},${overheal},0,nil`;
  const summon = (t: number, owner: string, pet: string) =>
    `${ts(t)}  SPELL_SUMMON,${owner},"Owner",0x511,0x0,${pet},"Pet",0x1111,0x0,12345,"Summon",0x1`;
  // Advanced block whose infoGuid is the SOURCE and carries an ownerGuid (how a real pet's own
  // SPELL_DAMAGE looks) — used to verify attribution of a pet that was never summoned in-log.
  const advOwned = (info: string, owner: string) =>
    [info, owner, 1000, 1000, 0, 0, 0, 0, 0, 0, 0, 100, 100, 0, '0.0', '0.0', '2000', '0.0', 600].join(',');
  const dmgPet = (t: number, pet: string, dst: string, amount: number, owner: string) =>
    `${ts(t)}  SPELL_DAMAGE,${pet},"Pet",0x1111,0x0,${dst},"D",0xa48,0x0,99999,"Bite",0x1,${advOwned(pet, owner)},${amount},${amount},0,1,0,0,0,nil,nil,nil,ST`;

  it('buckets damage/healing done & taken and pairs ENCOUNTER_START/END into spans', async () => {
    const parsed = await parseLog(wasm, new TextEncoder().encode([
      anchor(),
      encStart(0.5, 1234, 'Big Boss'),
      dmg(1, DPS, '0x512', BOSS, '0xa48', 500), // player → enemy: damage DONE
      dmg(1, BOSS, '0xa48', TANK, '0x512', 300), // enemy → player: damage TAKEN
      heal(2, HEALER, TANK, 200, 50), // healer → tank: 150 effective (done + taken)
      encEnd(3, 1234, 'Big Boss', 1),
    ].join('\n') + '\n'));
    const data = toReplayData(ReplayModel.build(parsed.store), parsed.store, undefined);
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(sum(data.timeline.dmgDone)).toBe(500);
    expect(sum(data.timeline.dmgTaken)).toBe(300);
    expect(sum(data.timeline.healDone)).toBe(150);
    expect(sum(data.timeline.healTaken)).toBe(150);
    expect(data.encounters).toHaveLength(1);
    expect(data.encounters[0]).toMatchObject({ name: 'Big Boss', success: true });
    expect(data.encounters[0]!.endMs - data.encounters[0]!.startMs).toBeGreaterThan(0);
  });

  it("attributes a summoned pet's damage to its owner (pet DPS)", async () => {
    const PET = 'Pet-0-1-2-3-100-000000ABCD';
    const parsed = await parseLog(wasm, new TextEncoder().encode([
      anchor(),
      summon(0.5, DPS, PET), // DPS owns PET
      dmg(1, DPS, '0x511', BOSS, '0xa48', 400), // player direct → enemy
      dmg(1, PET, '0x1111', BOSS, '0xa48', 600), // pet → enemy: should roll into the owner
      dmg(1, BOSS, '0xa48', TANK, '0x512', 100), // enemy → player: taken, not "done"
    ].join('\n') + '\n'));
    const store = parsed.store;
    const data = toReplayData(ReplayModel.build(store), store, undefined);
    const dpsId = guid(parsed, DPS);
    const petId = store.actorIds().find((id) => store.str(id) === PET)!;
    const sum = (a: number[] | undefined) => (a ?? []).reduce((x, y) => x + y, 0);

    expect(store.ownerOf(petId)).toBe(dpsId); // pet resolves to its owner
    expect(store.ownerOf(dpsId)).toBe(dpsId); // a player resolves to itself
    expect(sum(data.dmgDoneByUnit.get(dpsId))).toBe(1000); // 400 direct + 600 pet
    expect(data.dmgDoneByUnit.has(petId)).toBe(false); // pet not its own meter row
    expect(sum(data.timeline.dmgDone)).toBe(1000); // pet damage included in done
    expect(sum(data.timeline.dmgTaken)).toBe(100);
  });

  it('attributes a PRE-SUMMONED pet via the advanced-block ownerGuid (no SPELL_SUMMON in log)', async () => {
    const PET = 'Pet-0-1-2-3-100-00000PRE01';
    const parsed = await parseLog(wasm, new TextEncoder().encode([
      anchor(),
      // No summon line — the pet was already out. Its own SPELL_DAMAGE stamps ownerGuid = DPS.
      dmgPet(1, PET, BOSS, 700, DPS),
      dmgPet(2, PET, BOSS, 300, DPS),
    ].join('\n') + '\n'));
    const store = parsed.store;
    const data = toReplayData(ReplayModel.build(store), store, undefined);
    const dpsId = guid(parsed, DPS);
    const petId = store.actorIds().find((id) => store.str(id) === PET)!;
    const sum = (a: number[] | undefined) => (a ?? []).reduce((x, y) => x + y, 0);

    expect(store.ownerOf(petId)).toBe(dpsId); // resolved purely from the advanced ownerGuid
    expect(sum(data.dmgDoneByUnit.get(dpsId))).toBe(1000);
  });
});

describe('ReplayModel — passive-proc casts filtered out', () => {
  it('drops a spell that recurs sub-GCD-floor (passive) but keeps real + charge abilities', async () => {
    const lines = [anchor()];
    // 9001 = passive proc: 8 instant casts 0.3s apart (all sub-600ms) → dropped.
    for (let k = 0; k < 8; k++) lines.push(castSuccess(1 + k * 0.3, DPS, DPS, 9001));
    // 9002 = real GCD ability: 6 instant casts 1.5s apart → kept.
    for (let k = 0; k < 6; k++) lines.push(castSuccess(5 + k * 1.5, DPS, DPS, 9002));
    // 9003 = charge ability: spaced casts with ONE sub-floor double-tap → kept (fraction too low).
    for (const t of [20, 21.5, 23, 23.3, 24.8, 26.3, 27.8]) lines.push(castSuccess(t, DPS, DPS, 9003));

    const { m, parsed } = await build(lines);
    const dps = guid(parsed, DPS);
    const ids = new Set((m.castsByUnit.get(dps) ?? []).map((c) => c.spellId));
    expect(ids.has(9001)).toBe(false); // passive proc removed
    expect(ids.has(9002)).toBe(true); // real ability kept
    expect(ids.has(9003)).toBe(true); // charge double-tap not enough to flag
  });
});

describe('ReplayView.powerAt — only the active resource for form-shifters', () => {
  // Feral timeline: Energy (cat) → Rage (bear) → Energy (cat). Each advanced block reports one type.
  const v = new ReplayView({
    firstMs: 0, lastMs: 10_000,
    units: [{ unitId: 1, name: 'Feral', isPlayer: true }],
    aurasByUnit: new Map(), castsByUnit: new Map(), hpByUnit: new Map(),
    powerByUnit: new Map([[1, new Map([
      [3, [{ ms: 1000, current: 100, max: 100 }, { ms: 5000, current: 80, max: 100 }]], // Energy
      [1, [{ ms: 2000, current: 50, max: 100 }, { ms: 3000, current: 60, max: 100 }]], // Rage (bear)
    ])]]),
    deaths: [], spellNames: new Map(), importantBuffIds: [], bookmarks: [], targetNames: new Map(), ...EXTRAS,
  });

  it('shows Rage while in bear and ONLY Energy after shifting back (no stale Rage bar)', () => {
    expect(v.powerAt(1, 1500)).toEqual([{ powerType: 3, current: 100, max: 100 }]); // cat: Energy only
    expect(v.powerAt(1, 2500)).toEqual([{ powerType: 1, current: 50, max: 100 }]); // bear: Rage active
    expect(v.powerAt(1, 6000)).toEqual([{ powerType: 3, current: 80, max: 100 }]); // back to cat: Energy ONLY
  });
});

describe('ReplayView.combatAggregate / recentCombat — incoming damage/heal overlays', () => {
  // Damage burst at 1000–1300 (3 ticks <1s apart), then a gap, then one hit at 5000.
  const v = new ReplayView({
    firstMs: 0, lastMs: 10_000,
    units: [{ unitId: 1, name: 'Tank', isPlayer: true }],
    aurasByUnit: new Map(), castsByUnit: new Map(), hpByUnit: new Map(), powerByUnit: new Map(),
    deaths: [], spellNames: new Map(), importantBuffIds: [], bookmarks: [], targetNames: new Map(),
    ...EXTRAS,
    dmgByUnit: new Map([[1, [
      { ms: 1000, amount: 10_000, absorbed: 2000 },
      { ms: 1200, amount: 5000, absorbed: 0 },
      { ms: 1300, amount: 5000, absorbed: 0 },
      { ms: 5000, amount: 8000, absorbed: 0 },
    ]]]),
    healByUnit: new Map([[1, [{ ms: 1400, amount: 12_000 }]]]),
  });

  it('sums the active damage burst (with absorb) and resets after the >1s gap', () => {
    const a = v.combatAggregate(1, 1350)!;
    expect(a.dmg).toBe(20_000); // 10k + 5k + 5k
    expect(a.absorb).toBe(2000);
    expect(a.dmgActive).toBe(true);
    // The lone hit at 5000 is its own burst (the earlier one isn't summed in).
    expect(v.combatAggregate(1, 5050)!.dmg).toBe(8000);
  });

  it('drops the burst once it is long over, and tracks heal bursts independently', () => {
    expect(v.combatAggregate(1, 4000)).toBeNull(); // >BURST_SHOW_MS past the 1300 burst, before 5000
    const h = v.combatAggregate(1, 1450)!;
    expect(h.heal).toBe(12_000);
    expect(h.hasHeal).toBe(true);
  });

  it('recentCombat merges ticks within 250ms and ages from the newest', () => {
    const pops = v.recentCombat(1, 1350);
    const dmg = pops.filter((p) => p.kind === 'dmg');
    // 1300 & 1200 merge (100ms apart); 1000 is 300ms away → its own pop.
    expect(dmg[0]!.amount).toBe(10_000); // 5k + 5k
    expect(dmg[0]!.age).toBe(50); // newest tick at 1300, queried at 1350
    expect(dmg[1]!.amount).toBe(10_000); // the 1000ms tick, unmerged
  });
});

describe('interruptForSpec — no healer interrupts; spec-correct picks', () => {
  it('gives tank/dps their interrupt but NO healer spec one', () => {
    expect(interruptForSpec(260)).toBe(1766); // Sub Rogue → Kick
    expect(interruptForSpec(255)).toBe(187707); // Survival Hunter → Muzzle
    expect(interruptForSpec(253)).toBe(147362); // BM Hunter → Counter Shot
    expect(interruptForSpec(102)).toBe(78675); // Balance Druid → Solar Beam
    expect(interruptForSpec(103)).toBe(106839); // Feral → Skull Bash
    expect(interruptForSpec(1473)).toBe(351338); // Augmentation Evoker → Quell
    // Healers: none.
    expect(interruptForSpec(270)).toBeUndefined(); // Mistweaver Monk
    expect(interruptForSpec(65)).toBeUndefined(); // Holy Paladin
    expect(interruptForSpec(105)).toBeUndefined(); // Resto Druid
    expect(interruptForSpec(264)).toBeUndefined(); // Resto Shaman
    expect(interruptForSpec(1468)).toBeUndefined(); // Preservation Evoker
    expect(interruptForSpec(257)).toBeUndefined(); // Holy Priest
    expect(interruptForSpec(258)).toBe(15487); // Shadow Priest → Silence (dps)
    expect(interruptForSpec(undefined)).toBeUndefined();
  });

  it('cooldownsForSpec gives the full kit (interrupt + class/spec major + healer dispel) from run start', () => {
    const ids = (spec: number) => cooldownsForSpec(spec).map((c) => c.spellId).sort((a, b) => a - b);
    expect(ids(264)).toEqual([2825, 77130]); // Resto Shaman: Bloodlust + Purify Spirit
    expect(ids(263)).toEqual([2825, 57994]); // Enh Shaman: Bloodlust + Wind Shear (no dispel)
    expect(ids(65)).toEqual([633, 1044, 4987, 31821]); // Holy Pal: LoH + BoF + Cleanse + Aura Mastery
    expect(ids(70)).toEqual([633, 1044, 96231]); // Ret Paladin: LoH + BoF + Rebuke (no dispel)
    expect(ids(256)).toEqual([527, 586, 73325, 421453]); // Disc: Purify + Fade + Leap + Ultimate Penitence
    expect(ids(257)).toEqual([527, 586, 73325]); // Holy Priest: Purify + Fade + Leap of Faith
    expect(ids(258)).toEqual([586, 15487]); // Shadow: Fade + Silence (no dispel)
    expect(ids(270)).toEqual([115310, 115450, 116841, 119381]); // MW: Revival + Detox + Tiger's Lust + Leg Sweep
    expect(ids(105)).toEqual([88423]); // Resto Druid: Nature's Cure (no interrupt as healer)
    expect(ids(1468)).toEqual([360823, 390386]); // Preservation: Naturalize + Fury of the Aspects
    // Shaman lust tracks both faction variants.
    expect(cooldownsForSpec(264).find((c) => c.spellId === 2825)!.castIds.sort((a, b) => a - b)).toEqual([2825, 32182]);
    // Each healer dispel carries the categories it can clear (drives the dispel-needed glow).
    expect(cooldownsForSpec(65).find((c) => c.spellId === 4987)!.provides).toEqual(['magic', 'poison', 'disease']);
    expect(cooldownsForSpec(264).find((c) => c.spellId === 77130)!.provides).toEqual(['magic', 'curse']);
  });

  it('talentCooldownsForSpec lists talent-gated CDs (shown only after first cast)', () => {
    const ids = (spec: number) => talentCooldownsForSpec(spec).map((c) => c.spellId).sort((a, b) => a - b);
    expect(ids(270)).toEqual([325197, 443028]); // Mistweaver: Invoke Chi-Ji, Celestial Conduit
    expect(ids(65)).toEqual([]); // Holy Paladin: none
    expect(ids(260)).toEqual([]); // Rogue: none
  });
});

describe('ReplayView.cooldownsAt — important cooldown availability', () => {
  const v = new ReplayView({
    firstMs: 0, lastMs: 60_000,
    units: [{ unitId: 1, name: 'Rogue', isPlayer: true, specId: 260 }],
    aurasByUnit: new Map(), castsByUnit: new Map(), hpByUnit: new Map(), powerByUnit: new Map(),
    deaths: [], spellNames: new Map(), importantBuffIds: [], bookmarks: [], targetNames: new Map(),
    ...EXTRAS,
    cooldownsByUnit: new Map([[1, [
      { spellId: 1766, name: 'Kick', cooldownSeconds: 15, kind: 'interrupt' as const, casts: [10_000, 40_000] },
      { spellId: 2825, name: 'Bloodlust', cooldownSeconds: 300, kind: 'raid' as const, casts: [] },
    ]]]),
  });

  it('is ready before first use, on CD for the duration after, then ready again', () => {
    const at = (ms: number) => v.cooldownsAt(1, ms).find((c) => c.spellId === 1766)!;
    expect(at(5000).ready).toBe(true); // before first cast
    expect(at(12_000).ready).toBe(false); // 2s after a 15s kick
    expect(at(12_000).readyInMs).toBe(13_000);
    expect(at(26_000).ready).toBe(true); // 16s after → off CD
    expect(at(41_000).ready).toBe(false); // just after the 2nd cast
  });

  it('treats never-cast cooldowns as available all run', () => {
    const lust = v.cooldownsAt(1, 30_000).find((c) => c.spellId === 2825)!;
    expect(lust.ready).toBe(true);
    expect(v.cooldownsAt(1, 0)[0]!.spellId).toBe(1766); // interrupt listed first
  });
});

describe('ReplayView.dispellableCategoriesAt — team dispel-window signal', () => {
  // A magic debuff on the DPS from 1000–4000; nothing else dispellable.
  const v = new ReplayView({
    firstMs: 0, lastMs: 10_000,
    units: [
      { unitId: 1, name: 'Healer', isPlayer: true },
      { unitId: 2, name: 'DPS', isPlayer: true },
      { unitId: 9, name: 'Boss', isPlayer: false },
    ],
    aurasByUnit: new Map([[2, [
      { spellId: 500, auraType: 'DEBUFF' as const, sourceUnit: 9, appliedMs: 1000, startMs: 1000, endMs: 4000, stacks: 1 },
      { spellId: 600, auraType: 'DEBUFF' as const, sourceUnit: 9, appliedMs: 1000, startMs: 1000, endMs: 4000, stacks: 1 }, // not dispellable
    ]]]),
    castsByUnit: new Map(), hpByUnit: new Map(), powerByUnit: new Map(),
    deaths: [], spellNames: new Map(), importantBuffIds: [], bookmarks: [], targetNames: new Map(),
    ...EXTRAS,
    dispellableBySpell: new Map([[500, ['magic']]]),
    dangerousDebuffs: new Set([500, 600]), // 500 dispellable, 600 heal-through
  });

  it('reports the active dispellable categories only while the debuff is up', () => {
    expect([...v.dispellableCategoriesAt(500)]).toEqual([]); // before it applies
    expect([...v.dispellableCategoriesAt(2000)]).toEqual(['magic']); // up (600 isn't dispellable)
    expect([...v.dispellableCategoriesAt(5000)]).toEqual([]); // after it falls off
  });

  it('flags dangerous debuffs and distinguishes dispellable from heal-through', () => {
    expect(v.isDangerousDebuff(500)).toBe(true);
    expect(v.isDangerousDebuff(600)).toBe(true);
    expect(v.isDangerousDebuff(999)).toBe(false);
    expect(v.dispelCategoriesOf(500)).toEqual(['magic']); // a remover can clear it
    expect(v.dispelCategoriesOf(600)).toEqual([]); // heal-through: no remover helps
  });
});

describe('ReplayView.metersAt — live DPS/HPS', () => {
  const v = new ReplayView({
    firstMs: 0, lastMs: 10_000,
    units: [
      { unitId: 1, name: 'Mage', isPlayer: true },
      { unitId: 2, name: 'Healer', isPlayer: true },
      { unitId: 9, name: 'Boss', isPlayer: false },
    ],
    aurasByUnit: new Map(), castsByUnit: new Map(), hpByUnit: new Map(), powerByUnit: new Map(),
    deaths: [], spellNames: new Map(), importantBuffIds: [], bookmarks: [], targetNames: new Map(),
    ...EXTRAS,
    timeline: { bucketMs: 1000, startMs: 0, dmgDone: [], dmgTaken: [], healDone: [], healTaken: [] },
    dmgDoneByUnit: new Map([[1, [100, 200, 300]], [2, [50, 50, 50]]]),
    healDoneByUnit: new Map([[2, [0, 0, 1000]]]),
  });

  it('ranks players by cumulative output per elapsed second up to the clock', () => {
    const m = v.metersAt(2500); // bIdx=2 ⇒ sum buckets 0..2; elapsed = 2.5s
    expect(m.dps.map((r) => [r.unitId, r.value])).toEqual([[1, 240], [2, 60]]); // 600/2.5, 150/2.5
    expect(m.hps.map((r) => [r.unitId, r.value])).toEqual([[2, 400]]); // 1000/2.5; mage has no healing
  });

  it('only counts buckets up to the clock (rate rises as more lands)', () => {
    const m = v.metersAt(500); // bIdx=0 ⇒ only bucket 0; elapsed floored to 1s
    expect(m.dps.map((r) => [r.unitId, r.value])).toEqual([[1, 100], [2, 50]]);
    expect(m.hps).toEqual([]); // healer's only heal is in bucket 2
  });
});

describe('ReplayView.nameOf — no GUID leaks for no-target casts', () => {
  const view = (units: ReplayModelData['units'], targetNames: Map<number, string>): ReplayView =>
    new ReplayView({
      firstMs: 0, lastMs: 1, units,
      aurasByUnit: new Map(), castsByUnit: new Map(), hpByUnit: new Map(), powerByUnit: new Map(),
      deaths: [], spellNames: new Map(), importantBuffIds: [], bookmarks: [], targetNames, ...EXTRAS,
    });

  it('returns the name for real units but undefined for nil/typed GUID fallbacks', () => {
    const v = view(
      [
        { unitId: 1, name: 'Healer', isPlayer: true },
        { unitId: 2, name: '0000000000000000', isPlayer: false }, // nil-GUID unit
        { unitId: 3, name: 'Creature-0-1-2-3-12345-0001', isPlayer: false }, // unnamed → guid fallback
      ],
      new Map([[4, '0000000000000000']]), // nil GUID that slipped into targetNames
    );
    expect(v.nameOf(1)).toBe('Healer');
    expect(v.nameOf(2)).toBeUndefined();
    expect(v.nameOf(3)).toBeUndefined();
    expect(v.nameOf(4)).toBeUndefined();
    expect(v.nameOf(99)).toBeUndefined(); // unknown unit
  });
});

describe('ReplayModel — buff grouping + bookmarks', () => {
  it('classifies notable vs misc buffs and collects timeline bookmarks', async () => {
    const parsed = await parseLog(
      wasm,
      new TextEncoder().encode(
        [
          anchor(),
          aura(2, 'SPELL_AURA_APPLIED', HEALER, TANK, 1459, 'BUFF'), // Arcane Intellect → important
          aura(2, 'SPELL_AURA_APPLIED', HEALER, TANK, 9123456, 'BUFF'), // unknown buff → misc
          aura(2, 'SPELL_AURA_APPLIED', BOSS, TANK, 1258459, 'DEBUFF'), // debuff (own group)
          encStart(10, 1234, 'Test Boss'),
          unitDied(15, TANK), // player death → bookmark
          encEnd(20, 1234, 'Test Boss', 1),
        ].join('\n') + '\n',
      ),
    );
    const data = toReplayData(ReplayModel.build(parsed.store), parsed.store);

    expect(data.importantBuffIds).toContain(1459);
    expect(data.importantBuffIds).not.toContain(9123456);

    expect(data.bookmarks.map((b) => b.kind)).toEqual(['boss-start', 'death', 'boss-end']);
    const bossEnd = data.bookmarks.find((b) => b.kind === 'boss-end')!;
    expect(bossEnd.success).toBe(true);
    expect(bossEnd.label).toBe('Test Boss');

    const view = new ReplayView(data);
    expect(view.isImportantBuff(1459)).toBe(true);
    expect(view.isImportantBuff(9123456)).toBe(false);
  });
});
