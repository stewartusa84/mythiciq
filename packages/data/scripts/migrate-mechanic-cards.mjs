// ONE-SHOT migration: consolidate the scattered per-mechanic curation into per-context "mechanic cards".
//
// Merges, per spell id:
//   - curation/avoidable.json        (avoidable enemy casts, grouped by dungeon)
//   - curation/debuffs.json          (dangerous-debuff judgment: name/caster/boss/priority/removableBy)
//   - curation/mechanic-advice.json  (role-lensed advice + tags + confidence)
//   - the ENEMY entries of curation/overlay.json (avoidable/interruptPriority/dispelPriority/notes)
//   - generated/spell-seed.json      (MDT — used only to resolve a spell's dungeon)
// → curation/mechanics/<dungeon-slug>.json  (one file per dungeon; raid encounters land in
//   mechanics/<raid-slug>/<encounter-slug>.json by hand as raid curation arrives).
//
// It then REWRITES:
//   - overlay.json → PLAYER-KIT only (defensives + active-mitigation); the 143 enemy entries move to cards.
//   - debuffs.json → backend-managed registry only (the auto-promotion write target); human judgment moves
//     to the cards, removableBy overrides ride along on the card.
//
// Run once: `node scripts/migrate-mechanic-cards.mjs` (or `pnpm --filter @wow/data run migrate:cards`).
// Idempotent-safe to re-run, but it OVERWRITES the mechanics/ card files from the (now-retired) sources,
// so only re-run before those sources are deleted. After migration, edit the cards directly.

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const readJson = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'));
const exists = async (p) => access(join(root, p)).then(() => true).catch(() => false);

// Canonical display name per dungeon slug (nicely punctuated). slugify() maps every source's varied
// spelling to one of these slugs.
const CANONICAL_NAME = {
  'algethar-academy': "Algeth'ar Academy",
  'magisters-terrace': "Magisters' Terrace",
  'maisara-caverns': 'Maisara Caverns',
  'nexus-point-xenas': 'Nexus Point Xenas',
  'pit-of-saron': 'Pit of Saron',
  'seat-of-the-triumvirate': 'Seat of the Triumvirate',
  skyreach: 'Skyreach',
  'windrunner-spire': 'Windrunner Spire',
  'murder-row': 'Murder Row',
};

