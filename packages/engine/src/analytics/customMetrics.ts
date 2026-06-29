// Custom metrics (#13) — user-defined "window discovery". A player tags conditions they care about
// ("Maelstrom > 90", "Tempest charges capped", "sitting on a defensive that's off cooldown") and the
// engine finds the TIME WINDOWS where each condition held, scoped to a run. Output is a list of
// intervals per matched unit + aggregates (count / total time / % of run / longest) — the same shape
// the replay can mark up. This is parameterized at runtime (rules come from the UI), so it is NOT a
// seed analytic; the worker evaluates it on demand against the resident store.
//
// What the log gives us per subject:
//   - resource: advanced-block `currentPower`/`powerType` sampled on the unit's own events (hold-last).
//   - aura:     SPELL_AURA_APPLIED/REMOVED/DOSE → exact present/stacks intervals.
//   - cooldown: SPELL_CAST_SUCCESS times + a known cooldown → "available & idle" windows (off CD,
//               not recast) = time spent sitting on the ability.
//   - charges:  charge-regen simulation from cast times → "at max charges" windows (wasted recharge).

import type { ColumnStore } from '../columns/columnStore.js';
import { DAMAGE_EVENT_NAMES } from '../columns/schema.js';

export type Comparator = '>' | '>=' | '<' | '<=';
/** Which units a rule applies to. `self` = the player who recorded the log (affiliation MINE). */
export type MetricTarget = 'self' | 'players' | 'enemies' | 'all' | { guid: string };

export type MetricSubject =
  | { kind: 'resource'; powerType: number; cmp: Comparator; value: number }
  | { kind: 'aura'; spellId: number; minStacks?: number; auraType?: 'BUFF' | 'DEBUFF' }
  /** Windows where an aura is NOT present on a unit that DOES use it (≥1 application in the run).
   *  `inCombatOnly` clips the gaps to the unit's combat periods (so mounting between packs isn't flagged). */
  | { kind: 'aura-missing'; spellId: number; auraType?: 'BUFF' | 'DEBUFF'; inCombatOnly?: boolean }
  | { kind: 'cooldown'; spellId: number; cooldownSeconds: number; minIdleSeconds?: number }
  | { kind: 'charges'; spellId: number; maxCharges: number; rechargeSeconds: number; minCappedSeconds?: number }
  /** Casts of `spellId` that hit FEWER than `minTargets` distinct enemies within `windowMs` of the cast
   *  — flags suboptimal AoE (e.g. Spinning Crane Kick / Chain Lightning cast on too few targets). */
  | { kind: 'targets-hit'; spellId: number; minTargets: number; windowMs?: number };

export interface CustomMetricRule {
  id: string;
  label: string;
  target: MetricTarget;
  subject: MetricSubject;
}

export interface MetricWindow {
  unitId: number;
  unitName: string;
  startMs: number;
  /** Infinity-safe: clamped to the range end when the condition was still true at run end. */
  endMs: number;
  durationMs: number;
  /** Subject-specific note: peak power, stack count, etc. */
  detail?: string;
}

export interface MetricResult {
  ruleId: string;
  label: string;
  windows: MetricWindow[];
  windowCount: number;
  totalDurationMs: number;
  longestMs: number;
  /** % of the evaluated range covered by ANY matching window (union across units). */
  pctOfRange: number;
  /** Coverage / caveat note (e.g. "no samples for this power type"). */
  note?: string;
}

export interface OwnerInfo {
  unitId: number;
  guid: string;
  name: string;
}

export interface CustomMetricsReport {
  owner: OwnerInfo | null;
  results: MetricResult[];
}

interface IdxRange {
  start: number;
  end: number;
}

/**
 * Detect whose log this is: the player unit carrying the MINE affiliation flag (`flags & 0xF === 1`).
 * Pets are also MINE, so we require a Player- GUID. Returns the first such player (constant per log).
 */
export function detectOwner(store: ColumnStore): OwnerInfo | null {
  const { count } = store;
  for (let i = 0; i < count; i++) {
    const sf = store.sourceFlagsNum(i);
    if (sf !== null && (sf & 0xf) === 0x1) {
      const g = store.sourceGuid[i]!;
      if (store.isPlayer(g)) return { unitId: g, guid: store.str(g), name: store.actorName(g) || store.str(g) };
    }
    const tf = store.targetFlagsNum(i);
    if (tf !== null && (tf & 0xf) === 0x1) {
      const g = store.targetGuid[i]!;
      if (store.isPlayer(g)) return { unitId: g, guid: store.str(g), name: store.actorName(g) || store.str(g) };
    }
  }
  return null;
}

