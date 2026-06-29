import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import { SpellTable } from '../src/spells/spellTable.js';
import { computeRemoval } from '../src/analytics/seed/removal.js';
import { discoverRemovals } from '../src/analytics/discovery.js';

const BOSS = 'Creature-0-0-0-0-0BOSS';
const P1 = 'Player-1-2002';
const P2 = 'Player-1-2003';
const HEALER = 'Player-1-2004';
const WHOLE_MS = { startMs: -Infinity, endMs: Infinity };

// 8101 snare-only debuff, 8102 magic debuff, 8103 healing-absorb (10s).
// 9001 snare remover, 9002 magic remover. 7777 is an UNKNOWN remover (not curated).
const TABLE = SpellTable.fromData(
  { spells: [] },
  { spells: {} },
  {
    categories: [
      { id: 'magic', label: 'Magic', kind: 'school', logSignature: 'dispel-event' },
      { id: 'snare', label: 'Snare', kind: 'mechanic', logSignature: 'dispel-event' },
      { id: 'healing-absorb', label: 'Healing Absorb', kind: 'special', logSignature: 'heal-through' },
    ],
    removers: {
      '9001': { name: 'Snare Break', provides: ['snare'], scope: 'external' },
      '9002': { name: 'Dispel Magic', provides: ['magic'], scope: 'external' },
    },
    debuffs: {
      _meta: { note: 'x' } as never,
      Test: {
        '8101': { name: 'Snare DoT', priority: 'dangerous', removableBy: ['snare'] },
        '8102': { name: 'Magic DoT', priority: 'dangerous', removableBy: ['magic'] },
        '8103': { name: 'Heal Absorb', priority: 'dangerous', removableBy: ['healing-absorb'] },
      },
    },
  },
  { facts: { '8101': { durationSeconds: 5 }, '8103': { durationSeconds: 10 } } },
);

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/7/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}
function debuffApplied(t: number, dst: string, dstN: string, spellId: number): string {
  return `${ts(t)}  SPELL_AURA_APPLIED,${BOSS},"Boss",0xa48,0x0,${dst},"${dstN}",0x512,0x0,${spellId},"Aura",0x1,DEBUFF`;
}
function debuffRemoved(t: number, dst: string, dstN: string, spellId: number): string {
  return `${ts(t)}  SPELL_AURA_REMOVED,${dst},"${dstN}",0x512,0x0,${dst},"${dstN}",0x512,0x0,${spellId},"Aura",0x1,DEBUFF`;
}
// A remover landing AS A BUFF on a player (e.g. Blessing of Freedom) — source is the caster, dest the
// protected player. The clear it causes logs only as a SPELL_AURA_REMOVED on the debuff (no dispel).
function buffApplied(t: number, src: string, srcN: string, dst: string, dstN: string, spellId: number): string {
  return `${ts(t)}  SPELL_AURA_APPLIED,${src},"${srcN}",0x512,0x0,${dst},"${dstN}",0x512,0x0,${spellId},"Buff",0x1,BUFF`;
}
// SPELL_DISPEL: <remover>,"<removerName>",school, <extraSpellId>,"<extraName>",extraSchool, auraType
function dispel(t: number, src: string, srcN: string, dst: string, dstN: string, remover: number, removed: number, removedName = 'Debuff', auraType = 'DEBUFF'): string {
  return `${ts(t)}  SPELL_DISPEL,${src},"${srcN}",0x512,0x0,${dst},"${dstN}",0x512,0x0,${remover},"Remover",0x1,${removed},"${removedName}",0x1,${auraType}`;
}

let wasm: Uint8Array<ArrayBuffer>;
async function parse(lines: string[]): Promise<ParsedLog> {
  wasm ??= await loadWasmBytes();
  return parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
}
beforeAll(async () => {
  wasm = await loadWasmBytes();
});

