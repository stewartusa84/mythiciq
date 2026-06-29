import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import { Primitives } from '../src/analytics/primitives/index.js';
import { computeClutchPlays } from '../src/analytics/seed/clutchPlays.js';

const BOSS = 'Creature-0-0-0-0-0BOSS';
const PALA = 'Player-1-4001';
const PRIEST = 'Player-1-4002';
const TANK = 'Player-1-4003';
const ALLY = 'Player-1-4004';
const WHOLE_MS = { startMs: -Infinity, endMs: Infinity };

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}
function adv(infoGuid: string, cur: number, max: number): string {
  return [infoGuid, '0000000000000000', cur, max, 0, 0, 0, 0, 0, 0, 0, 100, 100, 0, '0.0', '0.0', '2000', '0.0', 600].join(',');
}
// Boss damage on a player, carrying the player's advanced HP snapshot (seeds the HP timeline + counts as damage taken).
function advDamage(t: number, dst: string, dstN: string, cur: number, max: number, amount: number): string {
  return `${ts(t)}  SPELL_DAMAGE,${BOSS},"Boss",0xa48,0x0,${dst},"${dstN}",0x512,0x0,99999,"Hit",0x1,${adv(dst, cur, max)},${amount},${amount},0,1,0,0,0,nil,nil,nil,ST`;
}
function auraApplied(t: number, src: string, srcN: string, dst: string, dstN: string, spellId: number): string {
  return `${ts(t)}  SPELL_AURA_APPLIED,${src},"${srcN}",0x512,0x0,${dst},"${dstN}",0x512,0x0,${spellId},"Save",0x1,BUFF`;
}
function castSuccess(t: number, src: string, srcN: string, dst: string, dstN: string, spellId: number): string {
  return `${ts(t)}  SPELL_CAST_SUCCESS,${src},"${srcN}",0x512,0x0,${dst},"${dstN}",0x512,0x0,${spellId},"Grip",0x1`;
}
function unitDied(t: number, dst: string, dstN: string): string {
  return `${ts(t)}  UNIT_DIED,0000000000000000,nil,0x0,0x0,${dst},"${dstN}",0x512,0x0`;
}

let wasm: Uint8Array<ArrayBuffer>;
async function clutch(lines: string[]) {
  wasm ??= await loadWasmBytes();
  const parsed: ParsedLog = await parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
  return computeClutchPlays(parsed.store, Primitives.for(parsed.store), WHOLE_MS);
}

beforeAll(async () => {
  wasm = await loadWasmBytes();
});

describe('clutch plays', () => {
  it('credits a reactive save on a critically low ally as a life saved', async () => {
    const r = await clutch([
      advDamage(1.0, TANK, 'Tank', 15000, 100000, 50000), // Tank at 15%
      auraApplied(2.0, PALA, 'Pala', TANK, 'Tank', 6940), // Blessing of Sacrifice
    ]);
    expect(r.plays).toHaveLength(1);
    const p = r.plays[0]!;
    expect(p.spellName).toBe('Blessing of Sacrifice');
    expect(p.casterName).toBe('Pala');
    expect(p.targetName).toBe('Tank');
    expect(p.kind).toBe('damage-reduction');
    expect(p.targetHpFraction).toBeCloseTo(0.15, 5);
    expect(p.lifeSaved).toBe(true);
    expect(r.byCaster[0]).toMatchObject({ name: 'Pala', plays: 1, lifeSaved: 1 });
  });

  it('credits a proactive external by damage weathered even when HP was high at cast', async () => {
    const r = await clutch([
      advDamage(1.0, TANK, 'Tank', 95000, 100000, 5000), // 95% when cast lands
      auraApplied(2.0, PALA, 'Pala', TANK, 'Tank', 6940),
      advDamage(3.0, TANK, 'Tank', 40000, 100000, 55000), // weathered 55% of max HP in the window
    ]);
    expect(r.plays).toHaveLength(1);
    const p = r.plays[0]!;
    expect(p.damageWeathered).toBe(55000);
    expect(p.lifeSaved).toBe(false); // wasn't critically low
    expect(p.survived).toBe(true);
  });

  it('does not flatter a routine cast on a healthy ally that weathered nothing', async () => {
    const r = await clutch([
      advDamage(1.0, TANK, 'Tank', 95000, 100000, 5000),
      auraApplied(2.0, PALA, 'Pala', TANK, 'Tank', 6940),
    ]);
    expect(r.plays).toHaveLength(0);
  });

  it('does not credit a save when the ally dies anyway', async () => {
    const r = await clutch([
      advDamage(1.0, TANK, 'Tank', 12000, 100000, 50000), // 12%
      auraApplied(2.0, PALA, 'Pala', TANK, 'Tank', 6940),
      unitDied(4.0, TANK, 'Tank'), // died within the survive window
    ]);
    const p = r.plays[0]!;
    expect(p.survived).toBe(false);
    expect(p.lifeSaved).toBe(false); // still a clutch attempt (low HP), but not a save
  });

  it('credits a pull (Leap of Faith) on a low ally via the HP signal', async () => {
    const r = await clutch([
      advDamage(1.0, ALLY, 'Ally', 18000, 100000, 50000), // 18%
      castSuccess(2.0, PRIEST, 'Priest', ALLY, 'Ally', 73325), // Leap of Faith
    ]);
    expect(r.plays).toHaveLength(1);
    const p = r.plays[0]!;
    expect(p.kind).toBe('pull');
    expect(p.spellName).toBe('Leap of Faith');
    expect(p.lifeSaved).toBe(true);
  });
});