function targetPredicate(target: MetricTarget, owner: OwnerInfo | null, store: ColumnStore): (unitId: number) => boolean {
  if (target === 'self') return (u) => owner !== null && u === owner.unitId;
  if (target === 'players') return (u) => store.isPlayer(u);
  if (target === 'enemies') return (u) => u !== 0 && !store.isPlayer(u);
  if (target === 'all') return (u) => u !== 0;
  // { guid }
  return (u) => u !== 0 && store.str(u) === target.guid;
}

const compare = (cmp: Comparator, a: number, b: number): boolean =>
  cmp === '>' ? a > b : cmp === '>=' ? a >= b : cmp === '<' ? a < b : a <= b;

/** Evaluate every rule over the (optional) event range, returning windows + aggregates per rule. */
export function evaluateCustomMetrics(store: ColumnStore, rules: CustomMetricRule[], range?: IdxRange): CustomMetricsReport {
  const lo = range?.start ?? 0;
  const hi = range?.end ?? store.count;
  const rangeStartMs = hi > lo ? store.ts[lo]! : 0;
  const rangeEndMs = hi > lo ? store.ts[hi - 1]! : 0;
  const owner = detectOwner(store);

  const results = rules.map((rule) => {
    const pred = targetPredicate(rule.target, owner, store);
    let windows: MetricWindow[];
    let note: string | undefined;
    switch (rule.subject.kind) {
      case 'resource':
        ({ windows, note } = resourceWindows(store, rule.subject, pred, lo, hi, rangeEndMs));
        break;
      case 'aura':
        ({ windows, note } = auraWindows(store, rule.subject, pred, lo, hi, rangeEndMs));
        break;
      case 'aura-missing':
        ({ windows, note } = auraMissingWindows(store, rule.subject, pred, lo, hi, rangeStartMs, rangeEndMs));
        break;
      case 'cooldown':
        ({ windows, note } = cooldownWindows(store, rule.subject, pred, lo, hi, rangeStartMs, rangeEndMs));
        break;
      case 'charges':
        ({ windows, note } = chargesWindows(store, rule.subject, pred, lo, hi, rangeStartMs, rangeEndMs));
        break;
      case 'targets-hit':
        ({ windows, note } = targetsHitWindows(store, rule.subject, pred, lo, hi, rangeEndMs));
        break;
    }
    return finalize(rule, windows, note, rangeStartMs, rangeEndMs);
  });

  return { owner, results };
}

function finalize(
  rule: CustomMetricRule,
  windows: MetricWindow[],
  note: string | undefined,
  rangeStartMs: number,
  rangeEndMs: number,
): MetricResult {
  windows.sort((a, b) => a.startMs - b.startMs || a.unitId - b.unitId);
  const totalDurationMs = windows.reduce((s, w) => s + w.durationMs, 0);
  const longestMs = windows.reduce((m, w) => Math.max(m, w.durationMs), 0);
  const rangeMs = Math.max(rangeEndMs - rangeStartMs, 1);
  // % of range covered by ANY window (union of intervals, so overlapping units don't double-count).
  const unionMs = unionDuration(windows);
  return {
    ruleId: rule.id,
    label: rule.label,
    windows,
    windowCount: windows.length,
    totalDurationMs,
    longestMs,
    pctOfRange: (unionMs / rangeMs) * 100,
    ...(note ? { note } : {}),
  };
}

function unionDuration(windows: MetricWindow[]): number {
  if (windows.length === 0) return 0;
  const ivals = windows.map((w) => [w.startMs, w.endMs] as [number, number]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curS, curE] = ivals[0]!;
  for (let i = 1; i < ivals.length; i++) {
    const [s, e] = ivals[i]!;
    if (s <= curE) curE = Math.max(curE, e);
    else {
      total += curE - curS;
      [curS, curE] = [s, e];
    }
  }
  total += curE - curS;
  return total;
}

