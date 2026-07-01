// Assemble the single MECHANICS BUNDLE the backend serves and the client fetches:
// generated/mechanics.json = { version, generatedAt, seed, overlay, categories, removers, debuffs,
// facts, enemies, cards }. One blob that fully provisions SpellTable.fromData + per-dungeon enemy
// facts (pull detection / after-action) + the consolidated mechanic CARDS (learning content).
// `version` is a content hash for ETag/cache-busting. Re-run after any source change:
//   pnpm --filter @wow/data run build:mechanics   (or: node packages/data/scripts/build-mechanics.mjs)
//
// CONSOLIDATION: enemy mechanics are now curated as one "card" per mechanic under
// curation/mechanics/<dungeon-slug>.json (M+) and curation/mechanics/<raid-slug>/<encounter>.json
// (raid). This script GLOBS those cards and fans their classification back into the bundle's
// overlay (avoidable / interrupt-priority / dispel-priority) and debuffs (dangerous-debuff judgment)
// sections, so SpellTable.fromData + every analytic are unchanged — while shipping the whole card in
// bundle.cards for the in-app learning view. overlay.json now holds PLAYER-KIT only; debuffs.json is
// the backend auto-promotion registry (UNIONed in).
//
// Conventionally run after import:mdt / import:db2 / curation edits. The backend imports
// buildMechanics() directly to regenerate the bundle in-process after auto-promoting discoveries.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const sourcePath = (file) => relative(root, file).replaceAll('\\', '/');

const readJson = async (p) => {
  const file = join(root, p);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error(`Invalid JSON in ${p.replaceAll('\\', '/')}: ${e.message}`);
    throw e;
  }
};

const TOP_LEVEL_FIELDS = new Set(['_meta', 'cards']);
const META_FIELDS = new Set(['kind', 'name', 'slug', 'instance', 'encounterId']);
const META_KINDS = new Set(['dungeon', 'encounter']);
const CARD_FIELDS = new Set([
  'name',
  'caster',
  'boss',
  'avoidable',
  'interruptPriority',
  'dispelPriority',
  'danger',
  'removableBy',
  'summary',
  'advice',
  'videos',
  'tags',
  'confidence',
  'source',
  'sourceUrl',
  'notes',
]);
const ADVICE_FIELDS = new Set(['generic', 'tank', 'healer', 'dps']);
const VIDEO_FIELDS = new Set(['title', 'url', 'atSeconds', 'source']);
const PRIORITIES = new Set(['dangerous', 'regular', null]);
const DANGER_VALUES = new Set(['dangerous', 'regular']);
const CONFIDENCE_VALUES = new Set(['high', 'medium', 'low']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function failCard(file, path, message) {
  throw new Error(`Invalid mechanic curation in ${sourcePath(file)}${path ? ` ${path}` : ''}: ${message}`);
}

async function readCardFile(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e instanceof SyntaxError) failCard(file, '', `invalid JSON: ${e.message}`);
    throw e;
  }
}

function rejectUnknownFields(file, path, value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) failCard(file, `${path}.${key}`, 'unknown field');
  }
}

function requireString(file, path, value) {
  if (typeof value !== 'string' || value.trim() === '') failCard(file, path, 'must be a non-empty string');
}

function optionalString(file, path, value) {
  if (value !== undefined && typeof value !== 'string') failCard(file, path, 'must be a string');
}

function optionalBoolean(file, path, value) {
  if (value !== undefined && typeof value !== 'boolean') failCard(file, path, 'must be true or false');
}

// URL fields render as links; only allow http(s) so a curated card can't smuggle a javascript: link.
function optionalHttpUrl(file, path, value) {
  if (value === undefined) return;
  if (typeof value !== 'string') failCard(file, path, 'must be a string');
  let ok = false;
  try {
    const u = new URL(value);
    ok = u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    ok = false;
  }
  if (!ok) failCard(file, path, 'must be an http(s) URL');
}

