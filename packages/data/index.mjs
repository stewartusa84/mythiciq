// Node-side entry: filesystem paths to the spell-table data so the engine can read
// them with fs. Browser/Vite consumers can import the JSON directly via the package
// exports ("@wow/data/spell-seed", "@wow/data/curation").
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/** Contributor-edited curation folder. Runtime/generated artifacts are built from these files. */
export const curationDir = join(here, 'curation');
/** Generated MDT seed (run scripts/import-mdt.mjs to refresh). */
export const spellSeedPath = join(here, 'generated', 'spell-seed.json');
/** Generated DB2 mechanical facts (run scripts/import-db2.mjs to refresh). */
export const spellFactsPath = join(here, 'generated', 'spell-facts.json');
/** Generated per-dungeon enemy facts for pull detection (run scripts/import-mdt.mjs to refresh). */
export const dungeonEnemiesPath = join(here, 'generated', 'dungeon-enemies.json');
/** Generated mechanics BUNDLE — the single artifact served to / fetched by the client
 *  (run scripts/build-mechanics.mjs to refresh). */
export const mechanicsPath = join(here, 'generated', 'mechanics.json');
/** Hand-curated overlay merged on top of the seed. */
export const overlayPath = join(here, 'curation', 'overlay.json');
/** Removal-category vocabulary (debuffs/removers tag against these). */
export const removalCategoriesPath = join(here, 'curation', 'removal-categories.json');
/** Player removers (buffs/casts that clear debuff categories). */
export const removersPath = join(here, 'curation', 'removers.json');
/** Dangerous player-debuffs (tagged with removableBy categories), grouped by dungeon. */
export const debuffsPath = join(here, 'curation', 'debuffs.json');
/** Mythic+ affix metadata and fallback display names. */
export const affixesPath = join(here, 'curation', 'affixes.json');
/** Role-lensed advice shown for curated mechanics. */
export const mechanicAdvicePath = join(here, 'curation', 'mechanic-advice.json');
