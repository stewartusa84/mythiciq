// Spec icons (Wowhead/zamimg) + class colors, keyed by COMBATANT_INFO specId. The replay player card
// shows the spec icon and tints itself with the class color. specId → class/spec strings comes from
// the engine (`classSpecOf`); icon file names below are all HEAD-verified to exist on zamimg.
import { classSpecOf } from '@wow/engine';

const ZAMIMG = 'https://wow.zamimg.com/images/wow/icons/medium';

/** specId → zamimg spec-icon file name (verified to resolve). */
export const SPEC_ICON_NAME: Record<number, string> = {
  // Warrior
  71: 'ability_warrior_savageblow', 72: 'ability_warrior_innerrage', 73: 'ability_warrior_defensivestance',
  // Paladin
  65: 'spell_holy_holybolt', 66: 'ability_paladin_shieldofthetemplar', 70: 'spell_holy_auraoflight',
  // Hunter
  253: 'ability_hunter_bestialdiscipline', 254: 'ability_hunter_focusedaim', 255: 'ability_hunter_camouflage',
  // Rogue
  259: 'ability_rogue_deadlybrew', 260: 'inv_sword_30', 261: 'ability_stealth',
  // Priest
  256: 'spell_holy_powerwordshield', 257: 'spell_holy_guardianspirit', 258: 'spell_shadow_shadowwordpain',
  // Death Knight
  250: 'spell_deathknight_bloodpresence', 251: 'spell_deathknight_frostpresence', 252: 'spell_deathknight_unholypresence',
  // Shaman
  262: 'spell_nature_lightning', 263: 'spell_shaman_improvedstormstrike', 264: 'spell_nature_magicimmunity',
  // Mage
  62: 'spell_holy_magicalsentry', 63: 'spell_fire_firebolt02', 64: 'spell_frost_frostbolt02',
  // Warlock
  265: 'spell_shadow_deathcoil', 266: 'spell_shadow_metamorphosis', 267: 'spell_shadow_rainoffire',
  // Monk
  268: 'spell_monk_brewmaster_spec', 269: 'spell_monk_windwalker_spec', 270: 'spell_monk_mistweaver_spec',
  // Druid
  102: 'spell_nature_starfall', 103: 'ability_druid_catform', 104: 'ability_racial_bearform', 105: 'spell_nature_healingtouch',
  // Demon Hunter (1480 = Devourer, the Midnight third spec — void/consume themed)
  577: 'ability_demonhunter_specdps', 581: 'ability_demonhunter_spectank', 1480: 'ability_demonhunter_consumemagic',
  // Evoker
  1467: 'classicon_evoker_devastation', 1468: 'classicon_evoker_preservation', 1473: 'classicon_evoker_augmentation',
};

/** Standard WoW class colors, keyed by the engine's className strings. */
export const CLASS_COLOR: Record<string, string> = {
  'Death Knight': '#C41E3A',
  'Demon Hunter': '#A330C9',
  Druid: '#FF7C0A',
  Evoker: '#33937F',
  Hunter: '#AAD372',
  Mage: '#3FC7EB',
  Monk: '#00FF98',
  Paladin: '#F48CBA',
  Priest: '#FFFFFF',
  Rogue: '#FFF468',
  Shaman: '#0070DD',
  Warlock: '#8788EE',
  Warrior: '#C69B6D',
};

export function specIconUrl(specId: number | undefined): string | undefined {
  if (specId === undefined) return undefined;
  const n = SPEC_ICON_NAME[specId];
  return n ? `${ZAMIMG}/${n}.jpg` : undefined;
}
export function classNameOf(specId: number | undefined): string | undefined {
  return classSpecOf(specId)?.className;
}
export function specNameOf(specId: number | undefined): string | undefined {
  return classSpecOf(specId)?.specName;
}
export function classColorOf(specId: number | undefined): string | undefined {
  const cn = classNameOf(specId);
  return cn ? CLASS_COLOR[cn] : undefined;
}