function optionalStringArray(file, path, value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) failCard(file, path, 'must be an array of strings');
  for (const [i, item] of value.entries()) {
    if (typeof item !== 'string' || item.trim() === '') failCard(file, `${path}[${i}]`, 'must be a non-empty string');
  }
  return value;
}

function optionalPriority(file, path, value) {
  if (value !== undefined && !PRIORITIES.has(value)) {
    failCard(file, path, 'must be "dangerous", "regular", or null');
  }
}

function validateMeta(file, data) {
  const meta = data._meta;
  if (!isPlainObject(meta)) failCard(file, '._meta', 'must be an object with kind, name, and slug');
  rejectUnknownFields(file, '._meta', meta, META_FIELDS);
  if (!META_KINDS.has(meta.kind)) failCard(file, '._meta.kind', 'must be "dungeon" or "encounter"');
  requireString(file, '._meta.name', meta.name);
  requireString(file, '._meta.slug', meta.slug);
  optionalString(file, '._meta.instance', meta.instance);
  if (meta.encounterId !== undefined && !Number.isSafeInteger(meta.encounterId)) {
    failCard(file, '._meta.encounterId', 'must be an integer');
  }
  if (meta.kind === 'encounter') requireString(file, '._meta.instance', meta.instance);
  return meta;
}

function validateAdvice(file, path, advice) {
  if (advice === undefined) return;
  if (!isPlainObject(advice)) failCard(file, path, 'must be an object');
  rejectUnknownFields(file, path, advice, ADVICE_FIELDS);
  for (const key of ADVICE_FIELDS) optionalString(file, `${path}.${key}`, advice[key]);
}

function validateVideos(file, path, videos) {
  if (videos === undefined) return;
  if (!Array.isArray(videos)) failCard(file, path, 'must be an array');
  for (const [i, video] of videos.entries()) {
    const itemPath = `${path}[${i}]`;
    if (!isPlainObject(video)) failCard(file, itemPath, 'must be an object');
    rejectUnknownFields(file, itemPath, video, VIDEO_FIELDS);
    requireString(file, `${itemPath}.url`, video.url);
    optionalString(file, `${itemPath}.title`, video.title);
    optionalString(file, `${itemPath}.source`, video.source);
    if (video.atSeconds !== undefined && (!Number.isFinite(video.atSeconds) || video.atSeconds < 0)) {
      failCard(file, `${itemPath}.atSeconds`, 'must be a non-negative number');
    }
  }
}

function validateCard(file, id, card, categoryIds) {
  const path = `.cards["${id}"]`;
  if (!isPlainObject(card)) failCard(file, path, 'must be an object');
  rejectUnknownFields(file, path, card, CARD_FIELDS);

  optionalString(file, `${path}.name`, card.name);
  optionalString(file, `${path}.caster`, card.caster);
  optionalBoolean(file, `${path}.boss`, card.boss);
  optionalBoolean(file, `${path}.avoidable`, card.avoidable);
  optionalPriority(file, `${path}.interruptPriority`, card.interruptPriority);
  optionalPriority(file, `${path}.dispelPriority`, card.dispelPriority);
  if (card.danger !== undefined && !DANGER_VALUES.has(card.danger)) {
    failCard(file, `${path}.danger`, 'must be "dangerous" or "regular"');
  }
  for (const cat of optionalStringArray(file, `${path}.removableBy`, card.removableBy)) {
    if (!categoryIds.has(cat)) failCard(file, `${path}.removableBy`, `unknown removal category "${cat}"`);
  }
  optionalString(file, `${path}.summary`, card.summary);
  validateAdvice(file, `${path}.advice`, card.advice);
  validateVideos(file, `${path}.videos`, card.videos);
  optionalStringArray(file, `${path}.tags`, card.tags);
  if (card.confidence !== undefined && !CONFIDENCE_VALUES.has(card.confidence)) {
    failCard(file, `${path}.confidence`, 'must be "high", "medium", or "low"');
  }
  optionalString(file, `${path}.source`, card.source);
  optionalHttpUrl(file, `${path}.sourceUrl`, card.sourceUrl);
  optionalString(file, `${path}.notes`, card.notes);
}

