// Death recap (#10) — for every player death, did they use the survival cooldowns they HAD?
// The point is a glance-able verdict: "pressed 0 of 3 off-cooldown defensives in the last 20s"
// means they let themselves die; "pressed 2 of 2" means they did what they could. Built on:
//   - COMBATANT_INFO specId -> class/spec  => the player's FULL defensive kit (not just what they cast)
//   - the curated defensives (overlay: cooldownSeconds/durationSeconds/type)
//   - SPELL_CAST_SUCCESS casts of those defensives  => used? / available (off CD)? / active at death?
//   - the HP timeline                               => HP% entering the window and at death
// This is also the data layer for the eventual HP-line + ability-icon timeline view.

import type { Analytic, AnalyticContext } from '../types.js';
import { Primitives } from '../primitives/index.js';
import { SpellTable, type DefensiveType } from '../../spells/spellTable.js';
import { classSpecOf } from '../../spells/specIds.js';
import { DAMAGE_EVENT_NAMES, HEAL_EVENT_NAMES } from '../../columns/schema.js';
import { effectiveRange } from './helpers.js';
import { buildAutopsy, buildDangerDebuffIntervals, type DeathAutopsy } from './deathAutopsy.js';

export interface DeathRecapParams {
  /** Seconds of pre-death history the recap considers (the "did they react?" window). */
  windowSeconds: number;
}
export const DEFAULT_DEATH_RECAP_PARAMS: DeathRecapParams = { windowSeconds: 20 };

/** HP fraction at/above which a player counts as "healthy" — used for the informational
 *  `timeFromHealthyMs` datum (NOT the pace classification, which is fraction-of-HP-lost based). */
const HEALTHY_FRACTION = 0.9;

// Death pace is classified by how large a fraction of MAX HP the player lost in a short window right
// before death — not by time-since-full. (A player chipped to 85% by fall damage 10s earlier and then
// one-shot is a one-shot, even though they weren't "healthy" entering the lethal hit.) Because HP only
// changes on logged events, the hold-last HP at a window's start is a reliable read of where they were.
const ONESHOT_WINDOW_MS = 1000;
const ONESHOT_FRACTION = 0.7; // ≥70% of max HP gone in the last 1s ⇒ one-shot / instagib
const BURST_WINDOW_MS = 3000;
const BURST_FRACTION = 0.45; // ≥45% of max HP gone in the last 3s ⇒ burst

/** Self-castable survival cooldowns — the ones the dying player could have pressed to live.
 *  'external' is cast on an ally (not self-survival); 'aura' is passive (not a press decision). */
const SELF_SURVIVAL_TYPES: ReadonlySet<DefensiveType> = new Set(['personal', 'tank', 'raid'] as DefensiveType[]);

export interface DefensiveStatus {
  spellId: number;
  name: string;
  type: DefensiveType;
  cooldownSeconds?: number;
  durationSeconds?: number;
  /** Self-castable survival CD (counts toward the verdict) vs external/passive (listed, not counted). */
  selfSurvival: boolean;
  /** Cast within [windowStart, death]. */
  usedInWindow: boolean;
  /** Seconds before death of the most recent cast (null = never cast this run). */
  lastUsedSecBeforeDeath: number | null;
  /** Buff was still up at death (lastCast + duration >= death). */
  activeAtDeath: boolean;
  /** Off cooldown at death (never cast, or time since last cast >= cooldown). */
  availableAtDeath: boolean;
}

