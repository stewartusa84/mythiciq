import { describe, it, expect, beforeAll } from 'vitest';

import { loadWasmBytes } from '../src/wasm/nodeWasm.js';
import { parseLog, type ParsedLog } from '../src/pipeline.js';
import { Primitives } from '../src/analytics/primitives/index.js';
import { SpellTable } from '../src/spells/spellTable.js';
import { computeDeathRecap, DEFAULT_DEATH_RECAP_PARAMS } from '../src/analytics/seed/deathRecap.js';
import { AUTOPSY_WINDOW_MS } from '../src/analytics/seed/deathAutopsy.js';

const BOSS = 'Creature-0-0-0-0-0BOSS';
const TANK = 'Player-1-2001';
const HEALER = 'Player-1-2002';
const WHOLE = { start: 0, end: Number.MAX_SAFE_INTEGER };

// Prot Warrior (specId 73) with Shield Wall (871): personal CD 120s, duration 8s.
const TABLE = SpellTable.fromData(
  { spells: [] },
  {
    spells: {
      '871': {
        defensive: { name: 'Shield Wall', class: 'Warrior', spec: 'Protection', type: 'personal', cooldownSeconds: 120, durationSeconds: 8 },
      },
      // Killing-blow avoidability fixtures: 66666 = curated avoidable; 77777 = an interruptible cast
      // (a kick would have stopped it); 88888 = a known enemy mechanic that is neither avoidable nor
      // interruptible (e.g. a tank-buster). 55555 (used elsewhere) is in none → unknown.
      '66666': { avoidable: true },
      '77777': { interruptPriority: 'dangerous' },
      '88888': { avoidable: false },
    },
  },
  // 99999 = a dangerous, magic-dispellable debuff (for the autopsy debuff track).
  { debuffs: { Test: { '99999': { priority: 'high', removableBy: ['magic'], name: 'Curse of Doom' } } } },
);

function ts(sec: number): string {
  const s = Math.floor(sec);
  const ms = Math.round((sec - s) * 1000);
  return `6/6/2026 22:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}-0500`;
}
function adv(infoGuid: string, cur: number, max: number): string {
  return [infoGuid, '0000000000000000', cur, max, 0, 0, 0, 0, 0, 0, 0, 100, 100, 0, '0.0', '0.0', '2000', '0.0', 600].join(',');
}
function advDamage(t: number, dst: string, cur: number, max: number, amount: number, spellId = 55555, spellName = 'Cleave'): string {
  return `${ts(t)}  SPELL_DAMAGE,${BOSS},"Boss",0xa48,0x0,${dst},"Tank",0x512,0x0,${spellId},"${spellName}",0x1,${adv(dst, cur, max)},${amount},${amount},0,1,0,0,0,nil,nil,nil,ST`;
}
function advHeal(t: number, src: string, dst: string, amount: number, overheal: number, cur = 50000, max = 100000): string {
  return `${ts(t)}  SPELL_HEAL,${src},"Healer",0x512,0x0,${dst},"Tank",0x512,0x0,2061,"Flash Heal",0x2,${adv(dst, cur, max)},${cur},${amount},${overheal},0,nil`;
}
function castSuccess(t: number, src: string, spellId: number): string {
  return `${ts(t)}  SPELL_CAST_SUCCESS,${src},"Tank",0x512,0x0,${src},"Tank",0x512,0x0,${spellId},"Shield Wall",0x1`;
}
function unitDied(t: number, dst: string): string {
  return `${ts(t)}  UNIT_DIED,0000000000000000,nil,0x0,0x0,${dst},"Tank",0x512,0x0`;
}
function auraApplied(t: number, dst: string, spellId: number, name: string): string {
  return `${ts(t)}  SPELL_AURA_APPLIED,${BOSS},"Boss",0xa48,0x0,${dst},"Tank",0x512,0x0,${spellId},"${name}",0x20,DEBUFF`;
}
function auraRemoved(t: number, dst: string, spellId: number, name: string): string {
  return `${ts(t)}  SPELL_AURA_REMOVED,${BOSS},"Boss",0xa48,0x0,${dst},"Tank",0x512,0x0,${spellId},"${name}",0x20,DEBUFF`;
}
// 26-field COMBATANT_INFO so specId lands at index 25 (the parser reads opt_at(25)).
function combatantInfo(guid: string, specId: number): string {
  const fields = ['COMBATANT_INFO', guid, ...Array(23).fill('0')];
  fields[25] = String(specId);
  return `${ts(0)}  ${fields.join(',')}`;
}