// --- resource: hold-last power timeline per unit, threshold windows -------------------------------
function resourceWindows(
  store: ColumnStore,
  subj: Extract<MetricSubject, { kind: 'resource' }>,
  pred: (u: number) => boolean,
  lo: number,
  hi: number,
  rangeEndMs: number,
): { windows: MetricWindow[]; note?: string } {
  // Per-unit samples (ms, value) for the requested power type, in time order.
  const samplesByUnit = new Map<number, { ms: number; value: number }[]>();
  let anySample = false;
  for (let i = lo; i < hi; i++) {
    const snap = store.powerSnapshot(i);
    if (!snap || snap.powerType !== subj.powerType) continue;
    if (!pred(snap.unitId)) continue;
    anySample = true;
    (samplesByUnit.get(snap.unitId) ?? samplesByUnit.set(snap.unitId, []).get(snap.unitId)!).push({
      ms: store.ts[i]!,
      value: snap.currentPower,
    });
  }

  const windows: MetricWindow[] = [];
  for (const [unitId, samples] of samplesByUnit) {
    let open: { startMs: number; peak: number } | null = null;
    for (const s of samples) {
      const on = compare(subj.cmp, s.value, subj.value);
      if (on && !open) open = { startMs: s.ms, peak: s.value };
      else if (on && open) open.peak = Math.max(open.peak, s.value);
      else if (!on && open) {
        push(windows, store, unitId, open.startMs, s.ms, `peak ${open.peak}`);
        open = null;
      }
    }
    if (open) push(windows, store, unitId, open.startMs, rangeEndMs, `peak ${open.peak}`);
  }
  return { windows, note: anySample ? undefined : 'no samples for this power type on the targeted unit(s)' };
}

interface Interval {
  startMs: number;
  endMs: number;
}

/**
 * Per-unit PRESENCE intervals of an aura (where stacks ≥ minStacks), keyed by the unit it was on.
 * Only units that actually had the aura applied appear — so "who uses this buff" falls out naturally
 * (a non-DK never appears for Bone Shield). Shared by the present (aura) and missing (aura-missing) subjects.
 */
function auraPresenceByUnit(
  store: ColumnStore,
  spellId: number,
  auraType: 'BUFF' | 'DEBUFF' | undefined,
  minStacks: number,
  pred: (u: number) => boolean,
  lo: number,
  hi: number,
  rangeEndMs: number,
): Map<number, Interval[]> {
  const applied = store.eventTypeId('SPELL_AURA_APPLIED');
  const removed = store.eventTypeId('SPELL_AURA_REMOVED');
  const doseUp = store.eventTypeId('SPELL_AURA_APPLIED_DOSE');
  const doseDown = store.eventTypeId('SPELL_AURA_REMOVED_DOSE');
  const refresh = store.eventTypeId('SPELL_AURA_REFRESH');

  const state = new Map<number, { present: boolean; stacks: number; openStart: number | null }>();
  const out = new Map<number, Interval[]>();
  const st = (u: number) => state.get(u) ?? state.set(u, { present: false, stacks: 0, openStart: null }).get(u)!;
  const emit = (u: number, s: number, e: number) => (out.get(u) ?? out.set(u, []).get(u)!).push({ startMs: s, endMs: e });
  const sync = (u: number, ms: number) => {
    const s = st(u);
    const on = s.present && s.stacks >= minStacks;
    if (on && s.openStart === null) s.openStart = ms;
    else if (!on && s.openStart !== null) {
      emit(u, s.openStart, ms);
      s.openStart = null;
    }
  };

  for (let i = lo; i < hi; i++) {
    const et = store.eventType[i]!;
    if (store.spellIdNum(i) !== spellId) continue;
    const u = store.targetGuid[i]!;
    if (u === 0 || !pred(u)) continue;
    if (auraType && (store.detail(i, 'auraType') as string | undefined) !== auraType) continue;
    const ms = store.ts[i]!;
    const s = st(u);
    if (et === applied) {
      s.present = true;
      s.stacks = 1;
    } else if (et === removed) {
      s.present = false;
      s.stacks = 0;
    } else if (et === doseUp) {
      s.present = true;
      s.stacks += 1;
    } else if (et === doseDown) {
      s.stacks = Math.max(0, s.stacks - 1);
    } else if (et === refresh) {
      s.present = true;
      if (s.stacks === 0) s.stacks = 1;
    } else continue;
    sync(u, ms);
    if (!out.has(u)) out.set(u, []); // remember the unit even if it has no closed interval yet
  }
  for (const [u, s] of state) if (s.openStart !== null) emit(u, s.openStart, rangeEndMs);
  return out;
}

