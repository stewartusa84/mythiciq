import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import { ReplayModel, toReplayData, ReplayView } from '../src/analytics/primitives/replayModel.js';
import { gcdMsFromHaste, GCD_FLOOR_MS } from '../src/spells/haste.js';
import { capacityModeForSpec } from '../src/spells/healingCapacity.js';

const HOLY_PAL = 'Player-1-7001'; // spec 65 (healer, 'heal' mode)
const HOLY_PAL2 = 'Player-1-7002';
const DISC = 'Player-1-7003'; // spec 256 ('all' mode — damage counts)
const TANK = 'Player-1-7008'; // heal target (kept separate so the healers' names aren't overwritten)
const HOLY_SHOCK = 20473;
const CRUSADER = 35395; // a non-heal cast
const SMITE = 585;

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}
function combatantInfo(guid: string, specId: number, hasteRating: number): string {
  const f = Array(26).fill('0');
  f[0] = 'COMBATANT_INFO';
  f[1] = guid;
  f[16] = String(hasteRating); // hasteRating offset (see fieldspec.rs)
  f[25] = String(specId);
  return `${ts(0)}  ${f.join(',')}`;
}
function castSuccess(t: number, src: string, srcN: string, spellId: number): string {
  return `${ts(t)}  SPELL_CAST_SUCCESS,${src},"${srcN}",0x512,0x0,${src},"${srcN}",0x512,0x0,${spellId},"Spell",0x1`;
}
const adv = (guid: string) => [guid, '0000000000000000', 100, 100, 0, 0, 0, 0, 0, 0, 0, 100, 100, 0, '0.0', '0.0', '2000', '0.0', 600].join(',');
function heal(t: number, src: string, srcN: string, dst: string, spellId: number, amount: number): string {
  return `${ts(t)}  SPELL_HEAL,${src},"${srcN}",0x512,0x0,${dst},"Dst",0x512,0x0,${spellId},"Heal",0x2,${adv(dst)},100,${amount},0,0,nil`;
}

let wasm: Uint8Array<ArrayBuffer>;
async function parse(lines: string[]): Promise<ParsedLog> {
  wasm ??= await loadWasmBytes();
  return parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
}
beforeAll(async () => {
  wasm = await loadWasmBytes();
});

describe('gcdMsFromHaste', () => {
  it('is the base GCD at 0 haste, shorter with haste/lust, and floors at 0.75s', () => {
    expect(gcdMsFromHaste(0)).toBe(1500);
    expect(gcdMsFromHaste(3300)).toBeLessThan(1500); // 3300 rating ≈ 10% haste → ~1364ms
    expect(gcdMsFromHaste(0, { lust: true })).toBeCloseTo(1500 / 1.3, 0); // ~1154ms
    expect(gcdMsFromHaste(1_000_000)).toBe(GCD_FLOOR_MS); // absurd haste clamps to the floor
  });
});

describe('capacityModeForSpec', () => {
  it('marks Disc/MW as all-casts, other healers as heal-classified, non-healers as none', () => {
    expect(capacityModeForSpec(256)).toBe('all'); // Discipline
    expect(capacityModeForSpec(270)).toBe('all'); // Mistweaver
    expect(capacityModeForSpec(65)).toBe('heal'); // Holy Paladin
    expect(capacityModeForSpec(577)).toBeUndefined(); // Havoc DH (dps)
    expect(capacityModeForSpec(undefined)).toBeUndefined();
  });
});

describe('healer capacity (replay model)', () => {
  it('counts heal casts for a heal-classified healer, ignores their non-heal casts', async () => {
    const lines = [combatantInfo(HOLY_PAL, 65, 0), combatantInfo(HOLY_PAL2, 65, 0)];
    // HOLY_PAL ("Pal"): 4 instant heals (each produces SPELL_HEAL of the cast spell) over 4s → busy.
    for (let s = 1; s <= 4; s++) {
      lines.push(castSuccess(s, HOLY_PAL, 'Pal', HOLY_SHOCK));
      lines.push(heal(s, HOLY_PAL, 'Pal', TANK, HOLY_SHOCK, 1000));
    }
    // HOLY_PAL2 ("Pal2"): only a non-heal cast (Crusader Strike) — must NOT count toward capacity.
    lines.push(castSuccess(5, HOLY_PAL2, 'Pal2', CRUSADER));

    const { store } = await parse(lines);
    const v = new ReplayView(toReplayData(ReplayModel.build(store), store));

    const palId = v.players().find((u) => u.name === 'Pal')!.unitId;
    const pal2Id = v.players().find((u) => u.name === 'Pal2')!.unitId;

    // Both are healers with a baked series.
    expect(v.healerUnits().map((u) => u.unitId).sort()).toEqual([palId, pal2Id].sort());
    // The heal-spamming paladin reads busy; the CS-only paladin reads empty.
    expect(v.capacityAt(palId, v.firstMs + 4000)).toBeGreaterThan(0.4);
    expect(v.capacitySeries(pal2Id)!.every((x) => x === 0)).toBe(true);
    expect(v.capacityAt(pal2Id, v.firstMs + 3000)).toBe(0);
  });

  it("counts a Disc priest's damage casts (damage IS healing)", async () => {
    const lines = [combatantInfo(DISC, 256, 0)];
    for (let s = 1; s <= 3; s++) lines.push(castSuccess(s, DISC, 'Disc', SMITE)); // pure damage, no heal logged
    const { store } = await parse(lines);
    const v = new ReplayView(toReplayData(ReplayModel.build(store), store));

    const discId = v.players().find((u) => u.specId === 256)!.unitId;
    expect(v.capacitySeries(discId)).toBeDefined();
    expect(v.capacityAt(discId, v.firstMs + 3000)).toBeGreaterThan(0); // Smite counts in 'all' mode
  });
});