// Drop the human-facing `_meta` block so the served bundle is pure data.
const stripMeta = (obj) => {
  const { _meta, ...rest } = obj;
  return rest;
};

/** Recursively list every .json under curation/mechanics/ (so raid <raid>/<encounter>.json is found). */
async function listCardFiles() {
  const base = join(root, 'curation', 'mechanics');
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // mechanics/ may not exist yet — no cards is fine
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile() && e.name.endsWith('.json')) out.push(full);
    }
  }
  await walk(base);
  return out.sort();
}

/**
 * Read all mechanic-card files and reduce them to the runtime shapes the bundle needs:
 *   - overlayFromCards: { "<id>": { avoidable?, interruptPriority?, dispelPriority?, notes? } }
 *   - debuffsFromCards: { "<dungeon>": { "<id>": { name?, caster?, boss?, priority, removableBy?, notes? } } }
 *   - cards:            { "<id>": MechanicCard + { spellId, dungeon, instance?, kind? } }
 */
async function loadCards({ categoryIds }) {
  const files = await listCardFiles();
  const overlayFromCards = {};
  const debuffsFromCards = {};
  const cards = {};
  const seen = new Map();
  const cardSources = [];
  let fileCount = 0;
  for (const file of files) {
    const data = await readCardFile(file);
    if (!isPlainObject(data)) failCard(file, '', 'file must contain a JSON object');
    rejectUnknownFields(file, '', data, TOP_LEVEL_FIELDS);
    const meta = validateMeta(file, data);
    const dungeon = meta.name ?? relative(join(root, 'curation', 'mechanics'), file).replace(/\.json$/, '');
    const entries = data.cards;
    if (!isPlainObject(entries)) failCard(file, '.cards', 'must be an object keyed by spell id');
    fileCount++;
    const sourceIds = [];
    for (const [id, card] of Object.entries(entries)) {
      if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
        failCard(file, `.cards["${id}"]`, 'spell id key must be a positive integer string');
      }
      if (seen.has(id)) failCard(file, `.cards["${id}"]`, `duplicate spell id; first defined in ${seen.get(id)}`);
      seen.set(id, sourcePath(file));
      validateCard(file, id, card, categoryIds);
      sourceIds.push(Number(id));

      // overlay (enemy CLASSIFICATION only — notes live on the card/debuff, not the overlay)
      const ov = {};
      if (card.avoidable === true) ov.avoidable = true;
      if ('interruptPriority' in card) ov.interruptPriority = card.interruptPriority;
      if ('dispelPriority' in card) ov.dispelPriority = card.dispelPriority;
      if (Object.keys(ov).length) overlayFromCards[id] = { ...(overlayFromCards[id] ?? {}), ...ov };

      // debuffs (dangerous-debuff judgment) — a card with `danger` registers membership
      if (card.danger) {
        const entry = { priority: card.danger };
        if (card.name) entry.name = card.name;
        if (card.caster) entry.caster = card.caster;
        if (card.boss) entry.boss = true;
        if (card.removableBy) entry.removableBy = card.removableBy;
        if (card.notes) entry.notes = card.notes;
        (debuffsFromCards[dungeon] ??= {})[id] = entry;
      }

      // full card (learning content + identity context)
      cards[id] = {
        spellId: Number(id),
        ...card,
        dungeon,
        ...(meta.instance ? { instance: meta.instance } : {}),
        ...(meta.kind ? { kind: meta.kind } : {}),
      };
    }
    cardSources.push({
      path: relative(join(root, 'curation', 'mechanics'), file).replaceAll('\\', '/'),
      meta,
      spellIds: sourceIds.sort((a, b) => a - b),
    });
  }
  return { overlayFromCards, debuffsFromCards, cards, cardSources, fileCount };
}

