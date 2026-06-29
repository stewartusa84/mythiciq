import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog } from '../src/pipeline.js';
import { buildRoster } from '../src/analytics/roster.js';
import { anonymizeLog } from '../src/anonymize.js';

// The anonymizer rewrites player names in a sub-log (for sharing a run publicly) WITHOUT changing the
// log's structure, so the anonymized bytes still parse identically. These tests are the correctness
// gate: no real name may survive, everything else must be byte-for-byte intact, and the parse must match.

let wasmBytes: Awaited<ReturnType<typeof loadWasmBytes>>;
beforeAll(async () => {
  wasmBytes = await loadWasmBytes();
});

const ts = (s: number) => `6/6/2026 22:00:${String(s).padStart(2, '0')}.000-0500`;

// A small but representative run: player→creature damage, player→player heal, creature→player damage,
// a COMBATANT_INFO (GUID, no name), and a death. Five named party players.
const LOG = [
  `${ts(0)}  COMBAT_LOG_VERSION,21,ADVANCED_LOG_ENABLED,1,BUILD_VERSION,11.0.0,PROJECT_ID,1`,
  `${ts(1)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,12,[10,9,147]`,
  `${ts(2)}  COMBATANT_INFO,Player-1-0000001,0,1,2,3,4`,
  `${ts(3)}  SPELL_DAMAGE,Player-1-0000001,"Tankadin",0x511,0x0,Creature-0-0-0-0-0001,"Risen Ghoul",0xa48,0x0,100780,"Tiger Palm",0x1,1000,0,0x1,0,0,0,nil,nil,nil,nil`,
  `${ts(4)}  SPELL_HEAL,Player-1-0000002,"Healpriest",0x511,0x0,Player-1-0000001,"Tankadin",0x511,0x0,8936,"Regrowth",0x8,1500,500,0,nil`,
  `${ts(5)}  SPELL_DAMAGE,Player-1-0000003,"Stabby",0x511,0x0,Creature-0-0-0-0-0001,"Risen Ghoul",0xa48,0x0,1822,"Rake",0x1,2000,0,0x1,0,0,0,nil,nil,nil,nil`,
  `${ts(6)}  SPELL_DAMAGE,Player-1-0000005,"Boomy",0x511,0x0,Creature-0-0-0-0-0001,"Risen Ghoul",0xa48,0x0,190984,"Wrath",0x40,2500,0,0x40,0,0,0,nil,nil,nil,nil`,
  `${ts(7)}  SPELL_DAMAGE,Creature-0-0-0-0-0001,"Risen Ghoul",0xa48,0x0,Player-1-0000004,"Pewpew",0x511,0x0,9999,"Ghoul Strike",0x1,300,0,0x1,0,0,0,nil,nil,nil,nil`,
  `${ts(8)}  UNIT_DIED,0000000000000000,nil,0x0,0x0,Creature-0-0-0-0-0001,"Risen Ghoul",0xa48,0x0`,
  `${ts(9)}  CHALLENGE_MODE_END,658,1,12,1620000,250.500000,2810.300000`,
].join('\n') + '\n';

const REAL_NAMES = ['Tankadin', 'Healpriest', 'Stabby', 'Boomy', 'Pewpew'];
const ALIASES = new Map<string, string>([
  ['Player-1-0000001', 'Tank'],
  ['Player-1-0000002', 'Healer'],
  ['Player-1-0000003', 'DPS 1'],
  ['Player-1-0000004', 'DPS 2'],
  ['Player-1-0000005', 'DPS 3'],
]);

function anonText(): string {
  const out = anonymizeLog(new TextEncoder().encode(LOG), ALIASES);
  return new TextDecoder().decode(out);
}

describe('anonymizeLog', () => {
  it('removes every real player name and substitutes the alias', () => {
    const text = anonText();
    for (const name of REAL_NAMES) expect(text).not.toContain(`"${name}"`);
    for (const alias of ALIASES.values()) expect(text).toContain(`"${alias}"`);
  });

  it('leaves non-name content untouched (GUIDs, creature + spell names, COMBATANT_INFO)', () => {
    const text = anonText();
    expect(text).toContain('"Risen Ghoul"'); // creature name (after a Creature- GUID) — not a player
    expect(text).toContain('"Tiger Palm"'); // spell name — follows a numeric spellId, not a GUID
    expect(text).toContain('"Wrath"');
    expect(text).toContain('COMBATANT_INFO,Player-1-0000001,0,1,2,3,4'); // GUID, no name → unchanged
    for (const guid of ALIASES.keys()) expect(text).toContain(guid); // GUIDs preserved
  });

  it('is lossless on structure — same line count and per-line field count', () => {
    const before = LOG.split('\n');
    const after = anonText().split('\n');
    expect(after.length).toBe(before.length);
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!.split(',').length).toBe(before[i]!.split(',').length);
    }
  });

  it('parses identically — same event count, roster names become the aliases', async () => {
    const original = await parseLog(wasmBytes, new TextEncoder().encode(LOG));
    const anon = await parseLog(wasmBytes, anonymizeLog(new TextEncoder().encode(LOG), ALIASES));
    expect(anon.store.count).toBe(original.store.count);

    const names = new Set(buildRoster(anon.store).map((r) => r.name));
    for (const name of REAL_NAMES) expect(names.has(name)).toBe(false);
    for (const alias of ALIASES.values()) expect(names.has(alias)).toBe(true);
  });

  it('returns the input unchanged when the alias map is empty', () => {
    const raw = new TextEncoder().encode(LOG);
    const out = anonymizeLog(raw, new Map());
    expect(new TextDecoder().decode(out)).toBe(LOG);
  });

  it('leaves a player GUID that is not in the map alone', () => {
    const partial = new Map([['Player-1-0000001', 'Tank']]);
    const text = new TextDecoder().decode(anonymizeLog(new TextEncoder().encode(LOG), partial));
    expect(text).toContain('"Tank"');
    expect(text).toContain('"Healpriest"'); // not in the map → untouched
  });
});
