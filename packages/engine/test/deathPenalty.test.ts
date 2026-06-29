import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog } from '../src/pipeline.js';
import { createRegistry } from '../src/pipeline.js';
import type { DeathsResult } from '../src/analytics/seed/deaths.js';

// The death-timer penalty is affix-gated: deaths only cost timer when Xal'atath's Guile
// (147) is slotted. These tests build minimal keys with/without it and confirm the gating.

const PLAYER = 'Player-1-0000001';
const PET = 'Creature-0-3132-2874-8294-166949-0000204293'; // a Chi-Ji-style guardian despawn

let wasmBytes: Awaited<ReturnType<typeof loadWasmBytes>>;
const registry = createRegistry();

function ts(sec: number): string {
  return `6/6/2026 22:00:${String(sec).padStart(2, '0')}.000-0500`;
}

async function deathsFor(affixField: string, deaths: string[]): Promise<DeathsResult> {
  const lines = [
    `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,13,${affixField}`,
    ...deaths,
    `${ts(50)}  CHALLENGE_MODE_END,658,1,13,1800000`,
  ];
  const parsed = await parseLog(wasmBytes, new TextEncoder().encode(lines.join('\n') + '\n'));
  const [r] = registry.run({ store: parsed.store, segments: parsed.segments }, [registry.get('deaths')!]);
  return r!.value as DeathsResult;
}

const playerDeath = (t: number) => `${ts(t)}  UNIT_DIED,0000000000000000,nil,0x0,0x0,${PLAYER},"Tankadin",0x511,0x0`;
const petDeath = (t: number) => `${ts(t)}  UNIT_DIED,0000000000000000,nil,0x80000000,0x80000000,${PET},"Chi-Ji",0x2111,0x80000000,0`;

beforeAll(async () => {
  wasmBytes = await loadWasmBytes();
});

describe('death-timer penalty (affix-gated)', () => {
  it('charges +15s per player death when Xal\'atath\'s Guile (147) is slotted', async () => {
    const d = await deathsFor('[10,9,147]', [playerDeath(10), playerDeath(20)]);
    expect(d.affixes).toEqual([10, 9, 147]);
    expect(d.deathPenaltyActive).toBe(true);
    expect(d.count).toBe(2);
    expect(d.perDeathPenaltySeconds).toBe(15);
    expect(d.timerPenaltySeconds).toBe(30);
  });

  it('charges no timer when the death affix is absent', async () => {
    const d = await deathsFor('[10,9,148]', [playerDeath(10), playerDeath(20)]);
    expect(d.affixes).toEqual([10, 9, 148]);
    expect(d.deathPenaltyActive).toBe(false);
    expect(d.count).toBe(2);
    expect(d.perDeathPenaltySeconds).toBe(0);
    expect(d.timerPenaltySeconds).toBe(0);
  });

  it('excludes pet/guardian despawns from the death count even under the affix', async () => {
    const d = await deathsFor('[10,9,147]', [playerDeath(10), petDeath(11), playerDeath(20)]);
    expect(d.count).toBe(2); // two player deaths; the Chi-Ji despawn is not counted
    expect(d.timerPenaltySeconds).toBe(30);
  });
});