// --- aura: present (optionally stacks ≥ N) intervals ----------------------------------------------
function auraWindows(
  store: ColumnStore,
  subj: Extract<MetricSubject, { kind: 'aura' }>,
  pred: (u: number) => boolean,
  lo: number,
  hi: number,
  rangeEndMs: number,
): { windows: MetricWindow[]; note?: string } {
  const minStacks = subj.minStacks ?? 1;
  const byUnit = auraPresenceByUnit(store, subj.spellId, subj.auraType, minStacks, pred, lo, hi, rangeEndMs);
  const windows: MetricWindow[] = [];
  for (const [u, intervals] of byUnit)
    for (const iv of intervals) push(windows, store, u, iv.startMs, iv.endMs, minStacks > 1 ? `≥${minStacks} stacks` : undefined);
  return { windows };
}

// --- aura-missing: windows where a buff is NOT up (on units that use it), optionally combat-only -----
function auraMissingWindows(
  store: ColumnStore,
  subj: Extract<MetricSubject, { kind: 'aura-missing' }>,
  pred: (u: number) => boolean,
  lo: number,
  hi: number,
  rangeStartMs: number,
  rangeEndMs: number,
): { windows: MetricWindow[]; note?: string } {
  const byUnit = auraPresenceByUnit(store, subj.spellId, subj.auraType, 1, pred, lo, hi, rangeEndMs);
  const windows: MetricWindow[] = [];
  for (const [u, presence] of byUnit) {
    // Absence = the complement of presence across the run, then (optionally) only the parts in combat.
    let absence = complement(presence, rangeStartMs, rangeEndMs);
    if (subj.inCombatOnly) absence = intersect(absence, combatIntervals(store, u, lo, hi));
    for (const iv of absence) push(windows, store, u, iv.startMs, iv.endMs, subj.inCombatOnly ? 'missing (in combat)' : 'missing');
  }
  return {
    windows,
    note: byUnit.size === 0 ? 'no targeted unit ever had this buff applied — nothing to flag as missing' : undefined,
  };
}

/** A gap larger than this between a unit's combat events ends a combat period (matches the segmenter). */
const COMBAT_GAP_MS = 5000;

/** Combat periods for `unitId`: bursts of damage events (dealt or taken), merged across <5s gaps. */
function combatIntervals(store: ColumnStore, unitId: number, lo: number, hi: number): Interval[] {
  const damageIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
  const out: Interval[] = [];
  let curStart = -1;
  let last = -1;
  for (let i = lo; i < hi; i++) {
    if (!damageIds.has(store.eventType[i]!)) continue;
    if (store.sourceGuid[i] !== unitId && store.targetGuid[i] !== unitId) continue;
    const ms = store.ts[i]!;
    if (curStart < 0) curStart = ms;
    else if (ms - last > COMBAT_GAP_MS) {
      out.push({ startMs: curStart, endMs: last });
      curStart = ms;
    }
    last = ms;
  }
  if (curStart >= 0) out.push({ startMs: curStart, endMs: last });
  return out;
}

/** Complement of `present` intervals within [rangeStart, rangeEnd] (present is merged/clamped first). */
function complement(present: Interval[], rangeStart: number, rangeEnd: number): Interval[] {
  const merged = mergeIntervals(present);
  const out: Interval[] = [];
  let cursor = rangeStart;
  for (const p of merged) {
    if (p.startMs > cursor) out.push({ startMs: cursor, endMs: Math.min(p.startMs, rangeEnd) });
    cursor = Math.max(cursor, p.endMs);
    if (cursor >= rangeEnd) break;
  }
  if (cursor < rangeEnd) out.push({ startMs: cursor, endMs: rangeEnd });
  return out.filter((iv) => iv.endMs > iv.startMs);
}

function mergeIntervals(ivals: Interval[]): Interval[] {
  if (ivals.length === 0) return [];
  const sorted = [...ivals].sort((a, b) => a.startMs - b.startMs);
  const out: Interval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = out[out.length - 1]!;
    const iv = sorted[i]!;
    if (iv.startMs <= cur.endMs) cur.endMs = Math.max(cur.endMs, iv.endMs);
    else out.push({ ...iv });
  }
  return out;
}

/** Intersection of two interval lists (both will be sorted/merged internally). */
function intersect(a: Interval[], b: Interval[]): Interval[] {
  const A = mergeIntervals(a);
  const B = mergeIntervals(b);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < A.length && j < B.length) {
    const s = Math.max(A[i]!.startMs, B[j]!.startMs);
    const e = Math.min(A[i]!.endMs, B[j]!.endMs);
    if (s < e) out.push({ startMs: s, endMs: e });
    if (A[i]!.endMs < B[j]!.endMs) i++;
    else j++;
  }
  return out;
}