let wasm: Awaited<ReturnType<typeof loadWasmBytes>>;
async function recap(lines: string[]) {
  const parsed: ParsedLog = await parseLog(wasm, new TextEncoder().encode(lines.join('\n') + '\n'));
  return computeDeathRecap(parsed.store, Primitives.for(parsed.store), TABLE, DEFAULT_DEATH_RECAP_PARAMS, WHOLE);
}

beforeAll(async () => {
  wasm = await loadWasmBytes();
});

describe('#10 death recap', () => {
  it('flags a death where an available defensive was never pressed', async () => {
    const r = await recap([
      combatantInfo(TANK, 73), // Prot Warrior
      advDamage(40, TANK, 80000, 100000, 20000),
      advDamage(50, TANK, 5000, 100000, 75000),
      unitDied(50.1, TANK),
    ]);
    expect(r.deaths).toHaveLength(1);
    const d = r.deaths[0]!;
    expect(d.classSpec).toBe('Protection Warrior');
    expect(d.killingBlowName).toBe('Cleave');
    const sw = d.defensives.find((x) => x.spellId === 871)!;
    expect(sw.usedInWindow).toBe(false);
    expect(sw.availableAtDeath).toBe(true); // never cast → off CD
    expect(d.pressed).toBe(0);
    expect(d.availableUnused).toBe(1);
    expect(d.verdict).toContain('pressed 0 of 1');
  });

  it('credits a defensive pressed inside the window (active at death)', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(40, TANK, 80000, 100000, 20000),
      castSuccess(48, TANK, 871), // Shield Wall 2.1s before death, dur 8s → active
      advDamage(50, TANK, 5000, 100000, 75000),
      unitDied(50.1, TANK),
    ]);
    const d = r.deaths[0]!;
    const sw = d.defensives.find((x) => x.spellId === 871)!;
    expect(sw.usedInWindow).toBe(true);
    expect(sw.activeAtDeath).toBe(true);
    expect(d.pressed).toBe(1);
    expect(d.availableUnused).toBe(0);
    expect(d.verdict).toContain('pressed 1 of 1');
  });

  it('infers a one-shot from a near-instant drop out of full health', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(49.5, TANK, 100000, 100000, 0), // healthy (100%) at +49.5s
      advDamage(50, TANK, 1, 100000, 99999), // ~0% at +50s (the fatal hit)
      unitDied(50.1, TANK),
    ]);
    const d = r.deaths[0]!;
    expect(d.timeFromHealthyMs).toBe(600); // 50.1s − 49.5s
    expect(d.deathPace).toBe('one-shot');
  });

  it('still reads a one-shot when the player was chipped (e.g. fall damage) before the lethal hit', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(40, TANK, 85000, 100000, 15000), // chipped to 85% (fall) at +40s
      advDamage(50, TANK, 1, 100000, 99999), // one-shot to ~0% 10s later
      unitDied(50.1, TANK),
    ]);
    const d = r.deaths[0]!;
    // The old time-since-full metric would miss this (never >90% ⇒ null); fraction-based pace catches it.
    expect(d.timeFromHealthyMs).toBeNull();
    expect(d.deathPace).toBe('one-shot'); // 85% of max HP gone in the final second
  });

  it('classifies a death seen only at low HP as gradual (clearly not a burst/one-shot)', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(50, TANK, 5000, 100000, 75000), // only ever seen at 5%
      unitDied(50.1, TANK),
    ]);
    expect(r.deaths[0]!.timeFromHealthyMs).toBeNull();
    expect(r.deaths[0]!.deathPace).toBe('gradual');
  });

  it('reports an unknown pace when there is no HP reconstruction for the dying unit', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      unitDied(50.1, TANK), // no advanced HP samples at all → pace can't be inferred
    ]);
    expect(r.deaths[0]!.timeFromHealthyMs).toBeNull();
    expect(r.deaths[0]!.deathPace).toBe('unknown');
  });

  it('sums effective healing received vs damage taken in the death window', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(45, TANK, 60000, 100000, 40000), // took 40k
      advHeal(46, HEALER, TANK, 30000, 5000), // 30k healed, 5k overheal → 25k effective
      advDamage(50, TANK, 1, 100000, 59999), // took ~60k (lethal)
      unitDied(50.1, TANK),
    ]);
    const d = r.deaths[0]!;
    expect(d.damageTakenInWindow).toBe(40000 + 59999); // total includes the lethal hit
    expect(d.killingBlowAmount).toBe(59999); // ...which is surfaced separately + excluded from coverage
    expect(d.healingReceivedInWindow).toBe(25000);
  });

  it('reports zero healing received when the healer never touched them', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(49, TANK, 1, 100000, 99999),
      unitDied(49.5, TANK),
    ]);
    expect(r.deaths[0]!.healingReceivedInWindow).toBe(0);
    expect(r.deaths[0]!.damageTakenInWindow).toBe(99999);
  });

  it('classifies the killing blow as avoidable / interruptible / unavoidable / unknown from the spell table', async () => {
    const avoidable = await recap([
      combatantInfo(TANK, 73),
      advDamage(50, TANK, 5000, 100000, 75000, 66666, 'Stomp'), // curated avoidable
      unitDied(50.1, TANK),
    ]);
    expect(avoidable.deaths[0]!.killingBlowAvoidable).toBe('avoidable');

    const interruptible = await recap([
      combatantInfo(TANK, 73),
      advDamage(50, TANK, 5000, 100000, 75000, 77777, 'Doom Bolt'), // interruptible cast — should've been kicked
      unitDied(50.1, TANK),
    ]);
    expect(interruptible.deaths[0]!.killingBlowAvoidable).toBe('interruptible');

    const unavoidable = await recap([
      combatantInfo(TANK, 73),
      advDamage(50, TANK, 5000, 100000, 75000, 88888, 'Tank Buster'), // known mechanic, not avoidable/interruptible
      unitDied(50.1, TANK),
    ]);
    expect(unavoidable.deaths[0]!.killingBlowAvoidable).toBe('unavoidable');

    const unknown = await recap([
      combatantInfo(TANK, 73),
      advDamage(50, TANK, 5000, 100000, 75000), // 55555 — not in the table
      unitDied(50.1, TANK),
    ]);
    expect(unknown.deaths[0]!.killingBlowAvoidable).toBe('unknown');
  });

  it('does not count a defensive that was on cooldown at death', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      castSuccess(5, TANK, 871), // cast 45s before death; CD 120s → still on CD at death
      advDamage(40, TANK, 80000, 100000, 20000),
      advDamage(50, TANK, 5000, 100000, 75000),
      unitDied(50.1, TANK),
    ]);
    const d = r.deaths[0]!;
    const sw = d.defensives.find((x) => x.spellId === 871)!;
    expect(sw.usedInWindow).toBe(false); // cast was 45s before, outside the 20s window
    expect(sw.availableAtDeath).toBe(false); // still on cooldown
    expect(d.pressed).toBe(0);
    expect(d.availableUnused).toBe(0);
    expect(d.verdict).toContain('no survival cooldowns available');
  });
});

