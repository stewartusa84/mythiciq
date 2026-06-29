// Death autopsy (#10b) — the per-death "what happened" timeline behind the recap verdict.
// For each death we reconstruct a short pre-death window (default 8s, AUTOPSY_WINDOW_MS) as a single
// glance-able picture: the player's HP line, the damage/heal events that moved it (hover detail),
// horizontal tracks for the self-survival cooldowns they HAD (muted when merely available, glowing
// when the buff was actually up) and for any dangerous debuff that was on them, and vertical markers
// for the major moments (avoidable hits + the killing blow). This is the data layer; the SVG chart
// lives in the app (DeathAutopsy.svelte). Built alongside the recap so death detection happens once.

import type { ColumnStore } from '../../columns/columnStore.js';
import type { SpellTable, DefensiveType } from '../../spells/spellTable.js';
import type { HpTimeline } from '../primitives/hpTimeline.js';

/** Pre-death history the autopsy graph spans. Bumped out to its own constant (NOT the 20s recap
 *  verdict window) so it's trivial to retune if 8s proves too tight/loose once we see real deaths. */
export const AUTOPSY_WINDOW_MS = 8000;

/** Self-castable survival types — the cooldowns the dying player could have pressed to live. Matches
 *  the recap's SELF_SURVIVAL_TYPES; externals are cast by allies so we can't source them per-player. */
const SELF_SURVIVAL_TYPES: ReadonlySet<DefensiveType> = new Set(['personal', 'tank', 'raid'] as DefensiveType[]);

export interface AutopsyHpSample {
  ms: number;
  /** raw current HP at this sample */
  hp: number;
  maxHp: number;
}

export interface AutopsyEvent {
  ms: number;
  kind: 'damage' | 'heal';
  spellId: number | null;
  spellName: string;
  /** damage: gross damage taken; heal: EFFECTIVE healing (raw − overheal). */
  amount: number;
  /** damage only — overkill portion (already included in `amount`). */
  overkill?: number;
  /** damage only — amount absorbed by a shield. */
  absorbed?: number;
  /** heal only — overheal portion. */
  overheal?: number;
  /** who dealt the damage / cast the heal (resolved actor name, may be empty for env). */
  sourceName: string;
  /** the hit came from a curated avoidable spell (also surfaced as a vertical marker). */
  avoidable: boolean;
  /** HP fraction immediately after this event (hold-last), for the hover card context. */
  hpFractionAfter: number | null;
}

export interface AutopsyInterval {
  startMs: number;
  endMs: number;
}

export interface AutopsyDefensive {
  spellId: number;
  name: string;
  type: DefensiveType;
  /** Off-cooldown (could have been pressed) spans within the window — drawn muted/gray. */
  availableIntervals: AutopsyInterval[];
  /** Buff actually up spans within the window — drawn glowing. */
  activeIntervals: AutopsyInterval[];
}

export interface AutopsyDebuff {
  spellId: number;
  name: string;
  /** Spans the dangerous debuff was present on the player within the window. */
  intervals: AutopsyInterval[];
  /** A remover/dispel could clear it (vs heal-through). */
  removable: boolean;
}

export interface AutopsyMarker {
  ms: number;
  kind: 'avoidable' | 'killing-blow';
  spellId: number | null;
  name: string;
  amount?: number;
}

/** The full pre-death timeline for one death. Times are absolute ms; the app converts to run-relative. */
export interface DeathAutopsy {
  windowMs: number;
  startMs: number;
  /** The death moment (0.0s) = when HP hit 0, i.e. the killing blow's timestamp (falls back to the
   *  UNIT_DIED ts for a death with no logged damage). NOT the UNIT_DIED row, which lags by a beat. */
  endMs: number;
  /** representative max HP across the window (for y-axis labels / magnitude scaling) */
  maxHp: number;
  hp: AutopsyHpSample[];
  events: AutopsyEvent[];
  defensives: AutopsyDefensive[];
  debuffs: AutopsyDebuff[];
  markers: AutopsyMarker[];
}

/** Union-merge a set of [start,end) intervals (sorted, overlaps coalesced). */
function mergeIntervals(intervals: AutopsyInterval[]): AutopsyInterval[] {
  if (intervals.length <= 1) return intervals;
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);
  const out: AutopsyInterval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.startMs <= last.endMs) last.endMs = Math.max(last.endMs, cur.endMs);
    else out.push({ ...cur });
  }
  return out;
}

