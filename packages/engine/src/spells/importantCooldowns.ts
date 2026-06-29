import { classSpecOf, roleOf } from './specIds.js';

export type CooldownKind = 'interrupt' | 'raid' | 'external' | 'dispel';

export interface CooldownDef {
  name: string;
  cooldownSeconds: number;
  kind: CooldownKind;
}

/**
 * Important cooldowns surfaced on the replay player cards — every class interrupt plus a few major
 * raid/external CDs (Bloodlust family, Lay on Hands). The use case: while an enemy is casting an
 * interruptible spell you can glance at the cards and see WHO has their kick available.
 *
 * Cooldown seconds are BASE values; talents/haste can shorten some in game, so the availability
 * shown is approximate (a replay aid, not a guarantee). Keyed by the cast spell id.
 */
export const IMPORTANT_COOLDOWNS: Record<number, CooldownDef> = {
  // ---- interrupts (one per class; spec-specific where they differ) ----
  6552: { name: 'Pummel', cooldownSeconds: 15, kind: 'interrupt' }, // Warrior
  96231: { name: 'Rebuke', cooldownSeconds: 15, kind: 'interrupt' }, // Paladin
  147362: { name: 'Counter Shot', cooldownSeconds: 24, kind: 'interrupt' }, // Hunter (BM/MM)
  187707: { name: 'Muzzle', cooldownSeconds: 15, kind: 'interrupt' }, // Hunter (Survival)
  1766: { name: 'Kick', cooldownSeconds: 15, kind: 'interrupt' }, // Rogue
  15487: { name: 'Silence', cooldownSeconds: 45, kind: 'interrupt' }, // Priest (Shadow)
  47528: { name: 'Mind Freeze', cooldownSeconds: 15, kind: 'interrupt' }, // Death Knight
  57994: { name: 'Wind Shear', cooldownSeconds: 12, kind: 'interrupt' }, // Shaman
  2139: { name: 'Counterspell', cooldownSeconds: 24, kind: 'interrupt' }, // Mage
  19647: { name: 'Spell Lock', cooldownSeconds: 24, kind: 'interrupt' }, // Warlock (Felhunter)
  116705: { name: 'Spear Hand Strike', cooldownSeconds: 15, kind: 'interrupt' }, // Monk
  106839: { name: 'Skull Bash', cooldownSeconds: 15, kind: 'interrupt' }, // Druid (Feral/Guardian/Resto)
  78675: { name: 'Solar Beam', cooldownSeconds: 60, kind: 'interrupt' }, // Druid (Balance)
  183752: { name: 'Disrupt', cooldownSeconds: 15, kind: 'interrupt' }, // Demon Hunter
  351338: { name: 'Quell', cooldownSeconds: 40, kind: 'interrupt' }, // Evoker
  // ---- raid / external majors ----
  2825: { name: 'Bloodlust', cooldownSeconds: 300, kind: 'raid' },
  32182: { name: 'Heroism', cooldownSeconds: 300, kind: 'raid' },
  80353: { name: 'Time Warp', cooldownSeconds: 300, kind: 'raid' },
  390386: { name: 'Fury of the Aspects', cooldownSeconds: 300, kind: 'raid' },
  264667: { name: 'Primal Rage', cooldownSeconds: 300, kind: 'raid' },
  633: { name: 'Lay on Hands', cooldownSeconds: 600, kind: 'external' },
  1044: { name: 'Blessing of Freedom', cooldownSeconds: 25, kind: 'external' }, // any Paladin
  586: { name: 'Fade', cooldownSeconds: 30, kind: 'external' }, // any Priest
  // ---- healer dispels (the "interrupt" of a healer — glows when the team has a dispellable debuff) ----
  4987: { name: 'Cleanse', cooldownSeconds: 8, kind: 'dispel' }, // Holy Paladin
  527: { name: 'Purify', cooldownSeconds: 8, kind: 'dispel' }, // Discipline/Holy Priest
  115450: { name: 'Detox', cooldownSeconds: 8, kind: 'dispel' }, // Mistweaver
  77130: { name: 'Purify Spirit', cooldownSeconds: 8, kind: 'dispel' }, // Restoration Shaman
  88423: { name: "Nature's Cure", cooldownSeconds: 8, kind: 'dispel' }, // Restoration Druid
  360823: { name: 'Naturalize', cooldownSeconds: 8, kind: 'dispel' }, // Preservation Evoker
  // ---- healer spec majors (baseline — shown from run start) ----
  31821: { name: 'Aura Mastery', cooldownSeconds: 180, kind: 'raid' }, // Holy Paladin
  421453: { name: 'Ultimate Penitence', cooldownSeconds: 240, kind: 'raid' }, // Discipline Priest
  73325: { name: 'Leap of Faith', cooldownSeconds: 90, kind: 'external' }, // Priest (Disc/Holy)
  116841: { name: "Tiger's Lust", cooldownSeconds: 30, kind: 'external' }, // Mistweaver
  119381: { name: 'Leg Sweep', cooldownSeconds: 60, kind: 'raid' }, // Mistweaver (AoE stun)
  115310: { name: 'Revival', cooldownSeconds: 180, kind: 'raid' }, // Mistweaver
  // ---- talent-gated (shown only AFTER first cast — we can't know from spec if they're talented) ----
  443028: { name: 'Celestial Conduit', cooldownSeconds: 90, kind: 'raid' }, // Mistweaver (talent)
  325197: { name: 'Invoke Chi-Ji, the Red Crane', cooldownSeconds: 120, kind: 'raid' }, // Mistweaver (talent)
};