/** Deep-ish merge of two debuffs-by-dungeon maps (a wins on key collision). */
function mergeDebuffs(a, b) {
  const out = {};
  for (const src of [b, a]) {
    for (const [dungeon, byId] of Object.entries(src)) {
      const target = (out[dungeon] ??= {});
      for (const [id, entry] of Object.entries(byId)) target[id] = { ...(target[id] ?? {}), ...entry };
    }
  }
  return out;
}

/**
 * Rebuild generated/mechanics.json from curation + generated sources and return { version, counts }.
 * Pure I/O against @wow/data's own directory — safe to call in-process (the backend does this
 * after promoting discoveries into removers.json/debuffs.json).
 */
export async function buildMechanics({ write = true } = {}) {
  const [overlay, categoriesFile, removersFile, debuffsFile, factsFile, seed, enemiesFile] = await Promise.all([
    readJson('curation/overlay.json'),
    readJson('curation/removal-categories.json'),
    readJson('curation/removers.json'),
    readJson('curation/debuffs.json'),
    readJson('generated/spell-facts.json'),
    readJson('generated/spell-seed.json'),
    readJson('generated/dungeon-enemies.json'),
  ]);
  const categoryIds = new Set((categoriesFile.categories ?? []).map((cat) => cat.id).filter(Boolean));
  const cardData = await loadCards({ categoryIds });

  // overlay = curated PLAYER-KIT entries ∪ card-derived enemy classification (disjoint key sets).
  const overlaySpells = { ...(overlay.spells ?? {}), ...cardData.overlayFromCards };
  // debuffs = backend-managed registry (debuffs.json, sans _meta) ∪ card-derived dangerous debuffs.
  const debuffs = mergeDebuffs(cardData.debuffsFromCards, stripMeta(debuffsFile));

  // Stamp each dangerous-debuff card with its RESOLVED removable categories (DB2 facts ∪ override) so
  // the in-app card can render "removable by …" without the runtime SpellTable. Display-only.
  const factsMap = factsFile.facts ?? {};
  for (const [id, card] of Object.entries(cardData.cards)) {
    if (!card.danger) continue;
    const set = new Set([...(factsMap[id]?.removableBy ?? []), ...(card.removableBy ?? [])]);
    if (set.size) card.removableCategories = [...set];
  }

  const payload = {
    seed, // { spells, dungeons, counts }
    overlay: { spells: overlaySpells },
    categories: categoriesFile.categories ?? [],
    removers: removersFile.removers ?? {},
    debuffs, // { "<dungeon>": { "<id>": entry } }
    facts: factsFile.facts ?? {},
    enemies: enemiesFile.dungeons ?? {}, // { "<dungeon>": { totalCount, enemies: { "<npcId>": facts } } }
    cards: cardData.cards, // { "<id>": MechanicCard }
    cardSources: cardData.cardSources,
  };

  const version = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
  const bundle = { version, generatedAt: new Date().toISOString(), ...payload };

  if (write) await writeFile(join(root, 'generated/mechanics.json'), JSON.stringify(bundle) + '\n');

  const counts = {
    seedSpells: seed.spells?.length ?? 0,
    categories: payload.categories.length,
    removers: Object.keys(payload.removers).length,
    debuffs: Object.values(payload.debuffs).reduce((n, d) => n + Object.keys(d).length, 0),
    facts: Object.keys(payload.facts).length,
    enemyDungeons: Object.keys(payload.enemies).length,
    cards: Object.keys(payload.cards).length,
    cardFiles: cardData.fileCount,
  };
  return { version, counts };
}

// CLI entry — run directly (node scripts/build-mechanics.mjs) for the manual pipeline.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const checkOnly = process.argv.includes('--check');
  buildMechanics({ write: !checkOnly })
    .then(({ version, counts }) =>
      console.log(`${checkOnly ? 'mechanics curation valid' : 'mechanics.json'} v${version} —`, JSON.stringify(counts)),
    )
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
