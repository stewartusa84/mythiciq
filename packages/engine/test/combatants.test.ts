import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import { buildCombatants, computeItemLevel, parseTalents, parseGear, parseAuras } from '../src/analytics/combatants.js';

const GUID = 'Player-127-0552A080';

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 15:01:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}

// A Holy Paladin (spec 65) COMBATANT_INFO with the real sample's stat values, plus compact
// talents/gear/auras blobs. Flat indices match fieldspec.rs (0 = the COMBATANT_INFO token).
function combatantInfo(): string {
  const f: string[] = Array(34).fill('0');
  f[0] = 'COMBATANT_INFO';
  f[1] = GUID;
  f[3] = '641'; // primaryStat
  f[5] = '21845'; // stamina
  f[11] = f[12] = f[13] = '673'; // crit triple
  f[14] = '71'; // speed
  f[15] = '28'; // leech
  f[16] = f[17] = f[18] = '908'; // haste triple
  f[19] = '67'; // avoidance
  f[20] = '420'; // mastery
  f[21] = f[22] = f[23] = '210'; // versatility triple
  f[24] = '3242'; // armor
  f[25] = '65'; // specId (Holy Paladin)
  f[26] = '[(81496,102465,1),(81508,102477,2)]'; // talents
  f[27] = '(0,0,199324,0)'; // pvp talents
  // gear: 2 real items + 1 empty slot (should be dropped); ilvls 276 & 289 → avg 283
  f[28] = '[(151333,276,(),(13440,6652,12667),()),(151309,289,(7999,0,0),(13440,6652),(240888,295)),(0,0,(),(),())]';
  f[29] = '[Player-127-0552A080,465,1,Player-60-0FA121CB,1126,1]'; // combat-start auras
  return `${ts(0)}  ${f.join(',')}`;
}

let wasm: Uint8Array<ArrayBuffer>;
async function parse(lines: string[]): Promise<ParsedLog> {
  wasm ??= await loadWasmBytes();
  return parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
}

beforeAll(async () => {
  wasm = await loadWasmBytes();
});

describe('combatant-info parsers', () => {
  it('parses the talent triples', () => {
    const t = parseTalents('[(81496,102465,1),(81508,102477,2)]');
    expect(t).toHaveLength(2);
    expect(t[0]).toEqual({ nodeId: 81496, entryId: 102465, rank: 1 });
    expect(t[1]!.rank).toBe(2);
    expect(parseTalents(undefined)).toEqual([]);
  });

  it('parses gear with full structure and drops empty slots', () => {
    const g = parseGear('[(151333,276,(),(13440,6652,12667),()),(151309,289,(7999,0,0),(13440,6652),(240888,295)),(0,0,(),(),())]');
    expect(g).toHaveLength(2); // empty (0,...) slot dropped
    expect(g[0]).toEqual({ slot: 0, itemId: 151333, itemLevel: 276, enchantIds: [], bonusIds: [13440, 6652, 12667], gemIds: [] });
    expect(g[1]!.slot).toBe(1); // slot index preserved across the empty-slot drop
    expect(g[1]!.enchantIds).toEqual([7999]); // trailing 0,0 stripped
    expect(g[1]!.gemIds).toEqual([240888, 295]);
  });

  it('computeItemLevel excludes the cosmetic shirt + tabard slots', () => {
    // 18 positional slots: a normal kit at ilvl 250, with an ilvl-1 shirt (slot 3) and empty tabard
    // (slot 17). Including the shirt would drag the average down (the reported "ilvl too low" bug).
    const entries: string[] = [];
    for (let s = 0; s < 18; s++) {
      if (s === 3) entries.push('(45668,1,(),(),())'); // cosmetic shirt
      else if (s === 17) entries.push('(0,0,(),(),())'); // empty tabard
      else entries.push(`(${1000 + s},250,(),(),())`);
    }
    const gear = parseGear(`[${entries.join(',')}]`);
    expect(computeItemLevel(gear)).toBe(250); // shirt + tabard ignored ⇒ exactly 250, not dragged down
  });

  it('computeItemLevel counts a two-handed weapon (empty off-hand) twice', () => {
    // 16 armor/accessory slots at 250 + a 280 main-hand (slot 15) and an EMPTY off-hand (slot 16).
    const entries: string[] = [];
    for (let s = 0; s < 17; s++) {
      if (s === 3) entries.push('(45668,1,(),(),())'); // shirt (ignored)
      else if (s === 15) entries.push('(9999,280,(),(),())'); // 2H main-hand
      else if (s === 16) entries.push('(0,0,(),(),())'); // empty off-hand
      else entries.push(`(${1000 + s},250,(),(),())`);
    }
    const gear = parseGear(`[${entries.join(',')}]`);
    // 14 pieces @250 + main-hand @280 counted twice = (14*250 + 2*280) / 16 = 253.75 → 254
    expect(computeItemLevel(gear)).toBe(254);
  });

  it('parses combat-start auras as guid/spell pairs', () => {
    const a = parseAuras('[Player-127-0552A080,465,1,Player-60-0FA121CB,1126,1]');
    expect(a).toEqual([
      { sourceGuid: 'Player-127-0552A080', spellId: 465 },
      { sourceGuid: 'Player-60-0FA121CB', spellId: 1126 },
    ]);
  });
});

describe('buildCombatants (corrected stat offsets)', () => {
  it('reads the right crit/haste/mastery/vers from COMBATANT_INFO', async () => {
    const parsed = await parse([combatantInfo()]);
    const combatants = buildCombatants(parsed.store);
    expect(combatants).toHaveLength(1);
    const c = combatants[0]!;
    expect(c.guid).toBe(GUID);
    expect(c.specId).toBe(65);
    // The previous off-by-one bug read crit from a field that's always 0; assert the fix.
    expect(c.stats.crit).toBe(673);
    expect(c.stats.haste).toBe(908);
    expect(c.stats.mastery).toBe(420);
    expect(c.stats.versatility).toBe(210);
    expect(c.stats.speed).toBe(71);
    expect(c.stats.leech).toBe(28);
    expect(c.stats.avoidance).toBe(67);
    expect(c.stats.armor).toBe(3242);
    expect(c.stats.primary).toBe(641);
    expect(c.stats.stamina).toBe(21845);
    // gear + talents + ilvl
    expect(c.talents).toHaveLength(2);
    expect(c.gear).toHaveLength(2);
    expect(c.itemLevel).toBe(283); // round((276+289)/2)
    expect(c.auras).toHaveLength(2);
  });
});
