// Unified curated spell table (#7) — the single data backbone for avoidable-damage (#8),
// interrupt/dispel priority (#6), tank active-mitigation (#5), and the removal model (which
// remover spells clear which debuff categories). Built by merging four curation inputs:
//   1. generated MDT seed (interruptible/dispelType/npc/dungeon) — the seed, NOT ground truth
//   2. overlay.json (avoidable, priorities, activeMitigation, defensives; may add ids)
//   3. removal-categories.json + removers.json (the category vocabulary + player removers)
//   4. debuffs/*.json (dangerous player-debuffs tagged with removableBy categories)
// Removal is matched by category-set intersection (remover.provides ∩ debuff.removableBy),
// never a hand-kept debuff↔remover edge list.

export type Priority = 'dangerous' | 'regular' | null;

// Player defensive cooldowns (personal/external/raid mitigation). These are PLAYER spells,
// not in the MDT enemy seed, so they are introduced purely via the overlay. Curated ahead of
// a defensive-usage analytic; metadata (cd/duration) lets that analytic judge uptime/efficiency.
// 'personal' (self), 'external' (cast on one ally), 'raid' (whole group),
// 'tank' (tank mitigation cooldown, e.g. Stagger purge), 'aura' (passive/triggered
// mitigation buff tracked for uptime rather than an active cast).
export type DefensiveType = 'personal' | 'external' | 'raid' | 'tank' | 'aura';

export interface DefensiveInfo {
  /** Display name of the spell, e.g. "Aura Mastery". */
  name: string;
  /** Class that owns it, e.g. "Paladin". */
  class?: string;
  /** Spec that owns it, e.g. "Holy". */
  spec?: string;
  /** Who it protects: 'personal' (self), 'external' (single ally), 'raid' (group). */
  type: DefensiveType;
  /** Cooldown in seconds (3 min -> 180). */
  cooldownSeconds?: number;
  /** Active buff duration in seconds. */
  durationSeconds?: number;
  /** Free-form description, e.g. "Group mitigation amplifier". */
  description?: string;
}

export interface SeedSpell {
  spellId: number;
  npcId?: number;
  npcName?: string;
  npcIds?: number[];
  dungeon?: string;
  dungeons?: string[];
  isBoss?: boolean;
  interruptible?: boolean;
  dispelType?: string | null;
}

export interface SpellSeed {
  spells: SeedSpell[];
  dungeons?: string[];
  counts?: Record<string, number>;
}

export interface OverlayEntry {
  avoidable?: boolean;
  interruptPriority?: Priority;
  dispelPriority?: Priority;
  activeMitigation?: boolean;
  /** Player defensive cooldown metadata (see DefensiveInfo). Overlay-only concept. */
  defensive?: DefensiveInfo;
  notes?: string;
}

export interface SpellOverlay {
  spells: Record<string, OverlayEntry>;
}

// ---------------------------------------------------------------------------
// Removal model (debuffs ⇆ removers, matched through a shared category vocabulary).
//
// A debuff declares the categories that can clear it (`removableBy`); a remover declares
// the categories it provides. Removal eligibility is a set intersection — NOT a hand-kept
// debuff↔remover edge list — so curation stays linear (tag each spell once). This captures
// the Midnight pattern where one aura is e.g. damage+slow and a snare purge clears the whole
// thing: that debuff is `removableBy: ["magic","snare"]`, and Blessing of Freedom (provides
// ["snare","root"]) intersects it even though it is not a Magic dispel.
//
// A category is a free string controlled by categories.json; its metadata records HOW it
// shows up in the log (a school dispel emits SPELL_DISPEL; snare/bleed/CC removals don't —
// they just shorten the debuff and must be inferred from a remover cast near an early
// SPELL_AURA_REMOVED). See RemovalLogSignature.
// ---------------------------------------------------------------------------
export type RemovalCategory = string;
export type RemovalKind = 'school' | 'mechanic' | 'special' | 'enrage';
/** How a removal of this category appears in the combat log. */
export type RemovalLogSignature = 'dispel-event' | 'inferred' | 'heal-through';

export interface RemovalCategoryDef {
  /** Category id used in removableBy/provides, e.g. 'magic', 'snare', 'bleed'. */
  id: RemovalCategory;
  label: string;
  kind: RemovalKind;
  /** True when removed from an ENEMY (e.g. enrage soothe), not a friendly debuff. */
  hostile?: boolean;
  logSignature: RemovalLogSignature;
  notes?: string;
}

export type RemoverScope = 'self' | 'external' | 'party' | 'raid' | 'offensive';

/** A player buff/cast that removes debuffs in one or more categories. */
export interface RemoverEntry {
  /** Optional in curation — falls back to the DB2 fact name. */
  name?: string;
  class?: string;
  spec?: string;
  /** Categories this spell can clear. UNIONED with DB2-derived provides; curation lists only gaps. */
  provides?: RemovalCategory[];
  scope?: RemoverScope;
  notes?: string;
}