describe('removal.cleanse analytic', () => {
  it('scores mechanic removals via SPELL_DISPEL, misses, and heal-through separately', async () => {
    const parsed = await parse([
      debuffApplied(1.0, P1, 'Pone', 8101), // snare
      dispel(1.5, HEALER, 'Healbot', P1, 'Pone', 9001, 8101), // snare break -> removed (500ms)
      debuffApplied(2.0, P2, 'Ptwo', 8102), // magic
      debuffRemoved(8.0, P2, 'Ptwo', 8102), // expired, never dispelled -> missed (tool 9002 exists)
      debuffApplied(3.0, P1, 'Pone', 8103), // healing absorb (10s)
      debuffRemoved(8.0, P1, 'Pone', 8103), // healed off at +5s -> clearedEarly
    ]);
    const r = computeRemoval(parsed.store, TABLE, WHOLE_MS);

    expect(r.overall).toMatchObject({ applied: 2, removed: 1, missed: 1, missedRemovable: 1, healThrough: 1 });
    // 8102's only party remover seen is 9001 (snare) which can't clear magic → not party-classifiable.
    expect(r.overall.missedFixable).toBe(0);
    expect(r.overall.missedCooldownBlocked).toBe(0);

    const snare = r.byDebuff.find((d) => d.spellId === 8101)!;
    expect(snare.removed).toBe(1);
    expect(snare.latency.count).toBe(1);
    expect(snare.latency.percentiles.p50).toBe(500);

    const magic = r.byDebuff.find((d) => d.spellId === 8102)!;
    expect(magic).toMatchObject({ missed: 1, missedRemovable: 1, removed: 0 });

    expect(r.byRemover).toEqual([{ spellId: 9001, name: expect.any(String), count: 1 }]);
    expect(r.healThrough.find((h) => h.spellId === 8103)).toMatchObject({ applied: 1, clearedEarly: 1 });
  });

  it('credits immunity-buff clears (BoF-style) that fire no SPELL_DISPEL', async () => {
    const parsed = await parse([
      // snare on P1, then a snare-remover buff lands and the snare drops the SAME instant — no dispel.
      debuffApplied(1.0, P1, 'Pone', 8101),
      buffApplied(1.5, HEALER, 'Pally', P1, 'Pone', 9001),
      debuffRemoved(1.5, P1, 'Pone', 8101),
      // control: a magic debuff drops while only a SNARE remover buff is up → category mismatch → missed.
      debuffApplied(2.0, P2, 'Ptwo', 8102),
      buffApplied(5.0, HEALER, 'Pally', P2, 'Ptwo', 9001),
      debuffRemoved(5.0, P2, 'Ptwo', 8102),
    ]);
    const r = computeRemoval(parsed.store, TABLE, WHOLE_MS);

    const snare = r.byDebuff.find((d) => d.spellId === 8101)!;
    expect(snare).toMatchObject({ applied: 1, removed: 1, missed: 0 });
    expect(snare.latency.percentiles.p50).toBe(500); // apply→clear

    const magic = r.byDebuff.find((d) => d.spellId === 8102)!;
    expect(magic).toMatchObject({ removed: 0, missed: 1, missedRemovable: 1 });

    expect(r.overall).toMatchObject({ applied: 2, removed: 1, missed: 1 });
    expect(r.byRemover).toEqual([{ spellId: 9001, name: expect.any(String), count: 1 }]);
  });
});

// A Holy Paladin (spec 65) brings Cleanse (4987, 8s CD, clears magic). Models the healer scenario:
// one dispel, two simultaneous magic debuffs — one cleared, the other forced to heal-through.
const TABLE_CD = SpellTable.fromData(
  { spells: [] },
  { spells: {} },
  {
    categories: [{ id: 'magic', label: 'Magic', kind: 'school', logSignature: 'dispel-event' }],
    removers: { '4987': { name: 'Cleanse', provides: ['magic'], scope: 'external' } },
    debuffs: {
      _meta: { note: 'x' } as never,
      Test: {
        '8102': { name: 'Magic DoT', priority: 'dangerous', removableBy: ['magic'] },
        '8104': { name: 'Magic DoT Long', priority: 'dangerous', removableBy: ['magic'] },
      },
    },
  },
  { facts: { '8102': { durationSeconds: 5 }, '8104': { durationSeconds: 12 } } },
);
function combatantInfo(guid: string, specId: number): string {
  const fields = ['COMBATANT_INFO', guid, ...Array(23).fill('0')];
  fields[25] = String(specId);
  return `${ts(0)}  ${fields.join(',')}`;
}