// --- cooldown: time spent off-cooldown and not recast (sitting on an ability) ----------------------
function cooldownWindows(
  store: ColumnStore,
  subj: Extract<MetricSubject, { kind: 'cooldown' }>,
  pred: (u: number) => boolean,
  lo: number,
  hi: number,
  rangeStartMs: number,
  rangeEndMs: number,
): { windows: MetricWindow[]; note?: string } {
  const cdMs = subj.cooldownSeconds * 1000;
  const minIdle = (subj.minIdleSeconds ?? 0) * 1000;
  const castsByUnit = castTimes(store, subj.spellId, pred, lo, hi);
  const windows: MetricWindow[] = [];
  for (const [unitId, times] of castsByUnit) {
    // Assume the ability is OFF cooldown at the run start, so availability begins at rangeStartMs (not
    // at the first cast). Each cast then pushes availability `cdMs` later; "sitting" = available until
    // the next cast (or range end). We still require ≥1 cast to know the unit owns the ability.
    let availAt = rangeStartMs;
    for (const tc of times) {
      if (tc - availAt >= minIdle && tc > availAt) push(windows, store, unitId, availAt, tc, 'available, unused');
      availAt = tc + cdMs;
    }
    if (rangeEndMs - availAt >= minIdle && rangeEndMs > availAt) push(windows, store, unitId, availAt, rangeEndMs, 'available, unused');
  }
  return {
    windows,
    note: castsByUnit.size === 0 ? 'no casts of this spell by the targeted unit(s) — cannot infer the cooldown' : undefined,
  };
}

// --- charges: time spent at max charges (wasted recharge) ------------------------------------------
function chargesWindows(
  store: ColumnStore,
  subj: Extract<MetricSubject, { kind: 'charges' }>,
  pred: (u: number) => boolean,
  lo: number,
  hi: number,
  rangeStartMs: number,
  rangeEndMs: number,
): { windows: MetricWindow[]; note?: string } {
  const rechargeMs = subj.rechargeSeconds * 1000;
  const minCapped = (subj.minCappedSeconds ?? 0) * 1000;
  const castsByUnit = castTimes(store, subj.spellId, pred, lo, hi);
  const windows: MetricWindow[] = [];
  for (const [unitId, times] of castsByUnit) {
    // Simulate a fractional charge bank, ASSUMING FULL AT RUN START (so charges held from the run
    // start until the first cast count as capped). Each cast spends one; charges regen at rechargeMs.
    let charges = subj.maxCharges;
    let last = rangeStartMs;
    let cappedSince: number | null = rangeStartMs; // at max from the run start
    for (let k = 0; k < times.length; k++) {
      const now = times[k]!;
      // regen since last event
      const regen = (now - last) / rechargeMs;
      const before = charges;
      charges = Math.min(subj.maxCharges, charges + regen);
      // crossing UP to cap between last and now → capped from the cap-cross time
      if (before < subj.maxCharges && charges >= subj.maxCharges && cappedSince === null) {
        cappedSince = now - (charges - subj.maxCharges) * rechargeMs; // ~ when it hit cap
        if (cappedSince < last) cappedSince = last;
      }
      // a cast spends a charge → leaves cap
      if (cappedSince !== null) {
        if (now - cappedSince >= minCapped && now > cappedSince) push(windows, store, unitId, cappedSince, now, 'charges capped');
        cappedSince = null;
      }
      charges = Math.max(0, charges - 1);
      last = now;
    }
    // after the last cast, does it recharge to cap before range end?
    const toCapMs = (subj.maxCharges - charges) * rechargeMs;
    const capAt = last + toCapMs;
    if (capAt < rangeEndMs && rangeEndMs - capAt >= minCapped) push(windows, store, unitId, capAt, rangeEndMs, 'charges capped');
  }
  return {
    windows,
    note: castsByUnit.size === 0 ? 'no casts of this spell by the targeted unit(s) — cannot simulate charges' : undefined,
  };
}

// --- targets-hit: casts that landed on too few enemies (suboptimal AoE) ---------------------------
const DEFAULT_TARGETS_WINDOW_MS = 1000;

