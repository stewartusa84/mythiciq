import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import { SpellTable } from '../src/spells/spellTable.js';
import { computeInterruptAccountability } from '../src/analytics/seed/interruptAccountability.js';

const BOSS = 'Creature-0-0-0-0-0BOSS';
const ROGUE = 'Player-1-3001'; // spec 259 → Kick (1766), cd 15s
const DK = 'Player-1-3002'; // spec 251 → Mind Freeze (47528), cd 15s
const HEALER = 'Player-1-3003'; // spec 257 (Holy Priest) → not a DPS, excluded
const WHOLE_MS = { startMs: -Infinity, endMs: Infinity };

// 7001 = dangerous interruptible; 7002 = interruptible but regular priority.
const TABLE = SpellTable.fromData(
  { spells: [{ spellId: 7001, interruptible: true }, { spellId: 7002, interruptible: true }] },
  { spells: { '7001': { interruptPriority: 'dangerous' } } },
);

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}
// 26-field COMBATANT_INFO so specId lands at index 25 (the parser reads opt_at(25)).
function combatantInfo(guid: string, specId: number): string {
  const fields = ['COMBATANT_INFO', guid, ...Array(23).fill('0')];
  fields[25] = String(specId);
  return `${ts(0)}  ${fields.join(',')}`;
}
function interrupt(t: number, src: string, srcN: string, interruptSpellId: number, extraSpellId: number): string {
  return `${ts(t)}  SPELL_INTERRUPT,${src},"${srcN}",0x512,0x0,${BOSS},"Boss",0xa48,0x0,${interruptSpellId},"Kick",0x1,${extraSpellId},"Cast",0x1`;
}
function castSuccess(t: number, spellId: number): string {
  return `${ts(t)}  SPELL_CAST_SUCCESS,${BOSS},"Boss",0xa48,0x0,${BOSS},"Boss",0xa48,0x0,${spellId},"Big Cast",0x1`;
}
function dmg(t: number, dst: string, dstN: string, spellId: number, amount: number): string {
  return `${ts(t)}  SPELL_DAMAGE,${BOSS},"Boss",0xa48,0x0,${dst},"${dstN}",0x512,0x0,${spellId},"Mechanic",0x1,${amount},0,0x1,0,0,0,nil,nil,nil,nil`;
}
function unitDied(t: number, dst: string, dstN: string): string {
  return `${ts(t)}  UNIT_DIED,0000000000000000,nil,0x0,0x0,${dst},"${dstN}",0x512,0x0`;
}

let wasm: Uint8Array<ArrayBuffer>;
async function parse(lines: string[]): Promise<ParsedLog> {
  wasm ??= await loadWasmBytes();
  return parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
}

beforeAll(async () => {
  wasm = await loadWasmBytes();
});

describe('interrupt accountability (per DPS)', () => {
  it('credits kicks, blames only available-but-unused misses, and sums the damage they allowed', async () => {
    const parsed = await parse([
      combatantInfo(ROGUE, 259),
      combatantInfo(DK, 251),
      combatantInfo(HEALER, 257),
      interrupt(1.0, ROGUE, 'Rogue', 1766, 7001), // ROGUE kicks a dangerous cast → CD until 16s
      castSuccess(10.0, 7001), // went off: ROGUE on CD (not blamed), DK available → DK missed
      dmg(10.5, ROGUE, 'Rogue', 7001, 5000), // party damage from that cast (within 8s)
      dmg(11.0, DK, 'Dk', 7001, 3000),
      castSuccess(20.0, 7001), // went off: ROGUE off CD now + DK available → both missed
      dmg(21.0, ROGUE, 'Rogue', 7001, 1000),
    ]);
    const r = computeInterruptAccountability(parsed.store, TABLE, WHOLE_MS);

    expect(r.dangerousInterrupted).toBe(1);
    expect(r.dangerousCompleted).toBe(2);
    expect(r.players).toHaveLength(2); // healer excluded

    const rogue = r.players.find((p) => p.name === 'Rogue')!;
    const dk = r.players.find((p) => p.name === 'Dk')!;

    expect(rogue.interruptSpellId).toBe(1766);
    expect(rogue.interrupted).toBe(1);
    expect(rogue.missed).toBe(1); // only the 20s cast (on CD at 10s)
    expect(rogue.damageAllowed).toBe(1000); // 20s cast's damage only

    expect(dk.interruptSpellId).toBe(47528);
    expect(dk.interrupted).toBe(0);
    expect(dk.missed).toBe(2); // both completed casts
    expect(dk.damageAllowed).toBe(9000); // 8000 (10s cast) + 1000 (20s cast)
  });

  it('still blames a player on cooldown from interrupting a REGULAR cast (wasting it on trash is no excuse)', async () => {
    const parsed = await parse([
      combatantInfo(ROGUE, 259),
      interrupt(1.0, ROGUE, 'Rogue', 1766, 7002), // kicked a REGULAR (non-dangerous) cast → not an excuse
      castSuccess(5.0, 7001), // dangerous goes off 4s later (interrupt physically on CD, but mismanaged)
    ]);
    const r = computeInterruptAccountability(parsed.store, TABLE, WHOLE_MS);
    const rogue = r.players.find((p) => p.name === 'Rogue')!;
    expect(rogue.interrupted).toBe(0); // the regular kick isn't a dangerous interrupt
    expect(rogue.missed).toBe(1); // blamed: they had it available for what mattered and spent it on trash
  });

  it('does NOT blame a player who is on cooldown from interrupting another DANGEROUS cast', async () => {
    const parsed = await parse([
      combatantInfo(ROGUE, 259),
      interrupt(1.0, ROGUE, 'Rogue', 1766, 7001), // kicked a DANGEROUS cast → legitimately busy
      castSuccess(5.0, 7001), // another dangerous 4s later — couldn't have kicked both
    ]);
    const r = computeInterruptAccountability(parsed.store, TABLE, WHOLE_MS);
    const rogue = r.players.find((p) => p.name === 'Rogue')!;
    expect(rogue.interrupted).toBe(1);
    expect(rogue.missed).toBe(0); // excused — interrupt was on CD from a dangerous interrupt
  });

  it('does not blame a dead player for a cast that went off while they were down', async () => {
    const parsed = await parse([
      combatantInfo(ROGUE, 259),
      combatantInfo(DK, 251),
      unitDied(5.0, DK, 'Dk'), // DK dies before the cast
      castSuccess(10.0, 7001), // ROGUE available → blamed; DK dead → not blamed
      dmg(10.5, ROGUE, 'Rogue', 7001, 500), // ROGUE appears as an actor (+ alive)
    ]);
    const r = computeInterruptAccountability(parsed.store, TABLE, WHOLE_MS);
    const rogue = r.players.find((p) => p.name === 'Rogue')!;
    const dk = r.players.find((p) => p.name === 'Dk')!;
    expect(rogue.missed).toBe(1);
    expect(dk.missed).toBe(0);
  });
});
