import { describe, it, expect } from 'vitest';

import { bucketBosses } from '../src/segments/raidBosses.js';
import type { Segment } from '../src/segments/segmenter.js';

// bucketBosses groups a raid run's encounter segments by boss (wipes + kill = attempts). Pure over
// already-built segments, so it's tested with hand-built Segment objects (no parse needed).

function encounter(
  index: number,
  encounterId: number,
  name: string,
  success: boolean,
  durationMs: number,
): Segment {
  return {
    index,
    kind: 'encounter',
    startIdx: index * 100,
    endIdx: index * 100 + 50,
    startMs: index * 1000,
    endMs: index * 1000 + durationMs,
    durationMs,
    encounterId,
    name,
    success,
    difficultyId: 15,
  };
}

function trash(index: number): Segment {
  return {
    index,
    kind: 'trash',
    startIdx: index * 100,
    endIdx: index * 100 + 50,
    startMs: index * 1000,
    endMs: index * 1000 + 500,
    durationMs: 500,
    mobCount: 3,
  };
}

describe('bucketBosses', () => {
  it('groups attempts by encounterId in first-occurrence order', () => {
    const buckets = bucketBosses([
      encounter(0, 3009, 'Vexie', false, 115000), // wipe
      trash(1), // ignored
      encounter(2, 3009, 'Vexie', true, 100000), // kill
      encounter(3, 3010, 'Cauldron', false, 90000), // wipe
    ]);

    expect(buckets).toHaveLength(2);
    expect(buckets.map((b) => b.encounterId)).toEqual([3009, 3010]);

    const vexie = buckets[0]!;
    expect(vexie.name).toBe('Vexie');
    expect(vexie.pulls).toBe(2);
    expect(vexie.attempts.map((a) => a.segmentIndex)).toEqual([0, 2]);
    expect(vexie.killed).toBe(true);
    expect(vexie.killTimeMs).toBe(100000); // duration of the killing pull
    expect(vexie.difficultyId).toBe(15);

    const cauldron = buckets[1]!;
    expect(cauldron.pulls).toBe(1);
    expect(cauldron.killed).toBe(false);
    expect(cauldron.killTimeMs).toBeUndefined();
  });

  it('returns no buckets when there are no encounters', () => {
    expect(bucketBosses([trash(0), trash(1)])).toEqual([]);
  });

  it('falls back to a name for an encounter with no encounterName', () => {
    const buckets = bucketBosses([
      { ...encounter(0, 3011, '', false, 50000), name: undefined },
    ]);
    expect(buckets[0]!.name).toBe('Encounter 3011');
  });
});