export interface DeathRecapRow {
  actorId: number;
  name: string;
  tsMs: number;
  classSpec: string | null;
  killingBlowSpellId?: number;
  killingBlowName?: string;
  /** Landed amount of the killing-blow hit (includes overkill). undefined = no identifiable blow.
   *  Excluded from the healing-coverage denominator so one lethal spike doesn't make the healer look
   *  absent — coverage is measured against the SURVIVABLE damage they could realistically heal. */
  killingBlowAmount?: number;
  /** How preventable was the killing-blow mechanic? 'avoidable' = curated avoidable (they could have
   *  dodged it personally); 'interruptible' = it came from an interruptible cast (the group should have
   *  KICKED it — a utility miss, not the victim standing in something); 'unavoidable' = a known enemy
   *  mechanic that's neither (tank-buster / raid-wide — not their fault to eat); 'unknown' = the spell
   *  isn't in the curated table. undefined when there was no identifiable killing blow. */
  killingBlowAvoidable?: 'avoidable' | 'interruptible' | 'unavoidable' | 'unknown';
  windowSeconds: number;
  hpEnteringWindowPct: number | null;
  /** ms from the last moment the player was "healthy" (HP > 90%) to death. null = no healthy HP
   *  sample before death (HP reconstruction too sparse). Small values ⇒ a one-shot / instagib. */
  timeFromHealthyMs: number | null;
  /** Inferred death speed from the fraction of MAX HP lost in the final window: one-shot (≥70% in 1s) /
   *  burst (≥45% in 3s) / gradual / unknown (no HP reconstruction). Independent of starting HP, so a
   *  chipped player who is then one-shot still reads as one-shot. */
  deathPace: 'one-shot' | 'burst' | 'gradual' | 'unknown';
  /** Effective healing the player RECEIVED in the death window (raw − overheal). A rough read of
   *  whether the healer was on them — compare to `damageTakenInWindow`. */
  healingReceivedInWindow: number;
  /** Damage the player TOOK in the death window — context for the healing-received number (was it a
   *  healer no-show, or were they simply out-damaged / a triage casualty?). */
  damageTakenInWindow: number;
  /** Survival CDs that were OFF cooldown at death but not pressed in the window. */
  availableUnused: number;
  /** Survival CDs pressed in the window. */
  pressed: number;
  /** Glance-able summary. */
  verdict: string;
  defensives: DefensiveStatus[];
  /** The pre-death timeline (HP line + events + defensive/debuff tracks + markers) for the autopsy
   *  graph. Windowed to AUTOPSY_WINDOW_MS (8s), independent of the 20s verdict window above. */
  autopsy: DeathAutopsy;
}

export interface DeathRecapResult {
  params: DeathRecapParams;
  deaths: DeathRecapRow[];
  coverageNote: string;
}

/** playerGuid string -> specId, from COMBATANT_INFO (one per player per pull). */
function combatantSpecs(store: AnalyticContext['store']): Map<string, number> {
  const out = new Map<string, number>();
  const id = store.eventTypeId('COMBATANT_INFO');
  if (id === undefined) return out;
  for (let i = 0; i < store.count; i++) {
    if (store.eventType[i] !== id) continue;
    const guid = store.detail(i, 'playerGuid');
    const spec = store.detailNumber(i, 'specId');
    if (typeof guid === 'string' && spec !== undefined) out.set(guid, spec);
  }
  return out;
}

/** Per (player unitId, defensive spellId) ascending cast timestamps — over the WHOLE log, since a
 *  cast well before the death window still governs whether the CD was available. */
function defensiveCasts(store: AnalyticContext['store'], defIds: ReadonlySet<number>): Map<number, Map<number, number[]>> {
  const out = new Map<number, Map<number, number[]>>();
  const castId = store.eventTypeId('SPELL_CAST_SUCCESS');
  if (castId === undefined || defIds.size === 0) return out;
  for (let i = 0; i < store.count; i++) {
    if (store.eventType[i] !== castId) continue;
    const sp = store.spellIdNum(i);
    if (sp === null || !defIds.has(sp)) continue;
    const src = store.sourceGuid[i]!;
    if (!store.isPlayer(src)) continue;
    const bySpell = out.get(src) ?? out.set(src, new Map()).get(src)!;
    (bySpell.get(sp) ?? bySpell.set(sp, []).get(sp)!).push(store.ts[i]!);
  }
  return out;
}

function specApplies(defSpec: string | undefined, playerSpec: string): boolean {
  if (!defSpec || defSpec === 'All') return true;
  return defSpec.split(',').some((s) => s.trim() === playerSpec);
}

