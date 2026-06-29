import { describe, it, expect } from 'vitest';
import { SpellTable, type RemovalData, type SpellFacts } from '../src/spells/spellTable.js';

// Mirrors the curation files: a category vocabulary, a couple of removers, and dungeon-grouped
// debuffs tagged with removableBy. Exercises the merge + the category-intersection removal model.
const REMOVAL: RemovalData = {
  categories: [
    { id: 'magic', label: 'Magic', kind: 'school', logSignature: 'dispel-event' },
    { id: 'curse', label: 'Curse', kind: 'school', logSignature: 'dispel-event' },
    { id: 'bleed', label: 'Bleed', kind: 'special', logSignature: 'inferred' },
    { id: 'snare', label: 'Snare', kind: 'mechanic', logSignature: 'inferred' },
    { id: 'root', label: 'Root', kind: 'mechanic', logSignature: 'inferred' },
  ],
  removers: {
    '527': { name: 'Purify', class: 'Priest', provides: ['magic', 'disease'], scope: 'external' },
    '1044': { name: 'Blessing of Freedom', class: 'Paladin', provides: ['snare', 'root'], scope: 'external' },
  },
  debuffs: {
    _meta: { notes: ['skip me'] } as never, // must not be parsed as a dungeon
    "Pit of Saron": {
      // Damage + slow: school-dispellable OR snare-removable. The Midnight pattern.
      '1258437': { name: 'Permeating Cold', priority: 'dangerous', removableBy: ['magic', 'snare'] },
      // Pure bleed: recorded, but no school -> no dispelPriority.
      '1216985': { name: 'Puncturing Bite', priority: 'dangerous', removableBy: ['bleed'] },
    },
    "Magisters' Terrace": {
      // Explicit overlay dispelPriority must still win.
      '9001': { name: 'Curated Regular', priority: 'dangerous', removableBy: ['magic'] },
    },
  },
};

const table = SpellTable.fromData(
  { spells: [] },
  { spells: { '9001': { dispelPriority: 'regular' } } },
  REMOVAL,
);

// DB2 facts: curation in REMOVAL omits removableBy/provides for these, so they must come from facts;
// where both exist they UNION (curation gap-fills what DB2 can't see).
const FACTS: SpellFacts = {
  facts: {
    // Debuff: DB2 supplies removableBy + name + duration; curation entry below has none.
    '7777': { name: 'DB2 Debuff', removableBy: ['magic', 'snare'], durationSeconds: 12, maxStacks: 3 },
    // Remover: DB2 supplies the schools; curation adds the bleed it can't see (union).
    '8888': { name: 'DB2 Cleanse', provides: ['magic', 'disease'] },
  },
};
const factsTable = SpellTable.fromData(
  { spells: [] },
  { spells: {} },
  {
    removers: { '8888': { class: 'Test', scope: 'external', provides: ['bleed'] } },
    debuffs: { "Test Dungeon": { '7777': { priority: 'dangerous' } } },
  },
  FACTS,
);

describe('SpellTable: removal model', () => {
  it('matches a remover to a debuff by category intersection', () => {
    // Freedom (snare/root) clears the damage+slow aura even though it is not a Magic dispel.
    expect(table.canRemove(1044, 1258437)).toBe(true);
    // Purify (magic) also clears it (the magic tag).
    expect(table.canRemove(527, 1258437)).toBe(true);
    // Neither remover can touch a pure bleed.
    expect(table.canRemove(1044, 1216985)).toBe(false);
    expect(table.canRemove(527, 1216985)).toBe(false);
  });

  it('lists all removers that can clear a debuff', () => {
    expect(table.removersForDebuff(1258437).sort((a, b) => a - b)).toEqual([527, 1044]);
    expect(table.removersForDebuff(1216985)).toEqual([]);
  });

  it('exposes the removal-category vocabulary and remover metadata', () => {
    expect(table.removalCategory('snare')?.kind).toBe('mechanic');
    expect(table.removalCategory('magic')?.logSignature).toBe('dispel-event');
    expect(table.remover(1044)?.name).toBe('Blessing of Freedom');
    expect(table.isRemover(1044)).toBe(true);
  });
});

describe('SpellTable: debuff merge + back-compat dispel fields', () => {
  it('derives dispelPriority dangerous for school-dispellable debuffs', () => {
    expect(table.dispelPriority(1258437)).toBe('dangerous');
    expect(table.get(1258437)?.dispelType).toBe('magic'); // first school category, backfilled
    expect(table.isDangerousDebuff(1258437)).toBe(true);
    expect(table.removableCategoriesOf(1258437)).toEqual(['magic', 'snare']);
  });

  it('records mechanic/special-only debuffs WITHOUT a dispelPriority (no analytic pollution)', () => {
    expect(table.isDangerousDebuff(1216985)).toBe(true);
    expect(table.dispelPriority(1216985)).toBeNull();
    expect(table.get(1216985)?.dispelType).toBeNull();
    expect(table.removableCategoriesOf(1216985)).toEqual(['bleed']);
  });

  it('lets an explicit overlay dispelPriority win over the derived value', () => {
    expect(table.dispelPriority(9001)).toBe('regular');
  });

  it('tags debuffs with their dungeon group and keeps the entry', () => {
    expect(table.get(1258437)?.dungeon).toBe('Pit of Saron');
    expect(table.debuff(1258437)).toMatchObject({ name: 'Permeating Cold' });
  });

  it('does not parse the _meta block as a dungeon', () => {
    expect(table.size).toBe(3); // 1258437, 1216985, 9001 — nothing from _meta
  });
});

describe('SpellTable: DB2 facts merge', () => {
  it('pulls removableBy/name/duration/stacks from facts when curation omits them', () => {
    expect(factsTable.removableCategoriesOf(7777)).toEqual(['magic', 'snare']);
    expect(factsTable.dispelPriority(7777)).toBe('dangerous'); // derived from the magic school in facts
    const info = factsTable.get(7777)!;
    expect(info.name).toBe('DB2 Debuff');
    expect(info.durationSeconds).toBe(12);
    expect(info.maxStacks).toBe(3);
  });

  it('unions remover provides from facts and curation (curation gap-fills DB2)', () => {
    expect([...factsTable.remover(8888)!.providesSet].sort()).toEqual(['bleed', 'disease', 'magic']);
    expect(factsTable.remover(8888)!.name).toBe('DB2 Cleanse'); // name falls back to the fact
  });

  it('routes a debuff to all removers across the unioned category index', () => {
    // 8888 provides magic (DB2) ∪ bleed (curation); debuff 7777 is removableBy magic -> matched.
    expect(factsTable.canRemove(8888, 7777)).toBe(true);
  });
});
