import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog } from '../src/pipeline.js';
import { segmentRuns } from '../src/segments/runs.js';

// A dropped log can hold a whole night of keys. segmentRuns splits it into per-dungeon instances
// (CHALLENGE_MODE_START..END), the unit behind the app's per-run metrics/replay + run dropdown.

let wasmBytes: Awaited<ReturnType<typeof loadWasmBytes>>;

function ts(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `6/6/2026 22:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.000-0500`;
}
const A = 'Player-1-0000001';
const filler = (t: number) =>
  `${ts(t)}  SPELL_CAST_SUCCESS,${A},"A",0x511,0x0,${A},"A",0x511,0x0,1,"Tick",0x1`;

async function runsFor(lines: string[]) {
  const parsed = await parseLog(wasmBytes, new TextEncoder().encode(lines.join('\n') + '\n'));
  return segmentRuns(parsed.store);
}

beforeAll(async () => {
  wasmBytes = await loadWasmBytes();
});

describe('segmentRuns — per-dungeon instances', () => {
  it('splits two back-to-back keys into two runs with metadata', async () => {
    const runs = await runsFor([
      `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,12,[10,9,147]`,
      filler(5),
      `${ts(30)}  CHALLENGE_MODE_END,658,1,12,1800000`,
      filler(120), // walking between keys — belongs to no run
      `${ts(180)}  CHALLENGE_MODE_START,"Ara-Kara",1274,503,15,[10,8]`,
      filler(185),
      `${ts(240)}  CHALLENGE_MODE_END,1274,0,15,2400000`,
    ]);

    expect(runs).toHaveLength(2);

    expect(runs[0]!.dungeonName).toBe('Pit of Saron');
    expect(runs[0]!.keystoneLevel).toBe(12);
    expect(runs[0]!.affixes).toEqual([10, 9, 147]);
    expect(runs[0]!.completed).toBe(true);
    expect(runs[0]!.completionTimeMs).toBe(1800000);

    expect(runs[1]!.dungeonName).toBe('Ara-Kara');
    expect(runs[1]!.keystoneLevel).toBe(15);
    expect(runs[1]!.completed).toBe(false); // success=0 → abandoned

    // Ranges are disjoint and ordered; run 1 starts at/after run 0 ends.
    expect(runs[0]!.endIdx).toBeLessThanOrEqual(runs[1]!.startIdx);
    expect(runs[1]!.startMs).toBeGreaterThan(runs[0]!.endMs);
  });

  it('scopes a run range to [START, END] inclusive (walk-between events excluded)', async () => {
    const runs = await runsFor([
      `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,12,[10]`,
      filler(5),
      `${ts(30)}  CHALLENGE_MODE_END,658,1,12,1800000`,
      filler(120), // after END, before any next START → not in any run
    ]);
    expect(runs).toHaveLength(1);
    // The run ends at the END row; the trailing filler event is outside [startIdx, endIdx).
    const parsed = await parseLog(
      wasmBytes,
      new TextEncoder().encode(
        [
          `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,12,[10]`,
          filler(5),
          `${ts(30)}  CHALLENGE_MODE_END,658,1,12,1800000`,
          filler(120),
        ].join('\n') + '\n',
      ),
    );
    expect(runs[0]!.endIdx).toBeLessThan(parsed.store.count); // trailing event not included
  });

  it('computes timer + chests for a timed completion, none for an unmapped dungeon', async () => {
    const runs = await runsFor([
      // Pit of Saron challengeModeId 556 (timer 31:00 = 1860s); 1800s ≤ 100% ⇒ 1 chest.
      `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,12,[10]`,
      filler(5),
      `${ts(30)}  CHALLENGE_MODE_END,658,1,12,1800000,388.0,3064.0`,
      filler(60),
      // Ara-Kara challengeModeId 503 — not in the timer table ⇒ no timerMs / chests.
      `${ts(90)}  CHALLENGE_MODE_START,"Ara-Kara",1274,503,15,[10]`,
      filler(95),
      `${ts(120)}  CHALLENGE_MODE_END,1274,1,15,900000,200.0,3070.0`,
    ]);

    expect(runs[0]!.timerMs).toBe(1860000);
    expect(runs[0]!.chests).toBe(1);
    expect(runs[0]!.abandoned).toBeUndefined();

    expect(runs[1]!.timerMs).toBeUndefined();
    expect(runs[1]!.chests).toBeUndefined();
  });

  it('awards 3 chests for a fast completion (≤60% of timer)', async () => {
    const runs = await runsFor([
      // 1000s vs 1860s timer = 53.8% ⇒ 3 chests.
      `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,13,[10]`,
      filler(5),
      `${ts(30)}  CHALLENGE_MODE_END,658,1,13,1000000,388.0,3064.0`,
    ]);
    expect(runs[0]!.chests).toBe(3);
  });

  it('marks 0 chests for a completion over the timer (depleted)', async () => {
    const runs = await runsFor([
      // 2000s vs 1860s timer = over time ⇒ 0 chests but still completed.
      `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,12,[10]`,
      filler(5),
      `${ts(40)}  CHALLENGE_MODE_END,658,1,12,2000000,300.0,3000.0`,
    ]);
    expect(runs[0]!.completed).toBe(true);
    expect(runs[0]!.chests).toBe(0);
    expect(runs[0]!.abandoned).toBeUndefined();
  });

  it('flags an abandoned key: success=0 reset END, or no END before a later run', async () => {
    const runs = await runsFor([
      // Re-rolled key: started, then the game emits a success=0 reset END, then a new key.
      `${ts(0)}  CHALLENGE_MODE_START,"Nexus-Point Xenas",2915,559,14,[10]`,
      filler(5),
      `${ts(30)}  CHALLENGE_MODE_END,2915,0,0,0,0.0,0.0`,
      `${ts(31)}  CHALLENGE_MODE_START,"Nexus-Point Xenas",2915,559,13,[10]`,
      filler(40),
      // ...and the re-rolled key just ends with no END (last run) ⇒ ambiguous (in progress).
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.abandoned).toBe(true); // success=0 reset
    expect(runs[0]!.chests).toBeUndefined();
    expect(runs[1]!.abandoned).toBeUndefined(); // last run, no END ⇒ in progress, not abandoned
    expect(runs[1]!.completed).toBeUndefined();
  });

  it('flags a no-END run as abandoned when a later run starts', async () => {
    const runs = await runsFor([
      `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,12,[10]`,
      filler(5),
      // no END — they bailed and started another key
      `${ts(60)}  CHALLENGE_MODE_START,"Skyreach",1209,161,12,[10]`,
      filler(65),
      `${ts(90)}  CHALLENGE_MODE_END,1209,1,12,300000,300.0,3000.0`,
    ]);
    expect(runs[0]!.abandoned).toBe(true);
    expect(runs[1]!.completed).toBe(true);
  });

  it('falls back to one synthetic run when the log has no key', async () => {
    const runs = await runsFor([filler(0), filler(5), filler(10)]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.synthetic).toBe(true);
    expect(runs[0]!.contentType).toBe('other');
    expect(runs[0]!.startIdx).toBe(0);
    expect(runs[0]!.endIdx).toBe(3);
  });

  it('tags challenge-mode runs as mplus', async () => {
    const runs = await runsFor([
      `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,12,[10]`,
      filler(5),
      `${ts(30)}  CHALLENGE_MODE_END,658,1,12,1800000`,
    ]);
    expect(runs[0]!.contentType).toBe('mplus');
  });

  it('handles a key with no END (abandoned / log cut off) by running to log end', async () => {
    const runs = await runsFor([
      `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,12,[10]`,
      filler(5),
      filler(10),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.completed).toBeUndefined();
    expect(runs[0]!.endIdx).toBe(3);
  });
});

describe('segmentRuns — raid sessions', () => {
  // Raids have no CHALLENGE_MODE bracket. A contiguous block of raid-difficulty ENCOUNTER_START..END
  // pulls in one instance becomes a single "session" run; the bosses are bucketed downstream.
  const enc = (t: number, id: number, name: string, diff = 15) =>
    `${ts(t)}  ENCOUNTER_START,${id},"${name}",${diff},20,1296`;
  const encEnd = (t: number, id: number, name: string, success: 0 | 1, dur: number, diff = 15) =>
    `${ts(t)}  ENCOUNTER_END,${id},"${name}",${diff},20,${success},${dur}`;

  it('groups a night of boss pulls into one raid session with difficulty + instance name', async () => {
    const runs = await runsFor([
      `${ts(0)}  ZONE_CHANGE,2769,"Liberation of Undermine",16`,
      filler(2),
      enc(5, 3009, 'Vexie and the Geargrinders'),
      filler(10),
      encEnd(120, 3009, 'Vexie and the Geargrinders', 0, 115000), // wipe
      enc(200, 3009, 'Vexie and the Geargrinders'),
      filler(205),
      encEnd(300, 3009, 'Vexie and the Geargrinders', 1, 100000), // kill
      enc(400, 3010, 'Cauldron of Carnage'),
      filler(405),
      encEnd(500, 3010, 'Cauldron of Carnage', 0, 100000), // wipe
    ]);

    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    expect(run.contentType).toBe('raid');
    expect(run.difficultyId).toBe(15);
    expect(run.difficultyName).toBe('Heroic');
    expect(run.instanceId).toBe(1296);
    expect(run.instanceName).toBe('Liberation of Undermine');
    expect(run.affixes).toEqual([]);
    // Range spans the first pull's START through the last pull's END.
    expect(run.startMs).toBe(runs[0]!.startMs);
    expect(run.endIdx).toBeGreaterThan(run.startIdx);
  });

  it('keeps M+ and raid as separate runs in one log', async () => {
    const runs = await runsFor([
      `${ts(0)}  CHALLENGE_MODE_START,"Pit of Saron",658,556,12,[10]`,
      filler(5),
      `${ts(30)}  CHALLENGE_MODE_END,658,1,12,1800000`,
      `${ts(60)}  ZONE_CHANGE,2769,"Liberation of Undermine",16`,
      enc(70, 3009, 'Vexie and the Geargrinders'),
      filler(75),
      encEnd(150, 3009, 'Vexie and the Geargrinders', 1, 80000),
    ]);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.contentType).toBe('mplus');
    expect(runs[1]!.contentType).toBe('raid');
    expect(runs[1]!.instanceName).toBe('Liberation of Undermine');
  });

  it('ignores a non-raid difficulty encounter (no raid run)', async () => {
    // difficultyId 23 = Mythic dungeon, not a raid; with no key it stays a synthetic run.
    const runs = await runsFor([
      enc(5, 12660, 'Some Dungeon Boss', 23),
      filler(10),
      encEnd(60, 12660, 'Some Dungeon Boss', 1, 50000, 23),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.contentType).toBe('other');
    expect(runs[0]!.synthetic).toBe(true);
  });
});