describe('removal.cleanse — cooldown-blocked vs fixable misses', () => {
  it('blames cooldowns when the only dispel was spent, but flags fixable misses otherwise', async () => {
    const parsed = await parse([
      combatantInfo(HEALER, 65), // Holy Paladin → party has Cleanse (4987)
      // two magic debuffs land at once; the healer cleanses ONE → the other can't be (dispel on CD).
      debuffApplied(2.0, P1, 'Pone', 8102),
      debuffApplied(2.0, P2, 'Ptwo', 8102),
      dispel(2.1, HEALER, 'Pally', P1, 'Pone', 4987, 8102), // Cleanse spent here → 8s CD
      debuffRemoved(7.0, P2, 'Ptwo', 8102), // expired at +5s (< 8s CD) → cooldown-blocked
      // a long magic debuff that outlasts the cooldown → fixable (Cleanse comes back at +8s).
      debuffApplied(3.0, P2, 'Ptwo', 8104),
      debuffRemoved(15.0, P2, 'Ptwo', 8104), // expired at +12s → could've been cleansed at +8s
    ]);
    const r = computeRemoval(parsed.store, TABLE_CD, WHOLE_MS);

    expect(r.overall).toMatchObject({ removed: 1, missed: 2, missedFixable: 1, missedCooldownBlocked: 1 });

    const short = r.byDebuff.find((d) => d.spellId === 8102)!;
    expect(short).toMatchObject({ applied: 2, removed: 1, missed: 1, missedCooldownBlocked: 1, missedFixable: 0 });
    expect(short.removerCandidates).toEqual([{ spellId: 4987, name: expect.any(String) }]);

    const long = r.byDebuff.find((d) => d.spellId === 8104)!;
    expect(long).toMatchObject({ missed: 1, missedFixable: 1, missedCooldownBlocked: 0 });
    // Cleanse used at +2.1s (8s CD) ⇒ back at +10.1s; debuff ran to +15.0s ⇒ ~4.9s was trimmable.
    expect(long.removableSeconds).toBe(5);
    expect(r.overall.removableSeconds).toBe(5);

    // the fixable miss names Cleanse as the available-but-unused remover.
    expect(r.unusedRemovers).toEqual([{ spellId: 4987, name: expect.any(String), count: 1 }]);
    // active seconds: 8102 ran 5s (P1 cleared at +0) + 5s (P2) ; 8104 ran 12s — totals are surfaced.
    expect(r.overall.activeSeconds).toBeGreaterThan(0);
    expect(r.overall.missedCooldownBlockedSeconds).toBe(5);
  });
});

describe('discoverRemovals', () => {
  it('flags removals the table cannot explain, by reason', async () => {
    const parsed = await parse([
      debuffApplied(1.0, P1, 'Pone', 8101),
      dispel(1.2, HEALER, 'Healbot', P1, 'Pone', 9001, 8101), // explained (snare∩snare) -> NOT a discovery
      debuffApplied(2.0, P2, 'Ptwo', 8102),
      dispel(2.2, HEALER, 'Healbot', P2, 'Ptwo', 7777, 8102, 'Magic DoT'), // unknown remover
      debuffApplied(3.0, P1, 'Pone', 8101),
      dispel(3.2, HEALER, 'Healbot', P1, 'Pone', 9002, 8101), // known remover, wrong category -> capability-gap
      dispel(4.0, HEALER, 'Healbot', P1, 'Pone', 9001, 5555, 'Mystery'), // known remover, unknown debuff
      dispel(5.0, HEALER, 'Healbot', BOSS, 'Boss', 6666, 4444, 'Some Buff', 'BUFF'), // offensive purge -> ignored
    ]);
    const d = discoverRemovals(parsed.store, TABLE);

    expect(d.length).toBe(3); // 9001->8101 explained; the BUFF purge is excluded (cleanses only)
    expect(d.find((x) => x.removerSpellId === 6666)).toBeUndefined();
    expect(d.find((x) => x.removerSpellId === 7777)).toMatchObject({ removedSpellId: 8102, reason: 'unknown-remover' });
    expect(d.find((x) => x.removerSpellId === 9002)).toMatchObject({ removedSpellId: 8101, reason: 'capability-gap' });
    expect(d.find((x) => x.removerSpellId === 9001 && x.removedSpellId === 5555)).toMatchObject({ reason: 'unknown-debuff' });
  });

  it('discovers immunity-clear removers (no SPELL_DISPEL) of known removable debuffs', async () => {
    const parsed = await parse([
      // 7000 = an UNKNOWN buff that clears a known snare debuff at the same instant — no dispel.
      debuffApplied(1.0, P1, 'Pone', 8101),
      buffApplied(2.0, P1, 'Pone', P1, 'Pone', 7000),
      debuffRemoved(2.0, P1, 'Pone', 8101),
      // a KNOWN immunity remover (9001 snare break) clearing the same debuff → explained → NOT discovered.
      debuffApplied(3.0, P2, 'Ptwo', 8101),
      buffApplied(3.5, P2, 'Ptwo', P2, 'Ptwo', 9001),
      debuffRemoved(3.5, P2, 'Ptwo', 8101),
      // a buff applied far from any removal → no correlation.
      buffApplied(9.0, P1, 'Pone', P1, 'Pone', 7001),
    ]);
    const d = discoverRemovals(parsed.store, TABLE);

    expect(d.find((x) => x.removerSpellId === 7000)).toMatchObject({ removedSpellId: 8101, reason: 'unknown-remover', via: 'immunity' });
    expect(d.find((x) => x.removerSpellId === 9001)).toBeUndefined(); // curated remover → explained, not novel
    expect(d.find((x) => x.removerSpellId === 7001)).toBeUndefined(); // no coincident removal
  });
});