function targetsHitWindows(
  store: ColumnStore,
  subj: Extract<MetricSubject, { kind: 'targets-hit' }>,
  pred: (u: number) => boolean,
  lo: number,
  hi: number,
  rangeEndMs: number,
): { windows: MetricWindow[]; note?: string } {
  const castId = store.eventTypeId('SPELL_CAST_SUCCESS');
  if (castId === undefined) return { windows: [], note: 'no SPELL_CAST_SUCCESS events' };
  const damageIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
  const windowMs = subj.windowMs ?? DEFAULT_TARGETS_WINDOW_MS;

  // One pass: the spell's casts (by a targeted caster) + its damage events (ms-ordered ⇒ pre-sorted).
  // Damage source is owner-resolved so a pet/guardian's hit counts for the caster.
  const casts: { ms: number; caster: number }[] = [];
  const dmg: { ms: number; owner: number; tgt: number }[] = [];
  for (let i = lo; i < hi; i++) {
    if (store.spellIdNum(i) !== subj.spellId) continue;
    const et = store.eventType[i]!;
    if (et === castId) {
      const u = store.sourceGuid[i]!;
      if (u !== 0 && pred(u)) casts.push({ ms: store.ts[i]!, caster: u });
    } else if (damageIds.has(et)) {
      const tgt = store.targetGuid[i]!;
      if (tgt === 0 || store.isPlayer(tgt)) continue; // count distinct ENEMY targets only
      dmg.push({ ms: store.ts[i]!, owner: store.ownerOf(store.sourceGuid[i]!), tgt });
    }
  }
  if (casts.length === 0) return { windows: [], note: 'no casts of this spell by the targeted unit(s)' };

  // For each cast, count distinct enemy GUIDs this caster damaged with the spell within the window.
  // Casts + dmg are both ascending, so a single advancing lower-bound pointer keeps it ~linear.
  const windows: MetricWindow[] = [];
  let lowIdx = 0;
  for (const c of casts) {
    while (lowIdx < dmg.length && dmg[lowIdx]!.ms < c.ms) lowIdx++;
    const seen = new Set<number>();
    for (let j = lowIdx; j < dmg.length && dmg[j]!.ms <= c.ms + windowMs; j++) {
      if (dmg[j]!.owner === c.caster) seen.add(dmg[j]!.tgt);
    }
    const hits = seen.size;
    if (hits < subj.minTargets) {
      push(windows, store, c.caster, c.ms, Math.min(c.ms + windowMs, rangeEndMs), `hit ${hits} (<${subj.minTargets})`);
    }
  }
  return { windows };
}

/** Per-unit ascending SPELL_CAST_SUCCESS timestamps for `spellId`, filtered by target predicate. */
function castTimes(store: ColumnStore, spellId: number, pred: (u: number) => boolean, lo: number, hi: number): Map<number, number[]> {
  const cast = store.eventTypeId('SPELL_CAST_SUCCESS');
  const out = new Map<number, number[]>();
  if (cast === undefined) return out;
  for (let i = lo; i < hi; i++) {
    if (store.eventType[i] !== cast || store.spellIdNum(i) !== spellId) continue;
    const u = store.sourceGuid[i]!;
    if (u === 0 || !pred(u)) continue;
    (out.get(u) ?? out.set(u, []).get(u)!).push(store.ts[i]!);
  }
  return out;
}

function push(windows: MetricWindow[], store: ColumnStore, unitId: number, startMs: number, endMs: number, detail?: string): void {
  if (endMs <= startMs) return;
  windows.push({
    unitId,
    unitName: store.actorName(unitId) || store.str(unitId),
    startMs,
    endMs,
    durationMs: endMs - startMs,
    ...(detail ? { detail } : {}),
  });
}

/** Common power-type ids for the rule builder (label → WoW power id). Extend as needed. */
export const POWER_TYPES: { id: number; name: string }[] = [
  { id: 0, name: 'Mana' },
  { id: 1, name: 'Rage' },
  { id: 2, name: 'Focus' },
  { id: 3, name: 'Energy' },
  { id: 4, name: 'Combo Points' },
  { id: 6, name: 'Runic Power' },
  { id: 7, name: 'Soul Shards' },
  { id: 8, name: 'Astral Power' },
  { id: 11, name: 'Maelstrom' },
  { id: 12, name: 'Chi' },
  { id: 13, name: 'Insanity' },
  { id: 17, name: 'Fury' },
  { id: 18, name: 'Pain' },
  { id: 19, name: 'Essence' },
];
