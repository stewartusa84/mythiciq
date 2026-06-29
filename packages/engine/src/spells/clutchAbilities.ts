// Curated "clutch" external/utility abilities — casts that HELP AN ALLY survive, used to praise good
// plays regardless of the caster's role (the analog of the avoidable/interrupt accountability, but for
// the things players did RIGHT). Scored by the danger the protected ally was in (HP + damage weathered),
// not just by the cast happening — see analytics/seed/clutchPlays.ts.
//
// `detect` says where the play shows up in the log: 'aura' = a SPELL_AURA_APPLIED on the ally (most
// protective buffs), 'cast' = a SPELL_CAST_SUCCESS aimed at the ally (instant utility with no tracked
// buff, e.g. the grips and Lay on Hands). Extend packages/data/curation/clutch-abilities.json to credit
// more saves.

import clutchAbilitiesData from '@wow/data/curation/clutch-abilities';

export type ClutchKind = 'damage-reduction' | 'immunity' | 'death-prevent' | 'pull';

export interface ClutchAbility {
  name: string;
  kind: ClutchKind;
  detect: 'aura' | 'cast';
  class?: string;
}

const CLUTCH_KINDS: ReadonlySet<string> = new Set(['damage-reduction', 'immunity', 'death-prevent', 'pull']);
const DETECT_TYPES: ReadonlySet<string> = new Set(['aura', 'cast']);

function isClutchKind(value: string): value is ClutchKind {
  return CLUTCH_KINDS.has(value);
}

function isDetectType(value: string): value is ClutchAbility['detect'] {
  return DETECT_TYPES.has(value);
}

function buildClutchAbilities(): Record<number, ClutchAbility> {
  const out: Record<number, ClutchAbility> = {};
  for (const [id, ability] of Object.entries(clutchAbilitiesData.abilities ?? {})) {
    const spellId = Number(id);
    if (!Number.isInteger(spellId) || !ability) continue;
    if (!isClutchKind(ability.kind) || !isDetectType(ability.detect)) continue;
    const entry: ClutchAbility = {
      name: ability.name,
      kind: ability.kind,
      detect: ability.detect,
    };
    if (ability.class) entry.class = ability.class;
    out[spellId] = entry;
  }
  return out;
}

export const CLUTCH_ABILITIES: Record<number, ClutchAbility> = buildClutchAbilities();
