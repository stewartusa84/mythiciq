import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import { Primitives } from '../src/analytics/primitives/index.js';
import { SpellTable } from '../src/spells/spellTable.js';
import { computeTankMelee, DEFAULT_TANK_MELEE_PARAMS } from '../src/analytics/seed/tankMitigation.js';
import { computeInterruptsPriority, computeDispelsPriority } from '../src/analytics/seed/priorityActions.js';
import { computeAvoidableDamage } from '../src/analytics/seed/avoidableDamage.js';

const BOSS = 'Creature-0-0-0-0-0BOSS';
const TANK = 'Player-1-2001';
const P1 = 'Player-1-2002';
const P2 = 'Player-1-2003';
const HEALER = 'Player-1-2004';
const KICKER = 'Player-1-2005';
const WHOLE_MS = { startMs: -Infinity, endMs: Infinity };

// In-memory curated table: MDT-style seed + overlay (curation). 5001 avoidable,
// 6001 active-mitigation, 7001 dangerous interrupt, 8002 dangerous dispel.
const TABLE = SpellTable.fromData(
  {
    spells: [
      { spellId: 7001, interruptible: true },
      { spellId: 7002, interruptible: true },
      { spellId: 8001, dispelType: 'magic' },
      { spellId: 8002, dispelType: 'curse' },
    ],
  },
  {
    spells: {
      '7001': { interruptPriority: 'dangerous' },
      '8002': { dispelPriority: 'dangerous' },
      '5001': { avoidable: true },
      '6001': { activeMitigation: true },
    },
  },
);

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}
function adv(infoGuid: string, cur: number, max: number): string {
  return [infoGuid, '0000000000000000', cur, max, 0, 0, 0, 0, 0, 0, 0, 100, 100, 0, '0.0', '0.0', '2000', '0.0', 600].join(',');
}
function advDamage(t: number, dst: string, dstN: string, cur: number, max: number, amount: number): string {
  return `${ts(t)}  SPELL_DAMAGE,${BOSS},"Boss",0xa48,0x0,${dst},"${dstN}",0x512,0x0,99999,"Hit",0x1,${adv(dst, cur, max)},${amount},${amount},0,1,0,0,0,nil,nil,nil,ST`;
}
function dmg(t: number, dst: string, dstN: string, spellId: number, amount: number): string {
  return `${ts(t)}  SPELL_DAMAGE,${BOSS},"Boss",0xa48,0x0,${dst},"${dstN}",0x512,0x0,${spellId},"Mechanic",0x1,${amount},0,0x1,0,0,0,nil,nil,nil,nil`;
}
function swing(t: number, dst: string, dstN: string, amount: number, blocked: number, absorbed: number): string {
  return `${ts(t)}  SWING_DAMAGE,${BOSS},"Boss",0xa48,0x0,${dst},"${dstN}",0x512,0x0,${amount},0,0x1,0,${blocked},${absorbed},nil,nil,nil,nil`;
}
// Real Midnight format: 38 fields, advanced block (infoGUID = the TARGET) + 10-field damage
// suffix with NO trailing abilityHint. Modern logs emit only SWING_DAMAGE_LANDED, never SWING_DAMAGE.
function swingLanded(t: number, dst: string, dstN: string, cur: number, max: number, amount: number, blocked: number, absorbed: number): string {
  const advBlock = [dst, '0000000000000000', cur, max, 2878, 622, 6576, 1181, 285, 0, 17, 8, 120, 0, '504.08', '228.46', '184', '0.1759', 289].join(',');
  return `${ts(t)}  SWING_DAMAGE_LANDED,${BOSS},"Boss",0xa48,0x80000000,${dst},"${dstN}",0x10512,0x80000000,${advBlock},${amount},${amount * 3},-1,1,0,${blocked},${absorbed},nil,nil,nil`;
}
function aura(t: number, ev: string, unit: string, unitN: string, spellId: number, auraType: string): string {
  return `${ts(t)}  ${ev},${unit},"${unitN}",0x512,0x0,${unit},"${unitN}",0x512,0x0,${spellId},"Aura",0x1,${auraType}`;
}
function debuffApplied(t: number, dst: string, dstN: string, spellId: number): string {
  return `${ts(t)}  SPELL_AURA_APPLIED,${BOSS},"Boss",0xa48,0x0,${dst},"${dstN}",0x512,0x0,${spellId},"Debuff",0x1,DEBUFF`;
}
function debuffRemoved(t: number, dst: string, dstN: string, spellId: number): string {
  return `${ts(t)}  SPELL_AURA_REMOVED,${dst},"${dstN}",0x512,0x0,${dst},"${dstN}",0x512,0x0,${spellId},"Debuff",0x1,DEBUFF`;
}
function interrupt(t: number, src: string, srcN: string, extraSpellId: number): string {
  return `${ts(t)}  SPELL_INTERRUPT,${src},"${srcN}",0x512,0x0,${BOSS},"Boss",0xa48,0x0,116705,"Kick",0x1,${extraSpellId},"Cast",0x1`;
}
function castSuccess(t: number, spellId: number): string {
  return `${ts(t)}  SPELL_CAST_SUCCESS,${BOSS},"Boss",0xa48,0x0,${BOSS},"Boss",0xa48,0x0,${spellId},"Big Cast",0x1`;
}
function dispel(t: number, src: string, srcN: string, dst: string, dstN: string, extraSpellId: number): string {
  return `${ts(t)}  SPELL_DISPEL,${src},"${srcN}",0x512,0x0,${dst},"${dstN}",0x512,0x0,89808,"Dispel",0x1,${extraSpellId},"Debuff",0x1,BUFF`;
}

