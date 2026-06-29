import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import { createRegistry } from '../src/pipeline.js';
import { windowRange } from '../src/query/timeWindow.js';
import type { DeathsResult } from '../src/analytics/seed/deaths.js';
import type { DamageResult } from '../src/analytics/seed/damage.js';
import type { HealingResult } from '../src/analytics/seed/healing.js';
import type { InterruptsResult } from '../src/analytics/seed/interrupts.js';
import type { DamageTakenResult } from '../src/analytics/seed/damageTaken.js';

const here = dirname(fileURLToPath(import.meta.url));

let parsed: ParsedLog;
const registry = createRegistry();

function result<T>(id: string): T {
  const [r] = registry.run({ store: parsed.store, segments: parsed.segments }, [registry.get(id)!]);
  return r!.value as T;
}

beforeAll(async () => {
  const wasmBytes = await loadWasmBytes();
  const logBytes = new Uint8Array(await readFile(join(here, 'fixtures', 'sample.log')));
  parsed = await parseLog(wasmBytes, logBytes);
});

describe('columnar parse', () => {
  it('produces one row per kept event', () => {
    // 5 trash events + ENCOUNTER_START + 2 dmg + 2 UNIT_DIED (player + Chi-Ji despawn) + ENCOUNTER_END = 11
    expect(parsed.store.count).toBe(11);
  });

  it('keeps the timestamp column sorted ascending', () => {
    const { ts, count } = parsed.store;
    for (let i = 1; i < count; i++) expect(ts[i]!).toBeGreaterThanOrEqual(ts[i - 1]!);
  });

  it('resolves interned actor and spell names', () => {
    const names = parsed.store.actorIds().map((id) => parsed.store.actorName(id));
    expect(names).toContain('Stabby');
    expect(names).toContain('Tankadin');
    expect(names).toContain('Healpriest');
    expect(names).toContain('Test Boss');
  });
});

describe('segmentation', () => {
  it('splits into a trash pack and a boss encounter', () => {
    expect(parsed.segments).toHaveLength(2);
    const trash = parsed.segments.find((s) => s.kind === 'trash');
    const enc = parsed.segments.find((s) => s.kind === 'encounter');
    expect(trash).toBeDefined();
    expect(enc).toBeDefined();
    expect(enc!.name).toBe('Test Boss');
    expect(enc!.success).toBe(true);
    expect(enc!.encounterId).toBe(1234);
  });
});

describe('analytics', () => {
  it('counts player deaths, excluding pet/summon despawns', () => {
    const d = result<DeathsResult>('deaths');
    // Only the player death counts — the Chi-Ji guardian despawn (also a UNIT_DIED) is excluded.
    expect(d.count).toBe(1);
    expect(d.deaths[0]!.name).toBe('Stabby');
  });

  it('adds no timer penalty without a death-penalty affix', () => {
    const d = result<DeathsResult>('deaths');
    // The fixture has no CHALLENGE_MODE_START, so no affixes and no death-timer cost.
    expect(d.affixes).toEqual([]);
    expect(d.deathPenaltyActive).toBe(false);
    expect(d.perDeathPenaltySeconds).toBe(0);
    expect(d.timerPenaltySeconds).toBe(0);
  });

  it('sums total damage done and ranks by source', () => {
    const d = result<DamageResult>('dps.overall');
    // 1000 + 2000 + 300 + 5000 + 9999
    expect(d.totalDamage).toBe(18299);
    const stabby = d.bySource.find((r) => r.name === 'Stabby');
    expect(stabby!.value).toBe(7000); // 2000 (Rake on Ghoul) + 5000 (Rake on Boss)
  });

  it('sums healing done', () => {
    const h = result<HealingResult>('hps.overall');
    expect(h.totalHealing).toBe(500);
    expect(h.bySource.find((r) => r.name === 'Healpriest')!.value).toBe(500);
  });

  it('counts interrupts by source', () => {
    const i = result<InterruptsResult>('interrupts');
    expect(i.total).toBe(1);
    expect(i.bySource[0]!.name).toBe('Stabby');
  });

  it('attributes damage taken per actor', () => {
    const dt = result<DamageTakenResult>('damageTaken');
    expect(dt.byActor.find((r) => r.name === 'Tankadin')!.value).toBe(300);
    expect(dt.byActor.find((r) => r.name === 'Stabby')!.value).toBe(9999);
  });
});

describe('time-window query (binary search)', () => {
  it('returns the half-open index range for a window', () => {
    const { ts } = parsed.store;
    // window covering only the trash pack (before the encounter at 22:00:12)
    const startMs = ts[0]!;
    const endMs = ts[0]! + 5_000;
    const range = windowRange(ts, startMs, endMs);
    expect(range.start).toBe(0);
    expect(range.end).toBe(5); // the 5 trash events
  });
});

describe('decodeEvent (dev inspector data path)', () => {
  it('decodes every column + side details for an event', () => {
    const ev = parsed.store.decodeEvent(0); // first SPELL_DAMAGE: Tankadin -> Risen Ghoul
    expect(ev.eventType).toBe('SPELL_DAMAGE');
    expect(ev.source.name).toBe('Tankadin');
    expect(ev.target.name).toBe('Risen Ghoul');
    expect(ev.spell.id).toBe(100780);
    expect(ev.spell.name).toBe('Tiger Palm');
    expect(ev.amount).toBe(1000);
    // side-table details present and decoded (non-advanced damage suffix)
    expect(ev.details.amount).toBe(1000);
    expect(ev.details.overkill).toBe(0);
    // flags decoded for presentation
    expect(ev.source.flagsDecoded?.affiliation).toBe('mine');
    expect(ev.target.flagsDecoded?.reaction).toBe('hostile');
  });
});