/** [windowStart, windowEnd] minus the union of `busy` spans (the complement inside the window). */
function complementInWindow(busy: AutopsyInterval[], windowStart: number, windowEnd: number): AutopsyInterval[] {
  const merged = mergeIntervals(busy.filter((b) => b.endMs > windowStart && b.startMs < windowEnd));
  const out: AutopsyInterval[] = [];
  let cursor = windowStart;
  for (const b of merged) {
    const s = Math.max(b.startMs, windowStart);
    if (s > cursor) out.push({ startMs: cursor, endMs: s });
    cursor = Math.max(cursor, Math.min(b.endMs, windowEnd));
  }
  if (cursor < windowEnd) out.push({ startMs: cursor, endMs: windowEnd });
  return out;
}

/** Dangerous-debuff presence intervals per player unit, built in ONE store pass (only AURA events on
 *  player targets, filtered to curated dangerous debuffs). Cheap; reused across all deaths in the run. */
export function buildDangerDebuffIntervals(store: ColumnStore, table: SpellTable): Map<number, AutopsyDebuff[]> {
  const out = new Map<number, AutopsyDebuff[]>();
  const applied = store.eventTypeId('SPELL_AURA_APPLIED');
  const removed = store.eventTypeId('SPELL_AURA_REMOVED');
  const refreshed = store.eventTypeId('SPELL_AURA_REFRESH');
  const broken = store.eventTypeId('SPELL_AURA_BROKEN_SPELL');
  if (applied === undefined && removed === undefined) return out;
  const lastMs = store.count > 0 ? store.ts[store.count - 1]! : 0;

  // open[(unitId<<… )] — keyed by `${unitId}:${spellId}`, value = open-start ms.
  const open = new Map<string, number>();
  const push = (unitId: number, spellId: number, startMs: number, endMs: number) => {
    const name = store.spellName(spellId) || `spell:${spellId}`;
    const removable = table.removableCategoriesOf(spellId).length > 0;
    const list = out.get(unitId) ?? out.set(unitId, []).get(unitId)!;
    let entry = list.find((d) => d.spellId === spellId);
    if (!entry) {
      entry = { spellId, name, intervals: [], removable };
      list.push(entry);
    }
    entry.intervals.push({ startMs, endMs });
  };

  for (let i = 0; i < store.count; i++) {
    const et = store.eventType[i]!;
    const isApply = et === applied || et === refreshed;
    const isRemove = et === removed || et === broken;
    if (!isApply && !isRemove) continue;
    const target = store.targetGuid[i];
    if (target === undefined || !store.isPlayer(target)) continue;
    const sp = store.spellIdNum(i);
    if (sp === null || !table.isDangerousDebuff(sp)) continue;
    const key = `${target}:${sp}`;
    if (isApply) {
      if (!open.has(key)) open.set(key, store.ts[i]!);
    } else {
      const startMs = open.get(key);
      if (startMs !== undefined) {
        push(target, sp, startMs, store.ts[i]!);
        open.delete(key);
      }
    }
  }
  // Close anything still up at the end of the log.
  for (const [key, startMs] of open) {
    const [unitStr, spStr] = key.split(':');
    push(Number(unitStr), Number(spStr), startMs, lastMs);
  }
  return out;
}

/** Clip a unit's debuff intervals to [windowStart, deathMs]; drop debuffs with no overlap. */
function debuffsInWindow(
  all: AutopsyDebuff[] | undefined,
  windowStart: number,
  deathMs: number,
): AutopsyDebuff[] {
  if (!all) return [];
  const out: AutopsyDebuff[] = [];
  for (const d of all) {
    const clipped = d.intervals
      .filter((iv) => iv.endMs > windowStart && iv.startMs < deathMs)
      .map((iv) => ({ startMs: Math.max(iv.startMs, windowStart), endMs: Math.min(iv.endMs, deathMs) }));
    if (clipped.length) out.push({ spellId: d.spellId, name: d.name, removable: d.removable, intervals: clipped });
  }
  return out;
}