export function computeDeathRecap(
  store: AnalyticContext['store'],
  prim: Primitives,
  table: SpellTable,
  params: DeathRecapParams,
  range: { start: number; end: number },
): DeathRecapResult {
  const unitDied = store.eventTypeId('UNIT_DIED');
  const empty: DeathRecapResult = { params, deaths: [], coverageNote: '' };
  if (unitDied === undefined) return empty;

  const specs = combatantSpecs(store);
  const defIds = table.defensiveSpellIds();
  const casts = defensiveCasts(store, defIds);
  const hp = prim.hpTimeline();
  const damageIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
  const healIds = store.eventTypeIds(HEAL_EVENT_NAMES);
  const windowMs = params.windowSeconds * 1000;
  // Dangerous-debuff presence for every player, one store pass — reused by each death's autopsy.
  const dangerByUnit = buildDangerDebuffIntervals(store, table);

  const rows: DeathRecapRow[] = [];
  let unknownSpec = 0;

  // Clamp to the store — a caller may pass an open-ended range (e.g. end = MAX_SAFE_INTEGER for
  // "whole log"); without this the scan would spin past store.count to the integer ceiling.
  const start = Math.max(0, range.start);
  const end = Math.min(range.end, store.count);
  for (let i = start; i < end; i++) {
    if (store.eventType[i] !== unitDied) continue;
    const actorId = store.targetGuid[i]!;
    if (!store.isPlayer(actorId)) continue; // exclude pet/summon despawns (Chi-Ji etc.)
    const deathMs = store.ts[i]!;
    const windowStart = deathMs - windowMs;

    const cs = classSpecOf(specs.get(store.str(actorId)));
    if (!cs) unknownSpec++;
    const playerCasts = casts.get(actorId);

    // killing blow: most recent damage on this target just before death
    let killingBlowSpellId: number | undefined;
    let killingBlowName: string | undefined;
    let killingBlowAvoidable: 'avoidable' | 'interruptible' | 'unavoidable' | 'unknown' | undefined;
    let killingBlowAmount: number | undefined;
    for (let j = i - 1; j >= 0 && j >= i - 64; j--) {
      if (store.targetGuid[j] === actorId && damageIds.has(store.eventType[j]!)) {
        killingBlowAmount = store.amount[j]!;
        const sid = store.spellIdNum(j);
        if (sid !== null) {
          killingBlowSpellId = sid;
          killingBlowName = store.spellName(sid) || `spell:${sid}`;
          // Avoidable = curated as personally dodgeable; interruptible = came from an interruptible
          // cast (a kick would have stopped it — group/utility miss, not the victim's fault for
          // standing in it); unavoidable = a known enemy mechanic that's neither (tank-buster/
          // raid-wide); unknown = not in the table at all. Avoidable wins over interruptible (the
          // dying player could have removed themselves regardless of kicks).
          killingBlowAvoidable = table.isAvoidable(sid)
            ? 'avoidable'
            : table.interruptPriority(sid)
              ? 'interruptible'
              : table.get(sid)
                ? 'unavoidable'
                : 'unknown';
        }
        break;
      }
    }

    // Healing received vs damage taken in the window before death. Events are time-ordered, so walk
    // back from the death while still inside the window (a bounded scan, not a full-store pass).
    let healingReceivedInWindow = 0;
    let damageTakenInWindow = 0;
    for (let j = i - 1; j >= start && store.ts[j]! >= windowStart; j--) {
      if (store.targetGuid[j] !== actorId) continue;
      const et = store.eventType[j]!;
      if (damageIds.has(et)) {
        damageTakenInWindow += store.amount[j]!;
      } else if (healIds.has(et)) {
        const oh = store.detailNumber(j, 'overheal') ?? store.detailNumber(j, 'overhealing') ?? 0;
        healingReceivedInWindow += Math.max(0, store.amount[j]! - oh);
      }
    }

    // Which defensives this player owns: when spec is known, the full class/spec kit; when unknown,
    // fall back to defensives they actually cast (so we still show what they used).
    const applicableIds = cs
      ? [...defIds].filter((id) => {
          const d = table.defensive(id);
          return d?.class === cs.className && specApplies(d.spec, cs.specName);
        })
      : [...(playerCasts?.keys() ?? [])];

    const defensives: DefensiveStatus[] = [];
    for (const id of applicableIds) {
      const d = table.defensive(id);
      if (!d) continue;
      const times = playerCasts?.get(id) ?? [];
      let lastBefore: number | null = null;
      for (const t of times) if (t < deathMs) lastBefore = t; // ascending → last wins
      const usedInWindow = lastBefore !== null && lastBefore >= windowStart;
      const cdMs = d.cooldownSeconds !== undefined ? d.cooldownSeconds * 1000 : undefined;
      const availableAtDeath =
        lastBefore === null ? true : cdMs !== undefined ? deathMs - lastBefore >= cdMs : !usedInWindow;
      const activeAtDeath =
        lastBefore !== null && d.durationSeconds !== undefined && lastBefore + d.durationSeconds * 1000 >= deathMs;
      defensives.push({
        spellId: id,
        name: d.name,
        type: d.type,
        ...(d.cooldownSeconds !== undefined ? { cooldownSeconds: d.cooldownSeconds } : {}),
        ...(d.durationSeconds !== undefined ? { durationSeconds: d.durationSeconds } : {}),
        selfSurvival: SELF_SURVIVAL_TYPES.has(d.type),
        usedInWindow,
        lastUsedSecBeforeDeath: lastBefore === null ? null : Math.round((deathMs - lastBefore) / 100) / 10,
        activeAtDeath,
        availableAtDeath,
      });
    }
    // Most actionable first: available-but-unused survival CDs at the top.
    defensives.sort(
      (a, b) =>
        Number(b.selfSurvival && b.availableAtDeath && !b.usedInWindow) -
          Number(a.selfSurvival && a.availableAtDeath && !a.usedInWindow) || a.name.localeCompare(b.name),
    );

    const survival = defensives.filter((d) => d.selfSurvival);
    const pressed = survival.filter((d) => d.usedInWindow).length;
    const availableUnused = survival.filter((d) => d.availableAtDeath && !d.usedInWindow).length;
    const offCd = pressed + availableUnused;
    const verdict = !cs
      ? `class/spec unknown — showing ${defensives.length} cast defensive(s)`
      : offCd === 0
        ? `no survival cooldowns available`
        : `pressed ${pressed} of ${offCd} off-cooldown survival cooldown(s) in the last ${params.windowSeconds}s`;

    const hpEntering = hp.hpAt(actorId, windowStart);

    const ut = hp.unit(actorId);
    // `timeFromHealthyMs` (informational): ms from the last >90% HP sample to death.
    let lastHealthyMs: number | null = null;
    if (ut) {
      for (const s of ut.samples) {
        if (s.ms > deathMs) break;
        if (s.maxHp > 0 && s.currentHp / s.maxHp > HEALTHY_FRACTION) lastHealthyMs = s.ms;
      }
    }
    const timeFromHealthyMs = lastHealthyMs === null ? null : deathMs - lastHealthyMs;

    // Pace = peak HP fraction held within the final window (= the fraction of max HP lost to reach 0).
    // Held value at window-start counts (HP doesn't change without a logged event). -1 ⇒ no HP info.
    const peakFractionIn = (windowMs: number): number => {
      const start = deathMs - windowMs;
      let peak = -1;
      const at = hp.hpAt(actorId, start);
      if (at) peak = at.fraction;
      if (ut) {
        for (const s of ut.samples) {
          if (s.ms < start) continue;
          if (s.ms > deathMs) break;
          if (s.maxHp > 0) peak = Math.max(peak, s.currentHp / s.maxHp);
        }
      }
      return peak;
    };
    const peak1 = peakFractionIn(ONESHOT_WINDOW_MS);
    const peak3 = peakFractionIn(BURST_WINDOW_MS); // ⊇ peak1's window ⇒ peak3 ≥ peak1; <0 only if no data
    const deathPace =
      peak3 < 0 ? 'unknown' : peak1 >= ONESHOT_FRACTION ? 'one-shot' : peak3 >= BURST_FRACTION ? 'burst' : 'gradual';

    rows.push({
      actorId,
      name: store.actorName(actorId),
      tsMs: deathMs,
      classSpec: cs ? `${cs.specName} ${cs.className}` : null,
      ...(killingBlowSpellId !== undefined ? { killingBlowSpellId } : {}),
      ...(killingBlowName !== undefined ? { killingBlowName } : {}),
      ...(killingBlowAvoidable !== undefined ? { killingBlowAvoidable } : {}),
      ...(killingBlowAmount !== undefined ? { killingBlowAmount } : {}),
      windowSeconds: params.windowSeconds,
      hpEnteringWindowPct: hpEntering ? Math.round(hpEntering.fraction * 1000) / 10 : null,
      timeFromHealthyMs,
      deathPace,
      healingReceivedInWindow,
      damageTakenInWindow,
      availableUnused,
      pressed,
      verdict,
      defensives,
      autopsy: buildAutopsy({
        store,
        table,
        hp,
        dangerByUnit,
        damageIds,
        healIds,
        actorId,
        deathIdx: i,
        deathMs,
        rangeStart: start,
        applicableDefensiveIds: applicableIds,
        playerCasts,
      }),
    });
  }

  const coverageNote =
    rows.length === 0
      ? 'no player deaths in range'
      : `${rows.length} death(s); ${unknownSpec} without COMBATANT_INFO class/spec` +
        (defIds.size === 0 ? ' — no defensives curated, recap is empty' : '');
  return { params, deaths: rows, coverageNote };
}

export const deathRecap: Analytic<DeathRecapResult> = {
  id: 'deaths.recap',
  title: 'Death Recap (defensives used vs available)',
  role: 'all',
  columns: ['eventType', 'target', 'source', 'spell', 'ts'],
  summary: false,
  run(ctx) {
    return computeDeathRecap(
      ctx.store,
      Primitives.for(ctx.store),
      ctx.spellTable ?? SpellTable.empty(),
      DEFAULT_DEATH_RECAP_PARAMS,
      effectiveRange(ctx),
    );
  },
};
