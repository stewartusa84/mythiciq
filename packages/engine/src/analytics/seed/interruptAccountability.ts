import type { Analytic, AnalyticContext } from '../types.js';
import { SpellTable } from '../../spells/spellTable.js';
import { msRangeOf } from './helpers.js';
import { interruptForSpec, IMPORTANT_COOLDOWNS } from '../../spells/importantCooldowns.js';
import { roleOf } from '../../spells/specIds.js';

// ---------------------------------------------------------------------------
// Per-DPS-player interrupt accountability.
//
// For each DPS player we report:
//   • interrupted     — DANGEROUS interruptible enemy casts THIS player kicked.
//   • missed          — DANGEROUS interruptible enemy casts that WENT OFF while this
//                       player's interrupt was available (off cooldown + alive). This is
//                       NOT "every cast that went off" — only the ones they could have
//                       stopped. A single completed cast can be "missed" by several players.
//   • damageAllowed   — party damage taken from those missed casts (the cast's own spell
//                       id landing on players within DAMAGE_WINDOW_MS of the cast). The
//                       "avoidable damage allowed" by not kicking.
//
// Availability is modelled from the player's interrupt cast times + a base cooldown, with
// the player assumed available at run start and ALIVE until a UNIT_DIED (re-alive on their
// next cast). All approximate — cooldown is a base value (haste/talents shorten some) and
// the damage link is by cast spell id (a cast whose damage uses a different id under-counts).
// ---------------------------------------------------------------------------

/** Window after a completed dangerous cast in which same-spell-id damage on players counts. */
export const DAMAGE_WINDOW_MS = 8000;

export interface InterruptAccountabilityPlayer {
  id: number;
  name: string;
  /** The player's interrupt spell id (from spec), or null when the spec has no known interrupt. */
  interruptSpellId: number | null;
  interruptName: string | null;
  interrupted: number;
  missed: number;
  damageAllowed: number;
}

export interface InterruptAccountabilityResult {
  players: InterruptAccountabilityPlayer[];
  /** Dangerous interruptible casts that went off (completed) in range. */
  dangerousCompleted: number;
  /** Dangerous interruptible casts that were interrupted in range. */
  dangerousInterrupted: number;
  damageWindowMs: number;
  coverageNote: string;
}

const COVERAGE_NOTE =
  'Dangerous = curated interrupt-priority in the spell table. "Missed" attributes a completed dangerous ' +
  'cast to every alive DPS who could have interrupted it — their interrupt was available, OR on cooldown ' +
  'only from a non-dangerous interrupt (spending it on trash does not excuse a missed important cast; only ' +
  'interrupting another DANGEROUS cast does). Base cooldowns, approximate. Damage allowed sums the cast ' +
  'spell landing on players within 8s — casts whose damage uses a different spell id under-count. Bounded ' +
  'by spell-table coverage and COMBATANT_INFO spec detection.';

interface PlayerState {
  id: number;
  name: string;
  interruptSpellId: number | null;
  interruptName: string | null;
  cdMs: number;
  // mutable forward-pass state
  lastUseMs: number; // -Infinity = never used (available from run start)
  alive: boolean;
  interrupted: number;
  missed: number;
  damageAllowed: number;
}