let wasm: Uint8Array<ArrayBuffer>;
async function parse(lines: string[]): Promise<ParsedLog> {
  wasm ??= await loadWasmBytes();
  return parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
}

beforeAll(async () => {
  wasm = await loadWasmBytes();
});

describe('#5 unmitigated melee on tank', () => {
  it('separates literal vs active-mitigation-down, plus big hits', async () => {
    const parsed = await parse([
      advDamage(1.0, TANK, 'Tank', 90000, 100000, 10000), // seeds tank HP timeline (maxHp 100k)
      aura(2.0, 'SPELL_AURA_APPLIED', TANK, 'Tank', 6001, 'BUFF'), // active mitigation up
      swing(2.5, TANK, 'Tank', 8000, 500, 0), // AM up, blocked -> not literal, not AM-down
      aura(3.0, 'SPELL_AURA_REMOVED', TANK, 'Tank', 6001, 'BUFF'), // AM down
      swing(4.0, TANK, 'Tank', 10000, 0, 0), // AM down, literal unmitigated
      swing(5.0, TANK, 'Tank', 9000, 0, 1000), // AM down, absorbed -> not literal
      swing(6.0, TANK, 'Tank', 40000, 0, 0), // AM down, literal + big hit (>=30k)
    ]);
    const r = computeTankMelee(parsed.store, Primitives.for(parsed.store), TABLE, DEFAULT_TANK_MELEE_PARAMS, WHOLE_MS);
    expect(r.tankName).toBe('Tank');
    expect(r.activeMitigationConfigured).toBe(true);
    const u = r.perUnit.find((x) => x.isTank)!;
    expect(u.swings).toBe(4);
    expect(u.literalUnmitigated).toEqual({ count: 2, damage: 50000, pctOfSwings: 50 }); // 10k + 40k, 2/4
    expect(u.amDownUnmitigated).toEqual({ count: 3, damage: 59000, pctOfSwings: 75 }); // 10k+9k+40k (2.5s was AM-up), 3/4
    expect(u.bigHits).toEqual({ count: 1, damage: 40000, pctOfSwings: 25 }); // 40k >= 0.3*100k, 1/4
  });

  it('decodes SWING_DAMAGE_LANDED (Midnight uses it exclusively): amount + blocked/absorbed', async () => {
    const parsed = await parse([
      swingLanded(1.0, TANK, 'Tank', 700000, 766000, 50000, 0, 0), // literal unmitigated
      swingLanded(2.0, TANK, 'Tank', 650000, 766000, 30000, 0, 11265), // absorbed -> not literal
    ]);
    const r = computeTankMelee(parsed.store, Primitives.for(parsed.store), SpellTable.empty(), DEFAULT_TANK_MELEE_PARAMS, WHOLE_MS);
    const u = r.perUnit.find((x) => x.isTank)!;
    expect(u.swings).toBe(2);
    expect(u.totalDamage).toBe(80000); // 50k + 30k — was 0 before the _LANDED parser fix
    expect(u.literalUnmitigated.count).toBe(1); // only the unabsorbed hit
    expect(u.literalUnmitigated.damage).toBe(50000);
    expect(u.literalUnmitigated.pctOfSwings).toBe(50); // 1 of 2 swings
  });

  it('reports active-mitigation-down as unavailable when no AM ids are curated', async () => {
    const parsed = await parse([
      advDamage(1.0, TANK, 'Tank', 90000, 100000, 10000),
      swing(2.0, TANK, 'Tank', 10000, 0, 0),
    ]);
    const r = computeTankMelee(parsed.store, Primitives.for(parsed.store), SpellTable.empty(), DEFAULT_TANK_MELEE_PARAMS, WHOLE_MS);
    expect(r.activeMitigationConfigured).toBe(false);
    expect(r.perUnit.find((x) => x.isTank)!.amDownUnmitigated).toBeNull();
  });
});

