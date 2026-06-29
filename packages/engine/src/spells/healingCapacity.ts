// Which of a healer's casts count toward "healing capacity used" (the pressure metric). See
// `analytics/primitives/replayModel.ts` capacity baking.
//
// Most heals are auto-detected FROM THE LOG (any spell the player produced effective healing with —
// direct heals + HoTs all fire SPELL_HEAL/SPELL_PERIODIC_HEAL), so they need no curation here. This
// file only carries the two things the log can't tell us:
//   1. specs whose DAMAGE is healing (Discipline atonement, Mistweaver fistweaving) → count EVERY cast.
//   2. a small curated supplement of healing that logs NO SPELL_HEAL (absorbs) → count those cast ids.

import { roleOf } from './specIds.js';

/** 'all'  → every cast counts (damage IS healing: Disc atonement, MW fistweaving).
 *  'heal' → only casts that are healing spells (log-derived heal set ∪ EXTRA below). */
export type CapacityMode = 'all' | 'heal';

export const SPEC_CAPACITY_MODE: Record<number, CapacityMode> = {
  256: 'all', // Discipline Priest — damage → atonement healing
  270: 'all', // Mistweaver Monk — fistweaving
  65: 'heal', // Holy Paladin
  257: 'heal', // Holy Priest
  105: 'heal', // Restoration Druid
  264: 'heal', // Restoration Shaman
  1468: 'heal', // Preservation Evoker
};

/** Healing contributions that fire NO SPELL_HEAL (absorbs etc.), so they aren't auto-detected from the
 *  log and must be listed to count toward capacity. Keyed by specId. Extend as needed — direct/HoT
 *  heals do NOT belong here (they're picked up automatically). */
export const HEALING_CAPACITY_EXTRA: Record<number, number[]> = {
  257: [17], // Holy Priest — Power Word: Shield (absorb)
  1468: [373861], // Preservation Evoker — Temporal Anomaly (absorb)
};

/** The capacity mode for a spec, or undefined if it isn't a (supported) healer. */
export function capacityModeForSpec(specId: number | undefined): CapacityMode | undefined {
  if (specId === undefined) return undefined;
  if (roleOf(specId) !== 'healer') return undefined;
  return SPEC_CAPACITY_MODE[specId] ?? 'heal'; // default healers to heal-classified
}