/** A cooldown a player is KNOWN to have from their spec (so it shows from run start, available).
 *  `castIds` are the spell ids whose casts put it on cooldown — usually `[spellId]`, but the lust
 *  family has faction variants (Bloodlust ⇆ Heroism) that must all count. */
export interface PlayerCooldown {
  spellId: number; // canonical display id
  name: string;
  cooldownSeconds: number;
  kind: CooldownKind;
  castIds: number[];
  /** For `kind:'dispel'` — the removal categories this dispel can clear (magic/curse/poison/disease),
   *  matched against an active debuff's `removableBy` to glow the chip when a dispel is NEEDED. */
  provides?: string[];
}

function major(spellId: number, castIds: number[]): PlayerCooldown {
  const d = IMPORTANT_COOLDOWNS[spellId]!;
  return { spellId, name: d.name, cooldownSeconds: d.cooldownSeconds, kind: d.kind, castIds };
}

/** A healer's friendly dispel, tagged with the categories it removes (its "interrupt" — see the glow). */
function dispel(spellId: number, provides: string[]): PlayerCooldown {
  const d = IMPORTANT_COOLDOWNS[spellId]!;
  return { spellId, name: d.name, cooldownSeconds: d.cooldownSeconds, kind: d.kind, castIds: [spellId], provides };
}

/**
 * The important cooldowns a spec is KNOWN to bring, so the card shows them (available) from run
 * start rather than waiting for the first cast: the spec's interrupt + the class's raid/external
 * major (Lay on Hands, the lust family). Availability is then tracked from the player's cast times.
 */
