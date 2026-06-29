// Assemble the single MECHANICS BUNDLE the backend serves and the client fetches:
// generated/mechanics.json = { version, generatedAt, seed, overlay, categories, removers, debuffs,
// facts, enemies }. One blob that fully provisions SpellTable.fromData + per-dungeon enemy facts
// (pull detection / after-action). `version` is a content
// hash for ETag/cache-busting. Re-run after any source change:
//   pnpm --filter @wow/data run build:mechanics   (or: node packages/data/scripts/build-mechanics.mjs)
// Conventionally run after import:mdt / import:db2 / curation edits. The backend imports
// buildMechanics() directly to regenerate the bundle in-process after auto-promoting discoveries.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const readJson = async (p) => JSON.parse(await readFile(join(root, p), 'utf8'));

// Drop the human-facing `_meta` block so the served bundle is pure data.
const stripMeta = (obj) => {
  const { _meta, ...rest } = obj;
  return rest;
};

/**
 * Rebuild generated/mechanics.json from the six source files and return { version, counts }.
 * Pure I/O against @wow/data's own directory — safe to call in-process (the backend does this
 * after promoting discoveries into removers.json/debuffs.json).
 */
export async function buildMechanics() {
  const [seed, overlay, categoriesFile, removersFile, debuffsFile, factsFile, enemiesFile] = await Promise.all([
    readJson('generated/spell-seed.json'),
    readJson('curation/overlay.json'),
    readJson('curation/removal-categories.json'),
    readJson('curation/removers.json'),
    readJson('curation/debuffs.json'),
    readJson('generated/spell-facts.json'),
    readJson('generated/dungeon-enemies.json'),
  ]);

  const payload = {
    seed, // { spells, dungeons, counts }
    overlay: { spells: overlay.spells ?? {} },
    categories: categoriesFile.categories ?? [],
    removers: removersFile.removers ?? {},
    debuffs: stripMeta(debuffsFile), // { "<dungeon>": { "<id>": entry } }
    facts: factsFile.facts ?? {},
    enemies: enemiesFile.dungeons ?? {}, // { "<dungeon>": { totalCount, enemies: { "<npcId>": facts } } }
  };

  const version = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12);
  const bundle = { version, generatedAt: new Date().toISOString(), ...payload };

  await writeFile(join(root, 'generated/mechanics.json'), JSON.stringify(bundle) + '\n');

  const counts = {
    seedSpells: seed.spells?.length ?? 0,
    categories: payload.categories.length,
    removers: Object.keys(payload.removers).length,
    debuffs: Object.values(payload.debuffs).reduce((n, d) => n + Object.keys(d).length, 0),
    facts: Object.keys(payload.facts).length,
    enemyDungeons: Object.keys(payload.enemies).length,
  };
  return { version, counts };
}

// CLI entry — run directly (node scripts/build-mechanics.mjs) for the manual pipeline.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildMechanics()
    .then(({ version, counts }) => console.log(`mechanics.json v${version} —`, JSON.stringify(counts)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
