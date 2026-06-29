// Presentation decoders for the raw unit-flag / raid-flag / spell-school integers
// stored in the columns. Mirrors the verbatim decoders in the original lib.rs (these
// are display-only, so they live on the TS side rather than in the hot parse path).

export interface UnitFlags {
  raw: number;
  hex: string;
  affiliation?: 'mine' | 'party' | 'raid' | 'outsider';
  reaction?: 'friendly' | 'neutral' | 'hostile';
  control?: 'player' | 'npc';
  unitType?: 'player' | 'npc' | 'pet' | 'guardian' | 'object';
}

export function decodeUnitFlags(raw: number | null): UnitFlags | null {
  if (raw === null) return null;
  const out: UnitFlags = { raw, hex: '0x' + (raw >>> 0).toString(16) };
  switch (raw & 0x00f) {
    case 0x1: out.affiliation = 'mine'; break;
    case 0x2: out.affiliation = 'party'; break;
    case 0x4: out.affiliation = 'raid'; break;
    case 0x8: out.affiliation = 'outsider'; break;
  }
  switch (raw & 0x0f0) {
    case 0x10: out.reaction = 'friendly'; break;
    case 0x20: out.reaction = 'neutral'; break;
    case 0x40: out.reaction = 'hostile'; break;
  }
  switch (raw & 0x300) {
    case 0x100: out.control = 'player'; break;
    case 0x200: out.control = 'npc'; break;
  }
  switch (raw & 0xfc00) {
    case 0x400: out.unitType = 'player'; break;
    case 0x800: out.unitType = 'npc'; break;
    case 0x1000: out.unitType = 'pet'; break;
    case 0x2000: out.unitType = 'guardian'; break;
    case 0x4000: out.unitType = 'object'; break;
  }
  return out;
}

const RAID_MARKERS: [number, string][] = [
  [0x80, 'skull'], [0x40, 'cross'], [0x20, 'square'], [0x10, 'triangle'],
  [0x08, 'moon'], [0x04, 'diamond'], [0x02, 'circle'], [0x01, 'star'],
];

export function decodeRaidMarkers(raw: number | null): string[] {
  if (raw === null) return [];
  return RAID_MARKERS.filter(([bit]) => (raw & bit) !== 0).map(([, name]) => name);
}

const SCHOOLS: [number, string][] = [
  [0x1, 'physical'], [0x2, 'holy'], [0x4, 'fire'], [0x8, 'nature'],
  [0x10, 'frost'], [0x20, 'shadow'], [0x40, 'arcane'],
];

export function decodeSpellSchools(raw: number | null): string[] {
  if (raw === null) return [];
  return SCHOOLS.filter(([bit]) => (raw & bit) !== 0).map(([, name]) => name);
}
