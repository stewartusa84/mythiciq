// Affix id → display name. A small fallback so affixes read as names immediately (and still work if
// the Wowhead tooltip script is blocked/offline); Wowhead's renameLinks refines + iconizes on top.
// Sourced directly from packages/data/curation/affixes.json so contributors only edit one file.
import affixCuration from '@wow/data/curation/affixes';

export const AFFIX_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(affixCuration)
    .filter(([id, entry]) => /^\d+$/.test(id) && typeof entry === 'object' && typeof entry?.name === 'string')
    .map(([id, entry]) => [Number(id), entry!.name]),
) as Record<number, string>;

export function affixName(id: number): string | undefined {
  return AFFIX_NAMES[id];
}
