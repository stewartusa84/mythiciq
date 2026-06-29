import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog } from '../src/pipeline.js';
import { detectOwner, evaluateCustomMetrics, type CustomMetricRule } from '../src/analytics/customMetrics.js';

// Custom metrics (#13): user-defined window discovery. These build minimal logs and assert the
// resource / aura / cooldown / charges evaluators find the right intervals, plus owner detection.

const SELF = 'Player-1-1111'; // affiliation MINE (0x511) → the recording player
const ALLY = 'Player-1-2222'; // affiliation PARTY (0x512)
const BOSS = 'Creature-0-0-0-0-0BOSS';

let wasm: Awaited<ReturnType<typeof loadWasmBytes>>;

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}
// SPELL_CAST_SUCCESS carrying an advanced block whose powerType/currentPower we control.
function castPower(t: number, src: string, spellId: number, powerType: number, currentPower: number): string {
  const adv = [src, '0000000000000000', 100000, 100000, 0, 0, 0, 0, 0, 0, powerType, currentPower, 200, 0, '0.0', '0.0', '2000', '0.0', 600].join(',');
  return `${ts(t)}  SPELL_CAST_SUCCESS,${src},"Self",0x511,0x0,${src},"Self",0x511,0x0,${spellId},"Cast",0x1,${adv}`;
}
function cast(t: number, src: string, spellId: number, flags = '0x511'): string {
  return `${ts(t)}  SPELL_CAST_SUCCESS,${src},"Self",${flags},0x0,${src},"Self",${flags},0x0,${spellId},"Cast",0x1`;
}
function auraEv(t: number, ev: string, dst: string, spellId: number, kind = 'BUFF'): string {
  return `${ts(t)}  ${ev},${ALLY},"Caster",0x512,0x0,${dst},"Self",0x511,0x0,${spellId},"Aura",0x1,${kind}`;
}
// A SPELL_DAMAGE on SELF (target MINE) — marks SELF in combat at time t.
function dmg(t: number, dst: string): string {
  return `${ts(t)}  SPELL_DAMAGE,${BOSS},"Boss",0xa48,0x0,${dst},"Self",0x511,0x0,6789,"Hit",0x1,1000,0,0x1,0,0,0,nil,nil,nil,nil`;
}

async function evalRules(lines: string[], rules: CustomMetricRule[]) {
  const parsed = await parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
  return { parsed, ...evaluateCustomMetrics(parsed.store, rules) };
}
const rule = (subject: CustomMetricRule['subject'], target: CustomMetricRule['target'] = 'self'): CustomMetricRule => ({
  id: 'r', label: 'r', target, subject,
});

beforeAll(async () => {
  wasm = await loadWasmBytes();
});

describe('detectOwner', () => {
  it('identifies the MINE-affiliation player as the log owner', async () => {
    const parsed = await parseLog(
      wasm,
      new TextEncoder().encode([cast(0, SELF, 1, '0x511'), cast(1, ALLY, 1, '0x512')].join('\n') + '\n'),
    );
    const owner = detectOwner(parsed.store);
    expect(owner?.guid).toBe(SELF);
  });
});

