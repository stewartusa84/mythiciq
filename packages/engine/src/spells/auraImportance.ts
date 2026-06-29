import type { SpellTable } from './spellTable.js';

/**
 * Replay display hint: which BUFFS are worth a dedicated "important" lane vs. the muted "misc" lane.
 * This is purely cosmetic (it changes nothing in analytics), so it's a best-effort allowlist, not a
 * curated source of truth — extend it freely as logs surface buffs you want promoted out of misc.
 *
 * A buff is "important" if it is either:
 *   1. a curated DEFENSIVE (personal/tank/raid/external cooldown — already in the overlay), or
 *   2. listed in `NOTABLE_BUFF_IDS` below (lust family + core raid buffs + a few iconic burst CDs).
 * Everything else (skyriding stances, pet/guardian summons, profession/cosmetic auras, unremarkable
 * procs) falls to misc — visible for review but not taking up real estate.
 *
 * IDs are expansion-stable for the lust/raid-buff set; the burst-CD ids are best-effort. Add a spell
 * id here (or a curated defensive) to pull a buff into the important lane.
 */
export const NOTABLE_BUFF_IDS: ReadonlySet<number> = new Set<number>([
  // Bloodlust / Heroism family (haste raid CD)
  2825, // Bloodlust
  32182, // Heroism
  80353, // Time Warp
  264667, // Primal Rage
  390386, // Fury of the Aspects
  // Core raid buffs
  1459, // Arcane Intellect
  21562, // Power Word: Fortitude
  6673, // Battle Shout
  1126, // Mark of the Wild
  381748, // Blessing of the Bronze
  // Iconic burst cooldowns (buffs you want to see line up with damage)
  10060, // Power Infusion
  31884, // Avenging Wrath
  190319, // Combustion
  12472, // Icy Veins
  1719, // Recklessness
  107574, // Avatar
  51271, // Pillar of Frost
  162264, // Metamorphosis (Havoc)
  194223, // Celestial Alignment
  102560, // Incarnation: Chosen of Elune
  19574, // Bestial Wrath
]);

/** True when a buff should appear in the replay's important lane rather than misc. */
export function isImportantBuff(spellId: number, table?: SpellTable): boolean {
  if (NOTABLE_BUFF_IDS.has(spellId)) return true;
  return table ? table.defensive(spellId) !== undefined : false;
}