describe('#6 interrupts by priority', () => {
  it('splits successes by priority and derives success rate from completed casts', async () => {
    const parsed = await parse([
      interrupt(1.0, KICKER, 'Kicker', 7001), // success dangerous
      interrupt(2.0, KICKER, 'Kicker', 7002), // success regular
      castSuccess(3.0, 7002), // interruptible enemy cast completed -> missed regular
    ]);
    const r = computeInterruptsPriority(parsed.store, TABLE, WHOLE_MS);
    expect(r.total).toBe(2);
    expect(r.byPriority.dangerous).toEqual({ success: 1, missed: 0 });
    expect(r.byPriority.regular).toEqual({ success: 1, missed: 1 });
    expect(r.successRateByPriority.dangerous).toBe(1);
    expect(r.successRateByPriority.regular).toBe(0.5);
    // per-player dangerous-only breakdown: just the 7001 kick
    expect(r.bySourceDangerous).toEqual([expect.objectContaining({ name: 'Kicker', value: 1 })]);
  });
});

describe('#6 dispels by priority', () => {
  it('measures dispel latency and success/miss split by priority', async () => {
    const parsed = await parse([
      debuffApplied(1.0, P1, 'Pone', 8001), // magic -> regular
      dispel(1.5, HEALER, 'Healbot', P1, 'Pone', 8001), // dispelled -> success regular, 500ms
      debuffApplied(2.0, P2, 'Ptwo', 8002), // curse -> dangerous
      dispel(2.4, HEALER, 'Healbot', P2, 'Ptwo', 8002), // dispelled -> success dangerous
      debuffApplied(4.0, P2, 'Ptwo', 8002), // curse -> dangerous again
      debuffRemoved(5.0, P2, 'Ptwo', 8002), // expired, never dispelled -> miss dangerous
    ]);
    const r = computeDispelsPriority(parsed.store, TABLE, WHOLE_MS);
    expect(r.byPriority.regular.success).toBe(1);
    expect(r.byPriority.regular.miss).toBe(0);
    expect(r.byPriority.regular.latency.count).toBe(1);
    expect(r.byPriority.regular.latency.percentiles.p50).toBe(500);
    expect(r.byPriority.dangerous.success).toBe(1);
    expect(r.byPriority.dangerous.miss).toBe(1);
    // per-player dangerous-only breakdown: the healer's one dangerous dispel
    expect(r.bySourceDangerous).toEqual([expect.objectContaining({ name: 'Healbot', value: 1 })]);
  });
});

describe('#8 avoidable damage (table-only)', () => {
  it('sums only table-flagged avoidable damage and reports coverage', async () => {
    const parsed = await parse([
      dmg(1.0, P1, 'Pone', 5001, 5000), // avoidable
      dmg(2.0, P1, 'Pone', 5002, 3000), // NOT in table -> not avoidable
      dmg(3.0, P2, 'Ptwo', 5001, 2000), // avoidable
    ]);
    const r = computeAvoidableDamage(parsed.store, TABLE, { start: 0, end: parsed.store.count });
    expect(r.totalAvoidable).toBe(7000);
    expect(r.byUnit.find((x) => x.name === 'Pone')!.value).toBe(5000);
    expect(r.byUnit.find((x) => x.name === 'Ptwo')!.value).toBe(2000);
    expect(r.knownAvoidableSpells).toBe(1);
    // per-spell, per-player breakdown: 5001 was eaten by both Pone (5000) and Ptwo (2000)
    const spell = r.bySpell.find((s) => s.id === 5001)!;
    expect(spell.value).toBe(7000);
    expect(spell.byUnit).toEqual([
      expect.objectContaining({ name: 'Pone', value: 5000 }),
      expect.objectContaining({ name: 'Ptwo', value: 2000 }),
    ]);
  });
});