describe('targets-hit windows (suboptimal AoE)', () => {
  const SCK = 101546;
  const E = (n: number) => `Creature-0-0-0-0-0-100${n}`;
  const spellDmg = (t: number, src: string, tgt: string, spellId: number): string =>
    `${ts(t)}  SPELL_DAMAGE,${src},"Self",0x511,0x0,${tgt},"Mob",0xa48,0x0,${spellId},"AoE",0x1,500,0,0x1,0,0,0,nil,nil,nil,nil`;

  it('flags casts that hit fewer than minTargets enemies, not the good ones', async () => {
    const { results } = await evalRules(
      [
        // cast @0: hits 2 enemies within the window → below 3 → FLAGGED.
        cast(0, SELF, SCK),
        spellDmg(0.1, SELF, E(1), SCK),
        spellDmg(0.2, SELF, E(2), SCK),
        // cast @5: hits 4 enemies → at/above 3 → not flagged.
        cast(5, SELF, SCK),
        spellDmg(5.1, SELF, E(1), SCK),
        spellDmg(5.1, SELF, E(2), SCK),
        spellDmg(5.2, SELF, E(3), SCK),
        spellDmg(5.2, SELF, E(4), SCK),
      ],
      [rule({ kind: 'targets-hit', spellId: SCK, minTargets: 3, windowMs: 1000 })],
    );
    const r = results[0]!;
    expect(r.windowCount).toBe(1);
    expect(r.windows[0]!.detail).toBe('hit 2 (<3)');
  });

  it('does not count enemies hit outside the window or by a different spell', async () => {
    const OTHER = 8888;
    const { results } = await evalRules(
      [
        cast(0, SELF, SCK),
        spellDmg(0.1, SELF, E(1), SCK),
        spellDmg(0.2, SELF, E(2), SCK),
        spellDmg(2.0, SELF, E(3), SCK), // too late (outside the 1s window) — doesn't count
        spellDmg(0.1, SELF, E(4), OTHER), // different spell — doesn't count
      ],
      [rule({ kind: 'targets-hit', spellId: SCK, minTargets: 3, windowMs: 1000 })],
    );
    expect(results[0]!.windows[0]!.detail).toBe('hit 2 (<3)');
  });
});

describe('resource windows', () => {
  it('finds windows where a power crosses a threshold (peak recorded)', async () => {
    const { results } = await evalRules(
      [
        castPower(1, SELF, 1, 11, 50), // Maelstrom 50 — below
        castPower(2, SELF, 1, 11, 95), // 95 — above (window opens)
        castPower(3, SELF, 1, 11, 100), // 100 — peak
        castPower(4, SELF, 1, 11, 40), // 40 — below (window closes)
      ],
      [rule({ kind: 'resource', powerType: 11, cmp: '>', value: 90 })],
    );
    const r = results[0]!;
    expect(r.windowCount).toBe(1);
    expect(r.windows[0]!.durationMs).toBe(2000); // t=2 → t=4
    expect(r.windows[0]!.detail).toBe('peak 100');
  });

  it('notes when there are no samples for the requested power type', async () => {
    const { results } = await evalRules([castPower(1, SELF, 1, 3, 50)], [rule({ kind: 'resource', powerType: 11, cmp: '>', value: 0 })]);
    expect(results[0]!.windowCount).toBe(0);
    expect(results[0]!.note).toMatch(/no samples/);
  });
});

describe('aura windows', () => {
  it('finds the interval an aura is present', async () => {
    const { results } = await evalRules(
      [auraEv(2, 'SPELL_AURA_APPLIED', SELF, 12345), auraEv(5, 'SPELL_AURA_REMOVED', SELF, 12345)],
      [rule({ kind: 'aura', spellId: 12345 })],
    );
    expect(results[0]!.windowCount).toBe(1);
    expect(results[0]!.windows[0]!.durationMs).toBe(3000);
  });

  it('honors a minimum stack count', async () => {
    const { results } = await evalRules(
      [
        auraEv(2, 'SPELL_AURA_APPLIED', SELF, 777),
        auraEv(3, 'SPELL_AURA_APPLIED_DOSE', SELF, 777),
        auraEv(4, 'SPELL_AURA_APPLIED_DOSE', SELF, 777), // now 3 stacks
        auraEv(6, 'SPELL_AURA_REMOVED', SELF, 777),
      ],
      [rule({ kind: 'aura', spellId: 777, minStacks: 3 })],
    );
    expect(results[0]!.windowCount).toBe(1);
    expect(results[0]!.windows[0]!.durationMs).toBe(2000); // t=4 (hit 3 stacks) → t=6
  });
});

