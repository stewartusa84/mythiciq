// Static specialization-id -> { className, specName } map. COMBATANT_INFO carries a numeric
// specId per player per pull; this resolves it to the class/spec strings used by the defensive
// curation (overlay `defensive.class`/`spec`), so the death-recap analytic can list the FULL
// defensive kit a player had — not just what they happened to cast. Spec ids are stable across
// expansions. `className` values intentionally match the curation exactly ("Death Knight", etc.).

export interface ClassSpec {
  className: string;
  specName: string;
}

export const SPEC_IDS: Record<number, ClassSpec> = {
  // Warrior
  71: { className: 'Warrior', specName: 'Arms' },
  72: { className: 'Warrior', specName: 'Fury' },
  73: { className: 'Warrior', specName: 'Protection' },
  // Paladin
  65: { className: 'Paladin', specName: 'Holy' },
  66: { className: 'Paladin', specName: 'Protection' },
  70: { className: 'Paladin', specName: 'Retribution' },
  // Hunter
  253: { className: 'Hunter', specName: 'Beast Mastery' },
  254: { className: 'Hunter', specName: 'Marksmanship' },
  255: { className: 'Hunter', specName: 'Survival' },
  // Rogue
  259: { className: 'Rogue', specName: 'Assassination' },
  260: { className: 'Rogue', specName: 'Outlaw' },
  261: { className: 'Rogue', specName: 'Subtlety' },
  // Priest
  256: { className: 'Priest', specName: 'Discipline' },
  257: { className: 'Priest', specName: 'Holy' },
  258: { className: 'Priest', specName: 'Shadow' },
  // Death Knight
  250: { className: 'Death Knight', specName: 'Blood' },
  251: { className: 'Death Knight', specName: 'Frost' },
  252: { className: 'Death Knight', specName: 'Unholy' },
  // Shaman
  262: { className: 'Shaman', specName: 'Elemental' },
  263: { className: 'Shaman', specName: 'Enhancement' },
  264: { className: 'Shaman', specName: 'Restoration' },
  // Mage
  62: { className: 'Mage', specName: 'Arcane' },
  63: { className: 'Mage', specName: 'Fire' },
  64: { className: 'Mage', specName: 'Frost' },
  // Warlock
  265: { className: 'Warlock', specName: 'Affliction' },
  266: { className: 'Warlock', specName: 'Demonology' },
  267: { className: 'Warlock', specName: 'Destruction' },
  // Monk
  268: { className: 'Monk', specName: 'Brewmaster' },
  269: { className: 'Monk', specName: 'Windwalker' },
  270: { className: 'Monk', specName: 'Mistweaver' },
  // Druid
  102: { className: 'Druid', specName: 'Balance' },
  103: { className: 'Druid', specName: 'Feral' },
  104: { className: 'Druid', specName: 'Guardian' },
  105: { className: 'Druid', specName: 'Restoration' },
  // Demon Hunter (Havoc/Vengeance keep their live ids in Midnight logs — VERIFIED from a 6/2026
  // log: the Havoc DH reports 577, NOT a renumbered id). Devourer is the Midnight third spec; its
  // real specId is 1480 (VERIFIED from COMBATANT_INFO — the player cast Devour/Consume/Void Ray/
  // Voidblade/Collapsing Star). An earlier speculative 512/513 mapping was wrong and is removed.
  577: { className: 'Demon Hunter', specName: 'Havoc' },
  581: { className: 'Demon Hunter', specName: 'Vengeance' },
  1480: { className: 'Demon Hunter', specName: 'Devourer' },
  // Evoker
  1467: { className: 'Evoker', specName: 'Devastation' },
  1468: { className: 'Evoker', specName: 'Preservation' },
  1473: { className: 'Evoker', specName: 'Augmentation' },
};

export function classSpecOf(specId: number | undefined): ClassSpec | undefined {
  return specId === undefined ? undefined : SPEC_IDS[specId];
}

/** Group role of a player spec — for ordering/role icons (tank → healer → dps). */
export type PlayerRole = 'tank' | 'healer' | 'dps';

const TANK_SPECS = new Set([73, 66, 250, 268, 104, 581]); // ProtWar, ProtPal, BloodDK, Brewmaster, Guardian, Vengeance
const HEALER_SPECS = new Set([65, 256, 257, 264, 270, 105, 1468]); // HolyPal, Disc, HolyPriest, RestoSham, Mistweaver, RestoDruid, Preservation

/** Role for a specId, or undefined when the spec is unknown (no COMBATANT_INFO). Everything that is
 *  neither a known tank nor healer spec is dps. */
export function roleOf(specId: number | undefined): PlayerRole | undefined {
  if (specId === undefined || SPEC_IDS[specId] === undefined) return undefined;
  if (TANK_SPECS.has(specId)) return 'tank';
  if (HEALER_SPECS.has(specId)) return 'healer';
  return 'dps';
}