/** A curated dangerous player-debuff, keyed by the APPLIED player-aura spell id. */
export interface DebuffEntry {
  name?: string;
  caster?: string;
  boss?: boolean;
  dungeon?: string;
  /** Curated danger level; 'dangerous' is the only level shipped today. */
  priority?: 'dangerous' | string;
  /** Categories any one of which removes this aura (= the matchable set). */
  removableBy?: RemovalCategory[];
  durationSeconds?: number;
  /** Track removal timing (heal-through / cleanse-latency analytics). */
  trackRemovalTiming?: boolean;
  notes?: string;
}

/** Debuffs grouped by dungeon: { "<dungeon>": { "<spellId>": DebuffEntry } }. */
export type DebuffsByDungeon = Record<string, Record<string, DebuffEntry>>;

/** The three removal-model curation inputs, merged on top of seed+overlay. */
export interface RemovalData {
  categories?: RemovalCategoryDef[];
  removers?: Record<string, RemoverEntry>;
  debuffs?: DebuffsByDungeon;
}

/** A remover resolved against the table (provides kept as a Set for fast intersection). */
export interface ResolvedRemover extends RemoverEntry {
  spellId: number;
  providesSet: ReadonlySet<RemovalCategory>;
}

// DB2-derived mechanical facts (generated/spell-facts.json by scripts/import-db2.mjs). This is the
// GENERATED layer merged UNDER curation: removableBy/provides/name/duration/stacks come from the
// game's own DispelType/Mechanic/SpellEffect data. Curation carries only judgment + DB2 gaps, and
// is UNIONED with these facts (curation can add a tag DB2 cannot see — e.g. a bleed-cleanse remover).
export interface SpellFact {
  name?: string;
  removableBy?: RemovalCategory[];
  provides?: RemovalCategory[];
  durationSeconds?: number;
  maxStacks?: number;
}
export interface SpellFacts {
  facts?: Record<string, SpellFact>;
}

function unionCats(a: readonly RemovalCategory[] | undefined, b: readonly RemovalCategory[] | undefined): RemovalCategory[] {
  const s = new Set(a ?? []);
  for (const x of b ?? []) s.add(x);
  return [...s];
}

export interface SpellInfo {
  spellId: number;
  npcId?: number;
  npcIds: number[];
  dungeon?: string;
  isBoss: boolean;
  interruptible: boolean;
  dispelType: string | null;
  avoidable: boolean;
  interruptPriority: Priority;
  dispelPriority: Priority;
  activeMitigation: boolean;
  defensive?: DefensiveInfo;
  notes?: string;
  /** Curated dangerous-debuff metadata, present only for ids in the debuffs file. */
  debuff?: DebuffEntry;
  /** Categories that can clear this aura (DB2 facts ∪ curation). */
  removableBy?: RemovalCategory[];
  /** DB2-derived display name (any spell with a fact). */
  name?: string;
  /** DB2-derived base aura duration in seconds. */
  durationSeconds?: number;
  /** DB2-derived max stacks (CumulativeAura), when > 0. */
  maxStacks?: number;
}

export class SpellTable {
  // Fallback dispel schools (used when categories.json is absent). A school category is one a
  // standard healer/party dispel removes — it emits SPELL_DISPEL. Mechanic/special categories
  // (snare, root, bleed, healing-absorb) are inferred instead and never get a dispelPriority.
  private static readonly DEFAULT_SCHOOLS = new Set(['magic', 'curse', 'disease', 'poison', 'enrage']);

  private readonly byId = new Map<number, SpellInfo>();
  private readonly activeMitigationIds = new Set<number>();
  private readonly avoidableIds = new Set<number>();
  private readonly defensiveIds = new Set<number>();
  private readonly dangerousDebuffIds = new Set<number>();

  // Removal model.
  private readonly categories = new Map<RemovalCategory, RemovalCategoryDef>();
  private readonly removers = new Map<number, ResolvedRemover>();
  private readonly removersByCategory = new Map<RemovalCategory, number[]>();

  static empty(): SpellTable {
    return new SpellTable();
  }

