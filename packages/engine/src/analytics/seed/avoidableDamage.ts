import { DAMAGE_EVENT_NAMES } from '../../columns/schema.js';
import type { Analytic } from '../types.js';
import { SpellTable } from '../../spells/spellTable.js';
import { bump, effectiveRange, rankByName } from './helpers.js';

export interface AvoidableDamageResult {
  totalAvoidable: number;
  byUnit: { id: number; name: string; value: number }[];
  /** per spell, with a per-player breakdown of who took the damage (busiest first) */
  bySpell: { id: number; name: string; value: number; byUnit: { id: number; name: string; value: number }[] }[];
  /** how many spells the table currently flags avoidable (coverage) */
  knownAvoidableSpells: number;
  coverageNote: string;
}

/**
 * Avoidable damage = damage from a spellId the curated table flags `avoidable`, summed
 * per unit (and scoped per pull by the registry's range). TABLE ONLY — no heuristic
 * inference of avoidability. Accuracy is bounded by table coverage, which the output
 * states explicitly: this measures KNOWN avoidable mechanics, not ground truth.
 */
export function computeAvoidableDamage(
  store: Parameters<Analytic['run']>[0]['store'],
  table: SpellTable,
  range: { start: number; end: number },
): AvoidableDamageResult {
  const damageIds = store.eventTypeIds(DAMAGE_EVENT_NAMES);
  const byUnit = new Map<number, number>();
  const bySpell = new Map<number, number>();
  // per-spell → (unit → damage), so each mechanic can show who ate it
  const bySpellUnit = new Map<number, Map<number, number>>();
  let total = 0;

  for (let i = range.start; i < range.end; i++) {
    if (!damageIds.has(store.eventType[i]!)) continue;
    const spell = store.spellId[i]!;
    if (!table.isAvoidable(spell)) continue;
    const amt = store.amount[i]!;
    const target = store.targetGuid[i]!;
    total += amt;
    bump(byUnit, target, amt);
    bump(bySpell, spell, amt);
    let unitMap = bySpellUnit.get(spell);
    if (!unitMap) bySpellUnit.set(spell, (unitMap = new Map<number, number>()));
    bump(unitMap, target, amt);
  }

  return {
    totalAvoidable: total,
    byUnit: rankByName(byUnit, (id) => store.actorName(id) || `#${id}`),
    bySpell: rankByName(bySpell, (id) => store.spellName(id) || `spell:${id}`).map((s) => ({
      ...s,
      byUnit: rankByName(bySpellUnit.get(s.id) ?? new Map(), (id) => store.actorName(id) || `#${id}`),
    })),
    knownAvoidableSpells: table.avoidableSpellIds().size,
    coverageNote:
      'Counts only damage from spells flagged avoidable in our database (known avoidable mechanics), not ground truth. Accuracy is bounded by table coverage.',
  };
}

export const avoidableDamage: Analytic<AvoidableDamageResult> = {
  id: 'avoidableDamage',
  title: 'Avoidable Damage Taken',
  role: 'all',
  columns: ['eventType', 'target', 'spell', 'amount'],
  summary: false,
  run(ctx) {
    return computeAvoidableDamage(ctx.store, ctx.spellTable ?? SpellTable.empty(), effectiveRange(ctx));
  },
};