export function cooldownsForSpec(specId: number | undefined): PlayerCooldown[] {
  const cs = classSpecOf(specId);
  if (!cs) return [];
  const out: PlayerCooldown[] = [];
  const intId = interruptForSpec(specId);
  if (intId !== undefined) out.push(major(intId, [intId]));
  switch (cs.className) {
    case 'Paladin':
      out.push(major(633, [633])); // Lay on Hands
      out.push(major(1044, [1044])); // Blessing of Freedom (any paladin)
      break;
    case 'Priest': out.push(major(586, [586])); break; // Fade (any priest)
    case 'Shaman': out.push(major(2825, [2825, 32182])); break; // Bloodlust / Heroism
    case 'Mage': out.push(major(80353, [80353])); break; // Time Warp
    case 'Hunter': out.push(major(264667, [264667])); break; // Primal Rage (pet)
    case 'Evoker': out.push(major(390386, [390386])); break; // Fury of the Aspects
  }
  // Spec-specific baseline majors + each healer's friendly DISPEL (its categories drive the glow when
  // the team has a matching dispellable debuff up — the healer analog of an interrupt).
  switch (specId) {
    case 65: // Holy Paladin
      out.push(major(31821, [31821])); // Aura Mastery
      out.push(dispel(4987, ['magic', 'poison', 'disease'])); // Cleanse
      break;
    case 256: // Discipline Priest
      out.push(major(421453, [421453])); // Ultimate Penitence
      out.push(major(73325, [73325])); // Leap of Faith
      out.push(dispel(527, ['magic', 'disease'])); // Purify
      break;
    case 257: // Holy Priest
      out.push(major(73325, [73325])); // Leap of Faith
      out.push(dispel(527, ['magic', 'disease'])); // Purify
      break;
    case 270: // Mistweaver
      out.push(major(116841, [116841])); // Tiger's Lust
      out.push(major(119381, [119381])); // Leg Sweep
      out.push(major(115310, [115310])); // Revival
      out.push(dispel(115450, ['magic', 'poison', 'disease'])); // Detox
      break;
    case 264: out.push(dispel(77130, ['magic', 'curse'])); break; // Resto Shaman → Purify Spirit
    case 105: out.push(dispel(88423, ['magic', 'curse', 'poison'])); break; // Resto Druid → Nature's Cure
    case 1468: out.push(dispel(360823, ['magic', 'poison'])); break; // Preservation → Naturalize
  }
  return out;
}

/**
 * Talent-GATED cooldowns: ones a spec can bring only if the player picked the talent. We can't know
 * from the specId whether they have these, so — unlike `cooldownsForSpec` — they appear ONLY after
 * the first observed cast. `castIds` still drive availability once visible.
 */
export function talentCooldownsForSpec(specId: number | undefined): PlayerCooldown[] {
  switch (specId) {
    case 270: // Mistweaver
      return [major(443028, [443028]), major(325197, [325197])]; // Celestial Conduit, Invoke Chi-Ji
    default:
      return [];
  }
}

/**
 * The interrupt a spec brings, so it shows on the card even BEFORE the player first uses it (we
 * can't infer non-interrupt CDs from spec, so those only appear once cast). undefined = no interrupt.
 *
 * NO healer spec has a real interrupt (Midnight): healers are filtered first, so the per-spec nuance
 * below only covers tank/dps specs (Survival → Muzzle, Balance → Solar Beam). "Stop" effects
 * (stuns/disorients) are NOT interrupts and aren't listed here yet.
 */
export function interruptForSpec(specId: number | undefined): number | undefined {
  const cs = classSpecOf(specId);
  if (!cs || roleOf(specId) === 'healer') return undefined;
  switch (cs.className) {
    case 'Warrior': return 6552;
    case 'Paladin': return 96231; // Prot / Ret
    case 'Hunter': return specId === 255 ? 187707 : 147362; // Survival = Muzzle
    case 'Rogue': return 1766;
    case 'Priest': return 15487; // Shadow (Disc/Holy filtered as healers)
    case 'Death Knight': return 47528;
    case 'Shaman': return 57994; // Elemental / Enhancement
    case 'Mage': return 2139;
    case 'Warlock': return 19647;
    case 'Monk': return 116705; // Brewmaster / Windwalker (Mistweaver filtered)
    case 'Druid': return specId === 102 ? 78675 : 106839; // Balance Solar Beam; Feral/Guardian Skull Bash
    case 'Demon Hunter': return 183752;
    case 'Evoker': return 351338; // Devastation / Augmentation (Preservation filtered)
    default: return undefined;
  }
}