  static fromData(seed: SpellSeed, overlay: SpellOverlay, removal?: RemovalData, facts?: SpellFacts): SpellTable {
    const table = new SpellTable();
    const overlaySpells = overlay.spells ?? {};
    const factsMap = facts?.facts ?? {};

    for (const s of seed.spells) {
      table.set(s, overlaySpells[String(s.spellId)]);
    }
    // Overlay-only spell ids (not in the MDT enemy seed) — e.g. active-mitigation buffs.
    for (const key of Object.keys(overlaySpells)) {
      const id = Number(key);
      if (!table.byId.has(id)) table.set({ spellId: id }, overlaySpells[key]);
    }
    // Removal model: vocabulary first (debuff merge consults it to classify schools), then
    // removers (build the category→remover index), then debuffs (applied-aura ids, mostly
    // absent from the MDT enemy seed; merged last so they can introduce ids + derive a
    // 'dangerous' dispelPriority — an EXPLICIT overlay dispelPriority still wins). DB2 facts are
    // UNIONED into removableBy/provides; curation carries only judgment + gaps DB2 can't see.
    for (const c of removal?.categories ?? []) table.categories.set(c.id, c);
    for (const [key, r] of Object.entries(removal?.removers ?? {})) {
      if (key.startsWith('_')) continue; // skip _meta
      table.addRemover(Number(key), r, factsMap[key]);
    }
    for (const [dungeon, byId] of Object.entries(removal?.debuffs ?? {})) {
      if (dungeon.startsWith('_')) continue; // skip _meta; remaining keys are dungeon names
      for (const [key, entry] of Object.entries(byId)) {
        table.applyDebuff(Number(key), entry, dungeon, overlaySpells[key], factsMap[key]);
      }
    }
    // Enrich any spell that has DB2 facts with name/duration/maxStacks (covers seed spells too;
    // curation/debuff values already set win via ??).
    for (const [key, f] of Object.entries(factsMap)) {
      const info = table.byId.get(Number(key));
      if (!info) continue;
      info.name ??= f.name;
      info.durationSeconds ??= f.durationSeconds;
      info.maxStacks ??= f.maxStacks;
    }
    return table;
  }

  private addRemover(spellId: number, entry: RemoverEntry, fact?: SpellFact): void {
    const providesSet = new Set(unionCats(fact?.provides, entry.provides));
    this.removers.set(spellId, { ...entry, name: entry.name ?? fact?.name, spellId, providesSet });
    for (const cat of providesSet) {
      (this.removersByCategory.get(cat) ?? this.removersByCategory.set(cat, []).get(cat)!).push(spellId);
    }
  }

  // True when a category is a friendly dispel SCHOOL (emits SPELL_DISPEL). Consults the loaded
  // vocabulary, falling back to the built-in school set when categories.json was not provided.
  private isSchool(cat: RemovalCategory): boolean {
    const def = this.categories.get(cat);
    if (def) return def.kind === 'school' && !def.hostile;
    return SpellTable.DEFAULT_SCHOOLS.has(cat) && cat !== 'enrage';
  }

  private set(seed: SeedSpell, ov: OverlayEntry | undefined): void {
    const interruptible = seed.interruptible ?? false;
    const dispelType = seed.dispelType ?? null;
    const info: SpellInfo = {
      spellId: seed.spellId,
      ...(seed.npcId !== undefined ? { npcId: seed.npcId } : {}),
      npcIds: seed.npcIds ?? (seed.npcId !== undefined ? [seed.npcId] : []),
      ...(seed.dungeon !== undefined ? { dungeon: seed.dungeon } : {}),
      isBoss: seed.isBoss ?? false,
      interruptible,
      dispelType,
      // Sensible defaults so analytics work with an empty overlay; overrides win.
      avoidable: ov?.avoidable ?? false,
      interruptPriority: ov?.interruptPriority ?? (interruptible ? 'regular' : null),
      dispelPriority: ov?.dispelPriority ?? (dispelType ? 'regular' : null),
      activeMitigation: ov?.activeMitigation ?? false,
      ...(ov?.defensive !== undefined ? { defensive: ov.defensive } : {}),
      ...(ov?.notes !== undefined ? { notes: ov.notes } : {}),
    };
    this.byId.set(info.spellId, info);
    if (info.activeMitigation) this.activeMitigationIds.add(info.spellId);
    if (info.avoidable) this.avoidableIds.add(info.spellId);
    if (info.defensive) this.defensiveIds.add(info.spellId);
  }

