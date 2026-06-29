// Persistent avoidable-damage importer. Reads the hand-curated list of avoidable enemy spells in
// curation/avoidable.json (grouped by dungeon: spellId → { ability, note? }) and merges
// `avoidable: true` into curation/overlay.json, keyed by spell id. This is the JUDGMENT layer for the
// #8 avoidable-damage analytic — MDT seeds enemy casts but does NOT say which are avoidable (some are
// unavoidable tank-busters/raid-wides), so avoidability is curated here.
//
// Idempotent + non-destructive: existing overlay entries are preserved (e.g. a spell that is both an
// interrupt-priority cast AND avoidable keeps its interruptPriority and gains avoidable:true); a note
// is added only when the entry has none. Re-run after editing the list:
//   pnpm --filter @wow/data run import:avoidable   (then build:mechanics to refresh the served bundle)
//
// avoidable.json is the editable source of truth; overlay.json is generated-merged from it. The
// per-entry `note` field in avoidable.json is source documentation only (not written to the overlay).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataRoot = join(here, '..');
const listPath = join(dataRoot, 'curation', 'avoidable.json');
const overlayPath = join(dataRoot, 'curation', 'overlay.json');

/** Flatten the dungeon-grouped JSON into [{ spellId, dungeon, ability }], de-duped globally by spell
 *  id (first occurrence wins, matching the source's dungeon order). The `_meta` block is skipped. */
function parseAvoidableList(data) {
  const out = [];
  const seen = new Set();
  for (const [dungeon, spells] of Object.entries(data)) {
    if (dungeon === '_meta' || typeof spells !== 'object' || spells === null) continue;
    for (const [id, entry] of Object.entries(spells)) {
      const spellId = Number(id);
      if (!Number.isFinite(spellId) || seen.has(spellId)) continue;
      seen.add(spellId);
      out.push({ spellId, dungeon, ability: (entry && entry.ability) || '' });
    }
  }
  return out;
}

export async function importAvoidable() {
  const [listText, overlayText] = await Promise.all([readFile(listPath, 'utf8'), readFile(overlayPath, 'utf8')]);
  const entries = parseAvoidableList(JSON.parse(listText));
  const overlay = JSON.parse(overlayText);
  overlay.spells ??= {};

  let added = 0;
  let alreadyFlagged = 0;
  let mergedIntoExisting = 0;
  for (const { spellId, dungeon, ability } of entries) {
    const key = String(spellId);
    const existing = overlay.spells[key];
    if (existing) {
      if (existing.avoidable === true) alreadyFlagged++;
      else mergedIntoExisting++;
      existing.avoidable = true;
      if (existing.notes === undefined && (dungeon || ability)) existing.notes = `avoidable · ${dungeon}${ability ? ` · ${ability}` : ''}`;
    } else {
      overlay.spells[key] = { avoidable: true, notes: `avoidable · ${dungeon}${ability ? ` · ${ability}` : ''}` };
      added++;
    }
  }

  await writeFile(overlayPath, JSON.stringify(overlay, null, 2) + '\n');
  const total = entries.length;
  return { total, added, mergedIntoExisting, alreadyFlagged };
}

// CLI entry (mirrors import-mdt / import-db2): only runs when invoked directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  importAvoidable()
    .then((r) => {
      console.log(
        `import-avoidable: ${r.total} spells from avoidable.json → overlay.json ` +
          `(${r.added} new, ${r.mergedIntoExisting} merged into existing entries, ${r.alreadyFlagged} already flagged)`,
      );
      console.log('Next: pnpm --filter @wow/data run build:mechanics  (refresh the served bundle)');
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
