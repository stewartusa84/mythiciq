import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import { loadSpellTable } from '../src/spells/nodeSpellTable.js';
import { SpellTable } from '../src/spells/spellTable.js';
import { computeVerifiedCredit, splitNameRealm } from '../src/analytics/verifiedCredit.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/mini-run.log', import.meta.url));

let parsed: ParsedLog;
let table: SpellTable;

beforeAll(async () => {
  const wasm = await loadWasmBytes();
  const raw = await readFile(FIXTURE);
  const bytes = new Uint8Array(raw.byteLength);
  bytes.set(raw);
  parsed = await parseLog(wasm, bytes);
  // The node spell table reads the generated mechanics bundle; fall back to empty if it's stale/missing
  // so the per-player join is still exercised (avoidable just reads 0).
  try {
    table = await loadSpellTable();
  } catch {
    table = SpellTable.empty();
  }
});

describe('splitNameRealm', () => {
  it('splits on the first dash and slugs the realm', () => {
    expect(splitNameRealm('Stabby-Twisting Nether')).toEqual({ name: 'Stabby', realmSlug: 'twisting-nether' });
    expect(splitNameRealm("Healz-Mal'Ganis")).toEqual({ name: 'Healz', realmSlug: 'malganis' });
    expect(splitNameRealm('Tankadin')).toEqual({ name: 'Tankadin', realmSlug: '' });
  });
});

describe('computeVerifiedCredit', () => {
  it('scores every party player in the carved run', () => {
    const credit = computeVerifiedCredit(parsed.store, parsed.segments, table);
    expect(credit).not.toBeNull();
    const c = credit!;

    // Run-level metadata off the CHALLENGE_MODE bracket.
    expect(c.dungeon).toBe('Pit of Saron');
    expect(c.keyLevel).toBe(12);
    expect(c.completed).toBe(true);

    // The five named players in the run are all scored (Tankadin/Healpriest/Stabby/Boomy/Pewpew).
    const names = c.players.map((p) => p.name).sort();
    expect(names).toEqual(['Boomy', 'Healpriest', 'Pewpew', 'Stabby', 'Tankadin']);

    // Stabby is the one who died → one mechanic failure; everyone else clean of failures.
    const stabby = c.players.find((p) => p.name === 'Stabby')!;
    expect(stabby.mechanicFailures).toBe(1);
    expect(stabby.praise.deaths).toBe(1);
    for (const p of c.players) {
      if (p.name !== 'Stabby') expect(p.mechanicFailures).toBe(0);
    }

    // DPS ranks are assigned to the players who dealt damage (1-based, dense among contributors).
    const ranked = c.players.filter((p) => p.praise.dpsRank != null).map((p) => p.praise.dpsRank!);
    expect(ranked.length).toBeGreaterThan(0);
    expect(Math.min(...ranked)).toBe(1);
    expect(new Set(ranked).size).toBe(ranked.length); // no duplicate ranks

    // Healpriest is the only healer → HPS rank 1, and no damage rank.
    const healer = c.players.find((p) => p.name === 'Healpriest')!;
    expect(healer.praise.hpsRank).toBe(1);
  });
});