  // Merge one debuff entry onto the table. Creates a minimal SpellInfo for ids absent from the
  // seed/overlay (applied auras usually aren't in MDT enemy data). Stores the entry + removableBy
  // verbatim; back-compat-derives dispelType/dispelPriority for the existing #6 dispel analytic
  // from the FIRST school category in removableBy (so a school-dispellable debuff still reads as
  // such), while mechanic/special-only debuffs (bleed, snare) get no dispelPriority.
  private applyDebuff(id: number, entry: DebuffEntry, dungeon: string, ov: OverlayEntry | undefined, fact?: SpellFact): void {
    let info = this.byId.get(id);
    if (!info) {
      info = {
        spellId: id,
        npcIds: [],
        ...(dungeon ? { dungeon } : {}),
        isBoss: entry.boss ?? false,
        interruptible: false,
        dispelType: null,
        avoidable: false,
        interruptPriority: null,
        dispelPriority: null,
        activeMitigation: false,
      };
      this.byId.set(id, info);
    } else if (info.dungeon === undefined && dungeon) {
      info.dungeon = dungeon;
    }
    info.debuff = entry.dungeon ? entry : { ...entry, dungeon };
    // removableBy = DB2 facts ∪ curation override. The first SCHOOL in the union backfills
    // dispelType/dispelPriority below for the existing #6 dispel analytic.
    info.removableBy = unionCats(fact?.removableBy, entry.removableBy);
    this.dangerousDebuffIds.add(id);

    const school = info.removableBy.find((c) => this.isSchool(c));
    // Backfill dispelType for school-dispellable auras not seeded by MDT (keeps get().dispelType
    // consistent with the rest of the table).
    if (info.dispelType === null && school !== undefined) info.dispelType = school;
    // Derive a dangerous dispel priority ONLY for school-dispellable debuffs. An explicit overlay
    // dispelPriority always wins (overlay is the higher-precedence curation).
    if (ov?.dispelPriority === undefined && entry.priority === 'dangerous' && school !== undefined) {
      info.dispelPriority = 'dangerous';
    }
  }

  get size(): number {
    return this.byId.size;
  }
  get(spellId: number): SpellInfo | undefined {
    return this.byId.get(spellId);
  }
  isAvoidable(spellId: number): boolean {
    return this.byId.get(spellId)?.avoidable ?? false;
  }
  interruptPriority(spellId: number): Priority {
    return this.byId.get(spellId)?.interruptPriority ?? null;
  }
  dispelPriority(spellId: number): Priority {
    return this.byId.get(spellId)?.dispelPriority ?? null;
  }
  isActiveMitigation(spellId: number): boolean {
    return this.activeMitigationIds.has(spellId);
  }
  /** Defensive-cooldown metadata for a spell, or undefined if not curated as one. */
  defensive(spellId: number): DefensiveInfo | undefined {
    return this.byId.get(spellId)?.defensive;
  }
  isDefensive(spellId: number): boolean {
    return this.defensiveIds.has(spellId);
  }
  /** Set of spell ids curated as player defensive cooldowns (may be empty). */
  defensiveSpellIds(): ReadonlySet<number> {
    return this.defensiveIds;
  }
  /** Set of spell ids curated as tank active-mitigation buffs (may be empty). */
  activeMitigationSpellIds(): ReadonlySet<number> {
    return this.activeMitigationIds;
  }
  /** Set of spell ids curated as avoidable (may be empty). */
  avoidableSpellIds(): ReadonlySet<number> {
    return this.avoidableIds;
  }
  /** Curated debuff metadata for an applied-aura id, or undefined. */
  debuff(spellId: number): DebuffEntry | undefined {
    return this.byId.get(spellId)?.debuff;
  }
  isDangerousDebuff(spellId: number): boolean {
    return this.dangerousDebuffIds.has(spellId);
  }
  /** Set of applied-aura ids curated as dangerous debuffs (may be empty). */
  dangerousDebuffSpellIds(): ReadonlySet<number> {
    return this.dangerousDebuffIds;
  }

  // --- Removal model -------------------------------------------------------
  /** Vocabulary metadata for a removal category, or undefined. */
  removalCategory(id: RemovalCategory): RemovalCategoryDef | undefined {
    return this.categories.get(id);
  }
  /** Categories that can clear a debuff aura (empty if the id is not a curated debuff). */
  removableCategoriesOf(spellId: number): readonly RemovalCategory[] {
    return this.byId.get(spellId)?.removableBy ?? [];
  }
  /** A curated remover (player buff/cast), or undefined. */
  remover(spellId: number): ResolvedRemover | undefined {
    return this.removers.get(spellId);
  }
  isRemover(spellId: number): boolean {
    return this.removers.has(spellId);
  }
  removerSpellIds(): IterableIterator<number> {
    return this.removers.keys();
  }
  /**
   * Can `removerSpellId` clear the aura `debuffSpellId`? True iff the remover's provided
   * categories intersect the debuff's removableBy set. The core removal-matching primitive.
   */
  canRemove(removerSpellId: number, debuffSpellId: number): boolean {
    const remover = this.removers.get(removerSpellId);
    if (!remover) return false;
    const removable = this.byId.get(debuffSpellId)?.removableBy;
    if (!removable) return false;
    return removable.some((c) => remover.providesSet.has(c));
  }
  /** Spell ids of all removers that can clear a given debuff aura (may be empty). */
  removersForDebuff(debuffSpellId: number): number[] {
    const removable = this.byId.get(debuffSpellId)?.removableBy;
    if (!removable || removable.length === 0) return [];
    const out = new Set<number>();
    for (const cat of removable) {
      for (const id of this.removersByCategory.get(cat) ?? []) out.add(id);
    }
    return [...out];
  }
}