/** lowercase, drop apostrophes, collapse any other punctuation/space run to a single hyphen. */
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function displayName(slug) {
  return CANONICAL_NAME[slug] ?? slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function migrate() {
  // Guard: the legacy sources are RETIRED after the one-shot run. Refuse to run without them so a
  // re-run can't clobber the now-hand-edited curation/mechanics/ cards with a slimmed-overlay result.
  if (!(await exists('curation/avoidable.json')) || !(await exists('curation/mechanic-advice.json'))) {
    console.log('migrate-mechanic-cards: legacy sources already retired (avoidable.json / mechanic-advice.json absent).');
    console.log('Nothing to migrate — edit curation/mechanics/*.json directly, then build:mechanics.');
    return;
  }

  const [avoidable, debuffs, adviceFile, overlay, seed] = await Promise.all([
    readJson('curation/avoidable.json'),
    readJson('curation/debuffs.json'),
    readJson('curation/mechanic-advice.json'),
    readJson('curation/overlay.json'),
    readJson('generated/spell-seed.json'),
  ]);

  // --- index the sources by spell id -------------------------------------------------------------
  const avoidById = new Map(); // id -> { slug, ability, note }
  for (const [dungeon, spells] of Object.entries(avoidable)) {
    if (dungeon === '_meta' || !spells || typeof spells !== 'object') continue;
    const slug = slugify(dungeon);
    for (const [id, e] of Object.entries(spells)) {
      if (!avoidById.has(id)) avoidById.set(id, { slug, ability: e?.ability || '', note: e?.note || '' });
    }
  }

  const debById = new Map(); // id -> { slug, entry }
  for (const [dungeon, byId] of Object.entries(debuffs)) {
    if (dungeon === '_meta' || !byId || typeof byId !== 'object') continue;
    const slug = slugify(dungeon);
    for (const [id, entry] of Object.entries(byId)) debById.set(id, { slug, entry });
  }

  const adviceById = new Map(); // id -> mechanic-advice record
  for (const m of adviceFile.mechanics ?? []) {
    if (typeof m?.spellId === 'number') adviceById.set(String(m.spellId), m);
  }

  const seedSlugById = new Map(); // id -> slug (dungeon resolution fallback)
  for (const s of seed.spells ?? []) {
    if (s?.dungeon) seedSlugById.set(String(s.spellId), slugify(s.dungeon));
  }

  const overlaySpells = overlay.spells ?? {};
  const isPlayerKit = (v) => 'defensive' in v || v.activeMitigation === true;
  const ENEMY_FIELDS = ['avoidable', 'interruptPriority', 'dispelPriority'];
  const isEnemyOverlay = (v) => !isPlayerKit(v) && ENEMY_FIELDS.some((f) => f in v);

  // --- gather every enemy-mechanic spell id across all sources -----------------------------------
  const ids = new Set([...avoidById.keys(), ...debById.keys(), ...adviceById.keys()]);
  for (const [id, v] of Object.entries(overlaySpells)) if (isEnemyOverlay(v)) ids.add(id);

  // Parse the auto-generated overlay note "avoidable|unavoidable · <dungeon> · <ability>".
  const parseOverlayNote = (notes) => {
    const m = /^(avoidable|unavoidable)\s·\s([^·]+?)\s·\s(.+)$/.exec(String(notes ?? '').trim());
    return m ? { slug: slugify(m[2].trim()), ability: m[3].trim() } : null;
  };

  // Resolve a spell's dungeon slug: advice → avoidable → debuffs → seed → overlay-notes.
  function resolveSlug(id, ov) {
    const adv = adviceById.get(id);
    if (adv?.dungeon) return slugify(adv.dungeon);
    if (avoidById.has(id)) return avoidById.get(id).slug;
    if (debById.has(id)) return debById.get(id).slug;
    if (seedSlugById.has(id)) return seedSlugById.get(id);
    return parseOverlayNote(ov?.notes)?.slug ?? null;
  }

  // --- assemble one card per id, grouped by slug ------------------------------------------------
  const bySlug = new Map(); // slug -> Map(id -> card)
  const unresolved = [];
  for (const id of ids) {
    const ov = overlaySpells[id];
    const slug = resolveSlug(id, ov);
    if (!slug) {
      unresolved.push(id);
      continue;
    }
    const adv = adviceById.get(id);
    const av = avoidById.get(id);
    const db = debById.get(id)?.entry;
    const ovNote = parseOverlayNote(ov?.notes);

    const card = {};
    const name = db?.name || adv?.name || av?.ability || ovNote?.ability || undefined;
    if (name) card.name = name;
    if (db?.caster) card.caster = db.caster;
    if (db?.boss) card.boss = true;

    // classification
    if (av || ov?.avoidable === true) card.avoidable = true;
    // Preserve an explicit "reviewed: NOT avoidable" judgment (overlay avoidable:false) as documentation.
    else if (ov?.avoidable === false) {
      card.avoidable = false;
      card.notes = 'Reviewed: not avoidable.';
    }
    if (ov && 'interruptPriority' in ov) card.interruptPriority = ov.interruptPriority;
    if (ov && 'dispelPriority' in ov) card.dispelPriority = ov.dispelPriority;
    if (db) card.danger = db.priority === 'dangerous' || db.priority === undefined ? 'dangerous' : db.priority;
    if (db?.removableBy) card.removableBy = db.removableBy;

    // learning content
    if (adv?.advice && typeof adv.advice === 'object') {
      const a = {};
      for (const role of ['generic', 'tank', 'healer', 'dps']) {
        const t = typeof adv.advice[role] === 'string' ? adv.advice[role].trim() : '';
        if (t) a[role] = t;
      }
      if (Object.keys(a).length) card.advice = a;
    }
    if (Array.isArray(adv?.tags) && adv.tags.length) card.tags = adv.tags;
    if (adv?.confidence) card.confidence = adv.confidence;
    if (adv?.basis) card.source = adv.basis;
    const notes = db?.notes || (av?.note && !/^(linked wowhead|listed under|distinct|missing from)/i.test(av.note) ? av.note : '');
    if (notes) card.notes = notes;
    // videos: none in legacy data — contributors add them on the card going forward.

    if (Object.keys(card).length === 0) continue; // nothing worth a card
    if (!bySlug.has(slug)) bySlug.set(slug, new Map());
    bySlug.get(slug).set(id, card);
  }

  // --- write per-dungeon card files (sorted by numeric id for stable diffs) ----------------------
  const outDir = join(root, 'curation', 'mechanics');
  await mkdir(outDir, { recursive: true });
  const written = [];
  for (const [slug, cards] of [...bySlug.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sortedIds = [...cards.keys()].sort((a, b) => Number(a) - Number(b));
    const cardObj = {};
    for (const id of sortedIds) cardObj[id] = cards.get(id);
    const file = {
      _meta: { kind: 'dungeon', name: displayName(slug), slug },
      cards: cardObj,
    };
    await writeFile(join(outDir, `${slug}.json`), JSON.stringify(file, null, 2) + '\n');
    written.push({ slug, count: sortedIds.length });
  }

  // --- rewrite overlay.json → player-kit only ----------------------------------------------------
  const playerSpells = {};
  for (const [id, v] of Object.entries(overlaySpells)) if (isPlayerKit(v)) playerSpells[id] = v;
  const newOverlay = {
    note: 'Hand-curated PLAYER-KIT overlay: defensive cooldowns + tank active-mitigation buffs, keyed by spellId. These are PLAYER spells not in the MDT enemy seed. ENEMY mechanics (avoidable / interrupt-priority / dispel-priority / dangerous debuffs) now live in curation/mechanics/<dungeon>.json as consolidated mechanic cards — edit those, not this file.',
    fields: {
      activeMitigation: 'bool — tank active-mitigation buff (Ironfur/Shield Block/etc). Default false.',
      defensive: "object — a PLAYER defensive cooldown. { name, class?, spec?, type: 'personal'|'external'|'raid'|'tank'|'aura', cooldownSeconds?, durationSeconds?, description? }.",
      notes: 'string — free-form curation notes.',
    },
    spells: playerSpells,
  };
  await writeFile(join(root, 'curation', 'overlay.json'), JSON.stringify(newOverlay, null, 2) + '\n');

  // --- rewrite debuffs.json → backend-managed registry only --------------------------------------
  const newDebuffs = {
    _meta: {
      notes: [
        'BACKEND-MANAGED removal registry. The auto-promotion engine (@wow/backend src/apply.ts) appends',
        'discovered debuffs here (unknown-dungeon ones under a "Discovered" bucket) with their inferred',
        'removableBy. Human dangerous-debuff judgment (name/caster/boss/danger/notes) now lives on the',
        'consolidated mechanic CARDS in curation/mechanics/<dungeon>.json — add a card with `danger` to',
        'register a dangerous debuff; put a removableBy override on the card too. build:mechanics UNIONs',
        'this file with the card-derived debuffs.',
      ],
    },
  };
  await writeFile(join(root, 'curation', 'debuffs.json'), JSON.stringify(newDebuffs, null, 2) + '\n');

  // --- report -----------------------------------------------------------------------------------
  const totalCards = written.reduce((n, w) => n + w.count, 0);
  console.log(`migrate-mechanic-cards: ${totalCards} cards across ${written.length} files`);
  for (const w of written) console.log(`  ${w.slug}.json — ${w.count}`);
  console.log(`overlay.json → ${Object.keys(playerSpells).length} player-kit entries`);
  if (unresolved.length) console.warn(`WARNING: ${unresolved.length} unresolved ids:`, unresolved.join(', '));

  // --- audit: id sets preserved ------------------------------------------------------------------
  const cardAvoidable = new Set();
  const cardDanger = new Set();
  for (const cards of bySlug.values()) {
    for (const [id, c] of cards) {
      if (c.avoidable) cardAvoidable.add(id);
      if (c.danger) cardDanger.add(id);
    }
  }
  const oldAvoidable = new Set();
  for (const id of avoidById.keys()) oldAvoidable.add(id);
  for (const [id, v] of Object.entries(overlaySpells)) if (isEnemyOverlay(v) && v.avoidable === true) oldAvoidable.add(id);
  const oldDanger = new Set(debById.keys());
  const diff = (a, b) => [...a].filter((x) => !b.has(x));
  console.log('\naudit:');
  console.log(`  avoidable: old ${oldAvoidable.size} / card ${cardAvoidable.size}; missing ${diff(oldAvoidable, cardAvoidable)}; extra ${diff(cardAvoidable, oldAvoidable)}`);
  console.log(`  dangerous-debuff: old ${oldDanger.size} / card ${cardDanger.size}; missing ${diff(oldDanger, cardDanger)}; extra ${diff(cardDanger, oldDanger)}`);
}

migrate().catch((e) => {
  console.error(e);
  process.exit(1);
});
