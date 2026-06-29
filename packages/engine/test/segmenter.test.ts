import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog } from '../src/pipeline.js';
import { segment, enrichSegment, type Segment } from '../src/segments/segmenter.js';
import type { DungeonEnemies } from '../src/segments/enemyFacts.js';

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}
const PLAYER = 'Player-1-0001';
const mob = (npc: number, spawn: number) => `Creature-0-0-0-0-${npc}-${String(spawn).padStart(6, '0')}`;

// Player → mob SPELL_DAMAGE (mob hostile 0xa48, player friendly 0x512). Minimal suffix (no adv block).
const hit = (t: number, target: string, spellId = 99999): string =>
  `${ts(t)}  SPELL_DAMAGE,${PLAYER},"P",0x512,0x0,${target},"Mob",0xa48,0x0,${spellId},"Hit",0x1,1000,0,0x1,0,0,0,nil,nil,nil,nil`;
const died = (t: number, target: string): string =>
  `${ts(t)}  UNIT_DIED,0000000000000000,nil,0x0,0x0,${target},"Mob",0xa48,0x0`;
const encStart = (t: number, id: number, name: string): string => `${ts(t)}  ENCOUNTER_START,${id},"${name}",8,5,2000`;
const encEnd = (t: number, id: number, name: string, ok: number): string => `${ts(t)}  ENCOUNTER_END,${id},"${name}",8,5,${ok}`;

let wasm: Awaited<ReturnType<typeof loadWasmBytes>>;
beforeAll(async () => {
  wasm = await loadWasmBytes();
});
async function seg(lines: string[]): Promise<Segment[]> {
  const parsed = await parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
  return segment(parsed.store);
}

describe('segment() — damage-gap trash detection', () => {
  it('splits two packs separated by a damage lull into separate pulls', async () => {
    // Pack A (npc 501, two mobs) 1–8s, then a >3.5s lull, then pack B (npc 502) 15–20s.
    const A1 = mob(501, 1), A2 = mob(501, 2), B1 = mob(502, 1);
    const segs = await seg([
      hit(1, A1), hit(2, A2), hit(5, A1), hit(8, A2),
      died(8, A1), died(8.1, A2),
      hit(15, B1), hit(18, B1), hit(20, B1),
      died(20, B1),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs.every((s) => s.kind === 'trash')).toBe(true);

    const [p1, p2] = segs;
    expect(p1!.mobCount).toBe(2); // two distinct 501 guids
    expect(p1!.enemies).toEqual([{ npcId: 501, engaged: 2, killed: 2 }]);
    expect(p2!.mobCount).toBe(1);
    expect(p2!.enemies).toEqual([{ npcId: 502, engaged: 1, killed: 1 }]);
    expect(p1!.index).toBe(0);
    expect(p2!.index).toBe(1);
  });

  it('keeps continuous damage (gaps under threshold) as ONE pull', async () => {
    const A1 = mob(501, 1), B1 = mob(502, 1);
    const segs = await seg([
      hit(1, A1), hit(3, A1), hit(5, B1), hit(7, B1), hit(9, A1), // all gaps ≤2s
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.mobCount).toBe(2);
    expect(segs[0]!.enemies?.map((e) => e.npcId).sort()).toEqual([501, 502]);
  });

  it('excludes boss-encounter combat from trash and emits an encounter segment', async () => {
    const A1 = mob(501, 1), BOSS = mob(900, 1);
    const segs = await seg([
      hit(1, A1), hit(4, A1), died(4, A1), // trash pull 1–4s
      encStart(10, 1234, 'Big Boss'),
      hit(12, BOSS), hit(15, BOSS), died(16, BOSS),
      encEnd(17, 1234, 'Big Boss', 1),
    ]);
    expect(segs).toHaveLength(2);
    expect(segs[0]!.kind).toBe('trash');
    expect(segs[1]!.kind).toBe('encounter');
    expect(segs[1]!.name).toBe('Big Boss');
    expect(segs[1]!.success).toBe(true);
    // The boss's own damage is inside the encounter — NOT a second trash pull.
    expect(segs.filter((s) => s.kind === 'trash')).toHaveLength(1);
  });
});

describe('enrichSegment() — MDT facts', () => {
  const dungeon: DungeonEnemies = {
    totalCount: 100,
    enemies: {
      '501': { name: 'Goon', count: 4, groups: [1] },
      '777': { name: 'Boss Add', count: 0, encounterID: 990, groups: [2] },
    },
  };

  it('weights enemy-forces by killed mobs, names the pull, and flags boss-area adds', () => {
    const s: Segment = {
      index: 0, kind: 'trash', startIdx: 0, endIdx: 10, startMs: 0, endMs: 5000, durationMs: 5000,
      mobCount: 4,
      enemies: [
        { npcId: 501, engaged: 3, killed: 2 },
        { npcId: 777, engaged: 1, killed: 1 },
      ],
    };
    enrichSegment(s, dungeon);
    expect(s.mdt?.forces).toBe(8); // 2 killed Goons × count 4 (+ Add count 0)
    expect(s.mdt?.forcesTotal).toBe(100);
    expect(s.mdt?.bossArea).toBe(true); // 777 carries an encounterID
    expect(s.mdt?.title).toBe('Goon ×3, Boss Add');
    expect(s.enemies?.[0]).toMatchObject({ name: 'Goon', count: 4 });
  });

  it('is a no-op for encounter segments', () => {
    const s: Segment = { index: 0, kind: 'encounter', startIdx: 0, endIdx: 5, startMs: 0, endMs: 1, durationMs: 1, name: 'Boss' };
    enrichSegment(s, dungeon);
    expect(s.mdt).toBeUndefined();
  });
});