export interface BuildAutopsyArgs {
  store: ColumnStore;
  table: SpellTable;
  hp: HpTimeline;
  /** Precomputed (one pass) dangerous-debuff intervals for ALL players. */
  dangerByUnit: Map<number, AutopsyDebuff[]>;
  damageIds: ReadonlySet<number>;
  healIds: ReadonlySet<number>;
  actorId: number;
  /** index of the UNIT_DIED event (scan back from here for window events). */
  deathIdx: number;
  deathMs: number;
  /** lower bound for the backward scan (the run's start index). */
  rangeStart: number;
  /** Applicable self-survival defensive ids for this player + their whole-log cast times. */
  applicableDefensiveIds: number[];
  playerCasts: Map<number, number[]> | undefined;
}

/** Build the pre-death autopsy timeline for a single death. */
export function buildAutopsy(args: BuildAutopsyArgs): DeathAutopsy {
  const { store, table, hp, dangerByUnit, damageIds, healIds, actorId, deathIdx, deathMs, rangeStart } = args;
  const windowStart = deathMs - AUTOPSY_WINDOW_MS;

  // --- HP line ---------------------------------------------------------------
  const samples: AutopsyHpSample[] = [];
  const ut = hp.unit(actorId);
  let maxHp = 0;
  const entering = hp.hpAt(actorId, windowStart);
  if (entering) {
    samples.push({ ms: windowStart, hp: entering.currentHp, maxHp: entering.maxHp });
    maxHp = entering.maxHp;
  }
  if (ut) {
    for (const s of ut.samples) {
      if (s.ms < windowStart) continue;
      if (s.ms > deathMs) break;
      samples.push({ ms: s.ms, hp: s.currentHp, maxHp: s.maxHp });
      if (s.maxHp > maxHp) maxHp = s.maxHp;
    }
  }
  // (HP line terminated below, AFTER the killing blow is known — see note there.)

  // --- HP-changing events (damage taken + healing received) ------------------
  const events: AutopsyEvent[] = [];
  const markers: AutopsyMarker[] = [];
  for (let j = deathIdx - 1; j >= rangeStart && store.ts[j]! >= windowStart; j--) {
    if (store.targetGuid[j] !== actorId) continue;
    const et = store.eventType[j]!;
    const ms = store.ts[j]!;
    if (damageIds.has(et)) {
      const sid = store.spellIdNum(j);
      const name = sid !== null ? store.spellName(sid) || `spell:${sid}` : 'Melee';
      const overkill = store.detailNumber(j, 'overkill');
      const absorbed = store.detailNumber(j, 'absorbed');
      const avoidable = sid !== null && table.isAvoidable(sid);
      events.push({
        ms,
        kind: 'damage',
        spellId: sid,
        spellName: name,
        amount: store.amount[j]!,
        ...(overkill !== undefined && overkill > 0 ? { overkill } : {}),
        ...(absorbed !== undefined && absorbed > 0 ? { absorbed } : {}),
        sourceName: store.actorName(store.sourceGuid[j]!) || '',
        avoidable,
        hpFractionAfter: hp.hpAt(actorId, ms)?.fraction ?? null,
      });
      if (avoidable) markers.push({ ms, kind: 'avoidable', spellId: sid, name, amount: store.amount[j]! });
    } else if (healIds.has(et)) {
      const sid = store.spellIdNum(j);
      const oh = store.detailNumber(j, 'overheal') ?? store.detailNumber(j, 'overhealing') ?? 0;
      const eff = Math.max(0, store.amount[j]! - oh);
      if (store.amount[j]! <= 0) continue;
      events.push({
        ms,
        kind: 'heal',
        spellId: sid,
        spellName: sid !== null ? store.spellName(sid) || `spell:${sid}` : 'heal',
        amount: eff,
        ...(oh > 0 ? { overheal: oh } : {}),
        sourceName: store.actorName(store.sourceGuid[j]!) || '',
        avoidable: false,
        hpFractionAfter: hp.hpAt(actorId, ms)?.fraction ?? null,
      });
    }
  }
  events.reverse(); // back-scan collected newest-first; emit time-ascending
  // Killing blow = the last damage event in the window (newest), surfaced as a marker too.
  let killingBlowMs: number | null = null;
  for (let k = events.length - 1; k >= 0; k--) {
    const ev = events[k]!;
    if (ev.kind === 'damage') {
      killingBlowMs = ev.ms;
      // A killing blow's advanced-block currentHp is the victim's PRE-hit HP (the game logs vitals
      // before subtracting the lethal — often with huge overkill), so trusting it paints the player
      // "alive at death". UNIT_DIED is authoritative: pin this hit at 0 so the line plunges to 0 here.
      ev.hpFractionAfter = 0;
      markers.push({ ms: ev.ms, kind: 'killing-blow', spellId: ev.spellId, name: ev.spellName, amount: ev.amount });
      break;
    }
  }
  markers.sort((a, b) => a.ms - b.ms);

  // The "death moment" (the 0.0s right edge of the chart) is when HP actually hit 0 — i.e. the killing
  // blow's log timestamp — NOT the UNIT_DIED row, which the game logs a beat later (server death-batch,
  // ~0.3–0.6s after the lethal hit in real logs). Anchoring to UNIT_DIED would plot the killing blow at
  // a negative offset and stretch the HP plunge into a diagonal across that lag. Anchor to the killing
  // blow when we have one; fall back to UNIT_DIED (deathMs) for a death with no logged damage. The
  // window is the AUTOPSY_WINDOW_MS leading up to that moment.
  const endMs = killingBlowMs ?? deathMs;
  const winStart = endMs - AUTOPSY_WINDOW_MS;

  // Terminate the HP line at 0 at the death moment. Drop reconstructed samples at/after the killing blow
  // (their currentHp is the unreliable pre-hit value), HOLD the last pre-fatal HP up to the fatal hit,
  // then drop straight to 0 at the same instant — a true vertical plunge at the kill (no diagonal), so
  // the player never appears alive at the moment of death.
  if (killingBlowMs !== null) {
    while (samples.length && samples[samples.length - 1]!.ms >= killingBlowMs) samples.pop();
    const last = samples[samples.length - 1];
    if (last && last.hp > 0) samples.push({ ms: killingBlowMs, hp: last.hp, maxHp: last.maxHp });
    samples.push({ ms: endMs, hp: 0, maxHp: maxHp || last?.maxHp || 0 });
  } else if (samples.length === 0 || samples[samples.length - 1]!.hp > 0 || samples[samples.length - 1]!.ms < endMs) {
    samples.push({ ms: endMs, hp: 0, maxHp: maxHp || samples[samples.length - 1]?.maxHp || 0 });
  }

  // --- Self-survival defensive tracks (available vs active) ------------------
  const defensives: AutopsyDefensive[] = [];
  for (const id of args.applicableDefensiveIds) {
    const d = table.defensive(id);
    if (!d || !SELF_SURVIVAL_TYPES.has(d.type)) continue;
    const times = (args.playerCasts?.get(id) ?? []).filter((t) => t <= endMs);
    const cdMs = d.cooldownSeconds !== undefined ? d.cooldownSeconds * 1000 : undefined;
    const durMs = d.durationSeconds !== undefined ? d.durationSeconds * 1000 : undefined;

    const onCooldown: AutopsyInterval[] = [];
    const activeIntervals: AutopsyInterval[] = [];
    for (const c of times) {
      if (cdMs !== undefined) onCooldown.push({ startMs: c, endMs: c + cdMs });
      if (durMs !== undefined) {
        const s = Math.max(c, winStart);
        const e = Math.min(c + durMs, endMs);
        if (e > s) activeIntervals.push({ startMs: s, endMs: e });
      }
    }
    // Available = window minus cooldown spans. With no known cooldown we can't prove it was down,
    // so treat the whole window as available (conservative — never hide a possible press).
    const availableIntervals =
      cdMs === undefined
        ? [{ startMs: winStart, endMs }]
        : complementInWindow(onCooldown, winStart, endMs);
    defensives.push({
      spellId: id,
      name: d.name,
      type: d.type,
      availableIntervals,
      activeIntervals: mergeIntervals(activeIntervals),
    });
  }
  // Show defensives that were active first, then the rest by name (stable, glance-able order).
  defensives.sort(
    (a, b) => Number(b.activeIntervals.length > 0) - Number(a.activeIntervals.length > 0) || a.name.localeCompare(b.name),
  );

  return {
    windowMs: AUTOPSY_WINDOW_MS,
    startMs: winStart,
    endMs,
    maxHp,
    // Drop any trailing event (e.g. a heal that landed between the killing blow and the later UNIT_DIED)
    // past the death moment so nothing renders to the right of the 0.0s edge.
    hp: samples,
    events: killingBlowMs !== null ? events.filter((e) => e.ms <= endMs) : events,
    defensives,
    debuffs: debuffsInWindow(dangerByUnit.get(actorId), winStart, endMs),
    markers,
  };
}
