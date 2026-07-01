import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog } from '../src/pipeline.js';
import { computeDamageTakenByEnemy } from '../src/analytics/seed/damageTakenByEnemy.js';
import { SpellTable } from '../src/spells/spellTable.js';

// A table where spell 1000 comes from an interruptible cast and 1001 is a dispellable (magic) debuff.
const TABLE = SpellTable.fromData(
  { spells: [] },
  { spells: { '1000': { interruptPriority: 'dangerous' } } },
  {
    categories: [{ id: 'magic', label: 'Magic', kind: 'school', logSignature: 'dispel-event' }],
    removers: {},
    debuffs: { Dungeon: { '1001': { name: 'Hex', priority: 'dangerous', removableBy: ['magic'] } } },
  },
);
const EMPTY = SpellTable.empty();

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}
const P1 = 'Player-1-0001';
const P2 = 'Player-1-0002';
const mob = (npc: number, spawn: number) => `Creature-0-0-0-0-${npc}-${String(spawn).padStart(6, '0')}`;

// Enemy (hostile 0xa48) → player (friendly 0x512) SPELL_DAMAGE with an explicit amount.
const enemyHit = (t: number, src: string, tgt: string, spellId: number, amount: number, spellName = 'Bad'): string =>
  `${ts(t)}  SPELL_DAMAGE,${src},"Mob",0xa48,0x0,${tgt},"P",0x512,0x0,${spellId},"${spellName}",0x1,${amount},0,0x1,0,0,0,nil,nil,nil,nil`;
// Player → enemy (should be ignored — this analytic is damage TAKEN by players).
const playerHit = (t: number, tgt: string, spellId = 42): string =>
  `${ts(t)}  SPELL_DAMAGE,${P1},"P",0x512,0x0,${tgt},"Mob",0xa48,0x0,${spellId},"Poke",0x1,500,0,0x1,0,0,0,nil,nil,nil,nil`;
// Nil-GUID source (reflect / environmental) → player: should be filtered out.
const nilHit = (t: number, tgt: string, amount: number): string =>
  `${ts(t)}  SPELL_DAMAGE,0000000000000000,nil,0x80000000,0x0,${tgt},"P",0x512,0x0,32379,"Shadow Word: Death",0x20,${amount},0,0x20,0,0,0,nil,nil,nil,nil`;

let wasm: Awaited<ReturnType<typeof loadWasmBytes>>;
beforeAll(async () => {
  wasm = await loadWasmBytes();
});
async function run(lines: string[], table = EMPTY) {
  const parsed = await parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
  return computeDamageTakenByEnemy(parsed.store, table, { start: 0, end: parsed.store.count });
}

describe('computeDamageTakenByEnemy', () => {
  it('groups every instance of the same npc type into one row and ranks by total', async () => {
    const boss = mob(900, 1);
    const addA = mob(801, 1);
    const addB = mob(801, 2); // same npc type, different spawn
    const res = await run([
      enemyHit(1, boss, P1, 1000, 5000, 'Cleave'),
      enemyHit(2, addA, P1, 2000, 800, 'Nip'),
      enemyHit(3, addB, P2, 2000, 1200, 'Nip'),
      playerHit(4, boss), // ignored
    ]);

    expect(res.totalTaken).toBe(7000);
    expect(res.byEnemy).toHaveLength(2);
    const [top, second] = res.byEnemy;
    // Boss (5000) outranks the two adds combined (2000).
    expect(top!.npcId).toBe(900);
    expect(top!.total).toBe(5000);
    expect(top!.instances).toBe(1);
    // Both add spawns collapse into one npc-type row with two instances.
    expect(second!.npcId).toBe(801);
    expect(second!.total).toBe(2000);
    expect(second!.instances).toBe(2);
  });

  it('breaks down each enemy by ability and by which player took the damage', async () => {
    const boss = mob(900, 1);
    const res = await run([
      enemyHit(1, boss, P1, 1000, 4000, 'Cleave'),
      enemyHit(2, boss, P2, 1000, 1000, 'Cleave'),
      enemyHit(3, boss, P1, 1001, 500, 'Spike'),
    ]);

    expect(res.byEnemy).toHaveLength(1);
    const row = res.byEnemy[0]!;
    expect(row.total).toBe(5500);
    expect(row.hits).toBe(3);
    // Abilities ranked: Cleave (5000) then Spike (500).
    expect(row.bySpell.map((s) => [s.id, s.value])).toEqual([[1000, 5000], [1001, 500]]);
    // Targets ranked: P1 (4500) then P2 (1000).
    expect(row.byTarget.map((t) => t.value)).toEqual([4500, 1000]);
  });

  it('ignores mob-on-mob damage (target must be a player)', async () => {
    const res = await run([
      // hostile → hostile: not damage taken by a player
      enemyHit(1, mob(900, 1), mob(801, 1), 1000, 999, 'Friendly Fire'),
    ]);
    expect(res.totalTaken).toBe(0);
    expect(res.byEnemy).toHaveLength(0);
  });

  it('filters out nil-GUID (reflected/environmental) sources', async () => {
    const boss = mob(900, 1);
    const res = await run([
      enemyHit(1, boss, P1, 1000, 3000, 'Cleave'),
      nilHit(2, P1, 800), // Shadow Word: Death reflect — no real enemy
      nilHit(3, P2, 400),
    ]);
    expect(res.totalTaken).toBe(3000);
    expect(res.byEnemy).toHaveLength(1);
    expect(res.byEnemy[0]!.npcId).toBe(900);
  });

  it('splits each enemy into interruptible-cast / dispellable-debuff / other', async () => {
    const boss = mob(900, 1);
    const res = await run(
      [
        enemyHit(1, boss, P1, 1000, 3000, 'Interruptible'), // interruptPriority set → interruptible
        enemyHit(2, boss, P1, 1001, 2000, 'Hex'), // dispellable magic debuff
        enemyHit(3, boss, P1, 7, 500, 'Melee'), // uncurated → other
      ],
      TABLE,
    );
    expect(res.split).toEqual({ interruptible: 3000, dispellable: 2000, other: 500 });
    const row = res.byEnemy[0]!;
    expect(row.split).toEqual({ interruptible: 3000, dispellable: 2000, other: 500 });
  });
});