describe('#10b death autopsy timeline', () => {
  it('windows the HP line + events to the autopsy window and lands HP at 0 on death', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(40, TANK, 90000, 100000, 10000), // 10s before death — OUTSIDE the 8s window
      advDamage(45, TANK, 60000, 100000, 30000), // inside window
      advHeal(46, HEALER, TANK, 20000, 0, 80000, 100000),
      advDamage(50, TANK, 1, 100000, 79999), // killing blow
      unitDied(50.1, TANK),
    ]);
    const a = r.deaths[0]!.autopsy;
    expect(a.windowMs).toBe(AUTOPSY_WINDOW_MS);
    expect(a.endMs - a.startMs).toBe(AUTOPSY_WINDOW_MS);
    // Only the in-window events (the +40s hit is excluded), time-ascending.
    expect(a.events.map((e) => e.kind)).toEqual(['damage', 'heal', 'damage']);
    expect(a.events.every((e) => e.ms >= a.startMs)).toBe(true);
    expect(a.events[0]!.ms).toBeLessThan(a.events[2]!.ms);
    // HP line ends at 0 on death.
    expect(a.hp[a.hp.length - 1]!.hp).toBe(0);
    expect(a.hp[a.hp.length - 1]!.ms).toBe(a.endMs);
  });

  it('pins the killing blow to 0 HP so the player never appears alive at death', async () => {
    // The fatal hit's advanced-block currentHp is the PRE-hit value (50%); without the fix the line
    // would dangle at 50% and the player would look alive at death.
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(47, TANK, 95000, 100000, 5000), // healthy entering the kill
      advDamage(50, TANK, 50000, 100000, 90000, 88888, 'Tank Buster'), // logs 50% pre-hit but kills
      unitDied(50.1, TANK),
    ]);
    const a = r.deaths[0]!.autopsy;
    const kb = a.events[a.events.length - 1]!;
    expect(kb.kind).toBe('damage');
    expect(kb.hpFractionAfter).toBe(0); // pinned to 0 (HP hit 0 here)
    const last = a.hp[a.hp.length - 1]!;
    const hold = a.hp[a.hp.length - 2]!;
    expect(last.ms).toBe(a.endMs); // line lands at 0 at the death moment
    expect(last.hp).toBe(0);
    // The held pre-fatal HP and the drop to 0 share the death-moment ms ⇒ a true VERTICAL plunge at
    // the kill, not a diagonal across the UNIT_DIED lag; and nothing lingers past the death moment.
    expect(hold.ms).toBe(a.endMs);
    expect(hold.hp).toBeGreaterThan(0);
    expect(a.hp.filter((s) => s.ms > a.endMs)).toHaveLength(0);
  });

  it('anchors the death moment (0.0s) to the killing blow, not the lagging UNIT_DIED row', async () => {
    // The game logs UNIT_DIED a beat after the lethal hit (server death-batch). The chart's 0.0s edge
    // must be when HP actually hit 0 (the killing blow), so the kill never reads at a negative offset.
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(48, TANK, 60000, 100000, 30000),
      advDamage(50, TANK, 1, 100000, 99999, 88888, 'Tank Buster'), // killing blow at +50.0s
      unitDied(50.6, TANK), // UNIT_DIED logged 0.6s later
    ]);
    const a = r.deaths[0]!.autopsy;
    const kb = a.markers.find((m) => m.kind === 'killing-blow')!;
    expect(a.endMs).toBe(kb.ms); // chart anchor == killing blow ⇒ it sits at 0.0s, not −0.6s
    expect(a.endMs - a.startMs).toBe(AUTOPSY_WINDOW_MS); // full window ending at the death moment
    expect(r.deaths[0]!.tsMs).toBeGreaterThan(a.endMs); // the row's tsMs is still the authoritative UNIT_DIED
  });

  it('marks avoidable damage and the killing blow', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(46, TANK, 60000, 100000, 30000, 66666, 'Stomp'), // curated avoidable
      advDamage(50, TANK, 1, 100000, 59999, 88888, 'Tank Buster'), // killing blow
      unitDied(50.1, TANK),
    ]);
    const a = r.deaths[0]!.autopsy;
    const avoid = a.markers.find((m) => m.kind === 'avoidable');
    const kb = a.markers.find((m) => m.kind === 'killing-blow');
    expect(avoid?.spellId).toBe(66666);
    expect(kb?.spellId).toBe(88888);
    expect(a.events.find((e) => e.spellId === 66666)!.avoidable).toBe(true);
  });

  it('shows a self-survival defensive as available (off CD) when never cast', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      advDamage(50, TANK, 1, 100000, 99999),
      unitDied(50.1, TANK),
    ]);
    const sw = r.deaths[0]!.autopsy.defensives.find((d) => d.spellId === 871)!;
    expect(sw.activeIntervals).toHaveLength(0);
    // Off cooldown the whole window → one available span covering it.
    expect(sw.availableIntervals).toHaveLength(1);
    expect(sw.availableIntervals[0]!.endMs - sw.availableIntervals[0]!.startMs).toBe(AUTOPSY_WINDOW_MS);
  });

  it('draws a defensive as active while its buff is up', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      castSuccess(48, TANK, 871), // Shield Wall 2.1s before death, dur 8s → active through death
      advDamage(50, TANK, 1, 100000, 99999),
      unitDied(50.1, TANK),
    ]);
    const a = r.deaths[0]!.autopsy;
    const sw = a.defensives.find((d) => d.spellId === 871)!;
    expect(sw.activeIntervals.length).toBeGreaterThan(0);
    expect(sw.activeIntervals[0]!.endMs).toBe(a.endMs); // clipped to the death moment
  });

  it('tracks a dangerous debuff present on the player within the window', async () => {
    const r = await recap([
      combatantInfo(TANK, 73),
      auraApplied(45, TANK, 99999, 'Curse of Doom'),
      advDamage(50, TANK, 1, 100000, 99999),
      unitDied(50.1, TANK),
      auraRemoved(52, TANK, 99999, 'Curse of Doom'), // removed after death → clipped to death
    ]);
    const a = r.deaths[0]!.autopsy;
    const db = a.debuffs.find((d) => d.spellId === 99999)!;
    expect(db.removable).toBe(true);
    expect(db.intervals[0]!.startMs).toBe(r.deaths[0]!.tsMs - 5100); // applied at +45s, death at +50.1s
    expect(db.intervals[0]!.startMs).toBeGreaterThan(a.startMs); // inside the window
    expect(db.intervals[0]!.endMs).toBe(a.endMs); // still up at death → clipped
  });
});