export function computeInterruptAccountability(
  store: AnalyticContext['store'],
  table: SpellTable,
  range: { startMs: number; endMs: number },
): InterruptAccountabilityResult {
  const interruptId = store.eventTypeId('SPELL_INTERRUPT');
  const castId = store.eventTypeId('SPELL_CAST_SUCCESS');
  const startId = store.eventTypeId('SPELL_CAST_START');
  const diedId = store.eventTypeId('UNIT_DIED');
  const damageId = store.eventTypeId('SPELL_DAMAGE');
  const periodicId = store.eventTypeId('SPELL_PERIODIC_DAMAGE');
  const ciId = store.eventTypeId('COMBATANT_INFO');

  // --- specId per player (COMBATANT_INFO guid -> specId) ---
  const specByGuid = new Map<string, number>();
  if (ciId !== undefined) {
    for (let i = 0; i < store.count; i++) {
      if (store.eventType[i] !== ciId) continue;
      const guid = store.detail(i, 'playerGuid');
      const specId = store.detailNumber(i, 'specId');
      if (typeof guid === 'string' && specId !== undefined) specByGuid.set(guid, specId);
    }
  }

  // --- DPS players (by COMBATANT_INFO role) ---
  const players = new Map<number, PlayerState>();
  for (const id of store.actorIds()) {
    if (!store.isPlayer(id)) continue;
    const specId = specByGuid.get(store.str(id));
    if (roleOf(specId) !== 'dps') continue; // only DPS are broken out here
    const intId = interruptForSpec(specId);
    const def = intId !== undefined ? IMPORTANT_COOLDOWNS[intId] : undefined;
    players.set(id, {
      id,
      name: store.actorName(id) || `#${id}`,
      interruptSpellId: intId ?? null,
      interruptName: def?.name ?? null,
      cdMs: (def?.cooldownSeconds ?? 15) * 1000,
      lastUseMs: -Infinity,
      alive: true,
      interrupted: 0,
      missed: 0,
      damageAllowed: 0,
    });
  }

  // Damage on players, indexed by spell id, but ONLY for dangerous interruptible spells (so the
  // index stays small and aligns with the casts we link). Forward pass ⇒ each list is ms-sorted.
  const dmgBySpell = new Map<number, { ms: number; amt: number }[]>();
  const dangerousCache = new Map<number, boolean>(); // spellId -> is dangerous-interruptible
  const isDangerousInterruptible = (spellId: number): boolean => {
    let v = dangerousCache.get(spellId);
    if (v === undefined) {
      const info = table.get(spellId);
      v = !!info?.interruptible && (info.interruptPriority ?? 'regular') === 'dangerous';
      dangerousCache.set(spellId, v);
    }
    return v;
  };

  // Completed dangerous casts to settle for damage after the pass: who was eligible to kick them.
  interface CompletedCast { spellId: number; ms: number; eligible: PlayerState[] }
  const completed: CompletedCast[] = [];
  let dangerousCompleted = 0;
  let dangerousInterrupted = 0;

  for (let i = 0; i < store.count; i++) {
    const et = store.eventType[i]!;
    const ms = store.ts[i]!;
    const src = store.sourceGuid[i]!;

    // --- maintain per-player state (whole store, so pre-range history counts) ---
    const sp = players.get(src);
    if (sp) {
      if (et === castId || et === startId) sp.alive = true; // casting ⇒ alive (dot ticks don't resurrect)
      if (sp.interruptSpellId !== null && et === interruptId) {
        // Only an interrupt spent on a DANGEROUS cast marks this player legitimately "busy" and
        // excuses them from a later dangerous cast that goes off while it's recharging. Spending it
        // on a regular/trash cast (or whiffing) is NOT an excuse — a player who spams their interrupt
        // on unimportant casts and so never has it for important ones is still accountable. (The main
        // spell id on SPELL_INTERRUPT is the kick, not always the spec id, so gate on the priority of
        // the INTERRUPTED spell via extraSpellId, not on the main spell id.)
        const extra = store.detailNumber(i, 'extraSpellId');
        if (extra !== undefined && table.interruptPriority(extra) === 'dangerous') sp.lastUseMs = ms;
      }
    }
    if (et === diedId) {
      const dead = players.get(store.targetGuid[i]!);
      if (dead) dead.alive = false;
    }

    // --- damage index (dangerous interruptible spells landing on players) ---
    if (et === damageId || et === periodicId) {
      const tgt = store.targetGuid[i]!;
      if (store.isPlayer(tgt)) {
        const s = store.spellId[i]!;
        const amt = store.amount[i] ?? 0;
        if (amt > 0 && isDangerousInterruptible(s)) {
          (dmgBySpell.get(s) ?? dmgBySpell.set(s, []).get(s)!).push({ ms, amt });
        }
      }
    }

    // --- dangerous-cast accounting (in range only) ---
    const inRange = ms >= range.startMs && ms < range.endMs;
    if (!inRange) continue;

    if (et === interruptId) {
      const extra = store.detailNumber(i, 'extraSpellId');
      if (extra !== undefined && table.interruptPriority(extra) === 'dangerous') {
        dangerousInterrupted++;
        if (sp) sp.interrupted++; // a DPS landed the kick
      }
    } else if (et === castId) {
      // enemy completing an interruptible spell == a missed interrupt opportunity
      if (src !== 0 && !store.isPlayer(src)) {
        const s = store.spellId[i]!;
        if (isDangerousInterruptible(s)) {
          dangerousCompleted++;
          const eligible: PlayerState[] = [];
          for (const p of players.values()) {
            if (p.interruptSpellId === null || !p.alive) continue;
            if (ms - p.lastUseMs >= p.cdMs) {
              p.missed++;
              eligible.push(p);
            }
          }
          if (eligible.length) completed.push({ spellId: s, ms, eligible });
        }
      }
    }
  }

  // Settle "damage allowed" per completed cast against same-spell-id player damage in the window.
  for (const c of completed) {
    const series = dmgBySpell.get(c.spellId);
    if (!series) continue;
    const hi = c.ms + DAMAGE_WINDOW_MS;
    let sum = 0;
    for (let j = lowerBound(series, c.ms); j < series.length && series[j]!.ms <= hi; j++) sum += series[j]!.amt;
    if (sum > 0) for (const p of c.eligible) p.damageAllowed += sum;
  }

  const out: InterruptAccountabilityPlayer[] = [...players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    interruptSpellId: p.interruptSpellId,
    interruptName: p.interruptName,
    interrupted: p.interrupted,
    missed: p.missed,
    damageAllowed: Math.round(p.damageAllowed),
  }));

  return {
    players: out,
    dangerousCompleted,
    dangerousInterrupted,
    damageWindowMs: DAMAGE_WINDOW_MS,
    coverageNote: COVERAGE_NOTE,
  };
}

/** First index `j` with `arr[j].ms >= target` (arr is ms-sorted). */
function lowerBound(arr: { ms: number }[], target: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]!.ms < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export const interruptAccountability: Analytic<InterruptAccountabilityResult> = {
  id: 'interrupts.accountability',
  title: 'Interrupt Accountability',
  role: 'dps',
  columns: ['eventType', 'source', 'target', 'spell', 'side', 'ts', 'amount'],
  summary: false,
  run(ctx) {
    return computeInterruptAccountability(ctx.store, ctx.spellTable ?? SpellTable.empty(), msRangeOf(ctx));
  },
};