describe('aura-missing windows', () => {
  it('finds the gaps where a buff is NOT present (on a unit that uses it)', async () => {
    const { results } = await evalRules(
      [
        cast(0, SELF, 1), // anchors run start at +0
        auraEv(10, 'SPELL_AURA_APPLIED', SELF, 12345),
        auraEv(20, 'SPELL_AURA_REMOVED', SELF, 12345),
        cast(30, SELF, 1), // anchors run end at +30
      ],
      [rule({ kind: 'aura-missing', spellId: 12345, inCombatOnly: false })],
    );
    const r = results[0]!;
    expect(r.windowCount).toBe(2); // [0,10] before it went up, [20,30] after it fell off
    expect(r.windows.map((w) => w.durationMs)).toEqual([10000, 10000]);
  });

  it('excludes out-of-combat gaps when inCombatOnly is set', async () => {
    const { results } = await evalRules(
      [
        dmg(5, SELF), // combat burst 1
        dmg(7, SELF),
        // 13s gap → out of combat
        dmg(20, SELF), // combat burst 2
        dmg(22, SELF),
        auraEv(25, 'SPELL_AURA_APPLIED', SELF, 12345), // buff finally goes up at +25 (so absent before)
      ],
      [rule({ kind: 'aura-missing', spellId: 12345, inCombatOnly: true })],
    );
    const r = results[0]!;
    // Absent the whole time before +25, but only the IN-COMBAT parts count: [5,7] and [20,22].
    expect(r.windowCount).toBe(2);
    expect(r.windows.map((w) => w.durationMs)).toEqual([2000, 2000]);
    expect(r.windows[0]!.detail).toBe('missing (in combat)');
  });

  it('flags nothing for a buff nobody in the target ever had', async () => {
    const { results } = await evalRules(
      [cast(0, SELF, 1), cast(30, SELF, 1)],
      [rule({ kind: 'aura-missing', spellId: 999999, inCombatOnly: false })],
    );
    expect(results[0]!.windowCount).toBe(0);
    expect(results[0]!.note).toMatch(/ever had this buff/);
  });
});

describe('cooldown windows', () => {
  it('finds time sitting on an ability that is off cooldown and unused', async () => {
    const { results } = await evalRules(
      [cast(0, SELF, 999), cast(40, SELF, 999)],
      [rule({ kind: 'cooldown', spellId: 999, cooldownSeconds: 10, minIdleSeconds: 5 })],
    );
    const r = results[0]!;
    expect(r.windowCount).toBe(1);
    expect(r.windows[0]!.durationMs).toBe(30000); // available at +10s, unused until the +40s recast
  });

  it('assumes the ability is off cooldown at run start (window before the first cast)', async () => {
    const { results } = await evalRules(
      [cast(0, SELF, 1), cast(40, SELF, 999)], // run starts at +0; ability first cast at +40
      [rule({ kind: 'cooldown', spellId: 999, cooldownSeconds: 10, minIdleSeconds: 5 })],
    );
    const r = results[0]!;
    expect(r.windowCount).toBe(1);
    expect(r.windows[0]!.durationMs).toBe(40000); // sat on it from run start (+0) until first use (+40)
  });
});

describe('charges windows', () => {
  it('finds time spent at max charges (wasted recharge) after spending them', async () => {
    const { results } = await evalRules(
      [cast(0, SELF, 555), cast(1, SELF, 555), cast(30, SELF, 1)], // spend both charges, then idle to +30s
      [rule({ kind: 'charges', spellId: 555, maxCharges: 2, rechargeSeconds: 10 })],
    );
    const r = results[0]!;
    expect(r.windowCount).toBe(1);
    expect(r.windows[0]!.detail).toBe('charges capped');
    expect(r.windows[0]!.durationMs).toBe(10000); // recharged to cap at +20s, capped until +30s end
  });

  it('assumes full charges at run start (capped from +0 until the first cast)', async () => {
    const { results } = await evalRules(
      [cast(0, SELF, 1), cast(20, SELF, 555)], // run starts at +0; first spend of 555 at +20
      [rule({ kind: 'charges', spellId: 555, maxCharges: 2, rechargeSeconds: 10 })],
    );
    const r = results[0]!;
    expect(r.windowCount).toBe(1);
    expect(r.windows[0]!.durationMs).toBe(20000); // capped from run start until the +20s cast
  });
});
