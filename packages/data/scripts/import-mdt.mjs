// Persistent MDT importer: parses the MDT dungeon Lua files in ../dungeons and emits a
// spell SEED (generated/spell-seed.json) — the data backbone for the curated spell table
// (avoidable damage, interrupt priority, dispel priority).
//
// What MDT gives us per enemy spell: `interruptible` and the dispel-type flag
// (magic/curse/disease/poison/bleed/enrage). What it does NOT give: `avoidable`,
// interrupt/dispel PRIORITY, or active-mitigation — those are curated on top of this seed
// (MDT is the seed, not ground truth). Re-run after dropping in new/updated dungeon Lua.
//
//   pnpm --filter @wow/data run import:mdt

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dungeonsDir = join(here, '..', 'dungeons');
const outDir = join(here, '..', 'generated');
const outFile = join(outDir, 'spell-seed.json');
const enemiesFile = join(outDir, 'dungeon-enemies.json');

const DISPEL_TYPES = ['magic', 'curse', 'disease', 'poison', 'bleed', 'enrage'];

// ---------------------------------------------------------------------------
// Minimal cursor-based parser for the Lua table-literal subset MDT uses. Handles
// `{ ["key"]=v, [123]=v, ... }` with string / number / boolean / nil / nested-table
// values, `--` line comments, and trailing commas. No eval, no Lua semantics beyond
// table literals.
// ---------------------------------------------------------------------------
function parseLuaTableAt(src, startIndex) {
  let i = startIndex;

  const skipTrivia = () => {
    for (;;) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        i++;
      } else if (c === '-' && src[i + 1] === '-') {
        i += 2;
        while (i < src.length && src[i] !== '\n') i++;
      } else {
        break;
      }
    }
  };

  const parseString = (quote) => {
    i++; // opening quote
    let out = '';
    while (i < src.length && src[i] !== quote) {
      if (src[i] === '\\') {
        out += src[i + 1];
        i += 2;
      } else {
        out += src[i++];
      }
    }
    i++; // closing quote
    return out;
  };

  const parseNumber = () => {
    const start = i;
    if (src[i] === '-') i++;
    while (i < src.length && /[0-9.eE+-]/.test(src[i])) i++;
    return Number(src.slice(start, i));
  };

  const parseValue = () => {
    skipTrivia();
    const c = src[i];
    if (c === '{') return parseTable();
    if (c === '"' || c === "'") return parseString(c);
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    // identifier: true / false / nil
    const start = i;
    while (i < src.length && /[A-Za-z_]/.test(src[i])) i++;
    const word = src.slice(start, i);
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'nil') return null;
    throw new Error(`unexpected token "${word || src[i]}" at ${i}`);
  };

  const parseTable = () => {
    skipTrivia();
    if (src[i] !== '{') throw new Error(`expected { at ${i}`);
    i++;
    const obj = {};
    let autoIndex = 1;
    for (;;) {
      skipTrivia();
      if (src[i] === '}') {
        i++;
        break;
      }
      let key;
      if (src[i] === '[') {
        i++; // [
        skipTrivia();
        key = src[i] === '"' || src[i] === "'" ? parseString(src[i]) : parseNumber();
        skipTrivia();
        i++; // ]
        skipTrivia();
        i++; // =
        obj[String(key)] = parseValue();
      } else {
        obj[String(autoIndex++)] = parseValue();
      }
      skipTrivia();
      if (src[i] === ',' || src[i] === ';') i++;
    }
    return obj;
  };

  return parseTable();
}

function extractDungeon(src) {
  // mapInfo uses bare-key syntax: `englishName = "Pit of Saron"` (not ["englishName"]).
  const nameMatch = src.match(/\benglishName\s*=\s*"([^"]+)"/);
  const dungeon = nameMatch ? nameMatch[1] : 'Unknown';
  // Enemy-forces total (count needed to complete) — `dungeonTotalCount[dungeonIndex] = { normal = N }`.
  const totalMatch = src.match(/dungeonTotalCount\[dungeonIndex\]\s*=\s*{[^}]*?\bnormal\b\s*=\s*(\d+)/s);
  const totalCount = totalMatch ? Number(totalMatch[1]) : 0;
  const anchor = src.indexOf('MDT.dungeonEnemies[dungeonIndex] = {');
  if (anchor === -1) return { dungeon, totalCount, enemies: {} };
  const braceStart = src.indexOf('{', anchor);
  const enemies = parseLuaTableAt(src, braceStart);
  return { dungeon, totalCount, enemies };
}

/**
 * Per-dungeon ENEMY FACTS for pull detection / after-action: npcId -> { name, count, encounterID?,
 * groups }. `count` is the enemy-forces value (0 for bosses + their adds + non-counting trash);
 * `groups` are the MDT pack ids (clone `g`) the npc appears in — used to label pulls and flag a pull
 * that spans multiple packs (a combined/double pull). `encounterID` marks boss-area npcs.
 */
function enemyFactsOf(enemies) {
  const out = {};
  for (const enemy of Object.values(enemies)) {
    if (!enemy || typeof enemy !== 'object') continue;
    const npcId = enemy.id;
    if (npcId == null) continue;
    const groups = new Set();
    if (enemy.clones && typeof enemy.clones === 'object') {
      for (const clone of Object.values(enemy.clones)) {
        const g = clone && typeof clone === 'object' ? clone.g : undefined;
        if (typeof g === 'number') groups.add(g);
      }
    }
    out[String(npcId)] = {
      name: enemy.name ?? '',
      count: typeof enemy.count === 'number' ? enemy.count : 0,
      ...(typeof enemy.encounterID === 'number' ? { encounterID: enemy.encounterID } : {}),
      groups: [...groups].sort((a, b) => a - b),
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
function main() {
  const files = readdirSync(dungeonsDir).filter((f) => f.endsWith('.lua'));
  const bySpell = new Map(); // spellId -> seed record
  const dungeons = [];
  const dungeonEnemies = {}; // dungeon name -> { totalCount, enemies: { npcId -> facts } }
  let enemyCount = 0;

  for (const file of files.sort()) {
    const src = readFileSync(join(dungeonsDir, file), 'utf8');
    const { dungeon, totalCount, enemies } = extractDungeon(src);
    dungeons.push(dungeon);
    dungeonEnemies[dungeon] = { totalCount, enemies: enemyFactsOf(enemies) };

    for (const enemy of Object.values(enemies)) {
      if (!enemy || typeof enemy !== 'object') continue;
      const npcId = enemy.id;
      if (npcId == null) continue;
      enemyCount++;
      const npcName = enemy.name ?? '';
      const isBoss = enemy.isBoss === true;
      const spells = enemy.spells;
      if (!spells || typeof spells !== 'object') continue;

      for (const [spellKey, flags] of Object.entries(spells)) {
        const spellId = Number(spellKey);
        if (!Number.isFinite(spellId)) continue;
        const interruptible = flags?.interruptible === true;
        const dispelType = DISPEL_TYPES.find((t) => flags?.[t] === true) ?? null;

        const existing = bySpell.get(spellId);
        if (existing) {
          // Same spell cast by multiple enemies/dungeons: union the seed signal.
          existing.interruptible = existing.interruptible || interruptible;
          if (existing.dispelType == null) existing.dispelType = dispelType;
          if (!existing.npcIds.includes(npcId)) existing.npcIds.push(npcId);
          if (!existing.dungeons.includes(dungeon)) existing.dungeons.push(dungeon);
          existing.isBoss = existing.isBoss || isBoss;
        } else {
          bySpell.set(spellId, {
            spellId,
            npcId,
            npcName,
            npcIds: [npcId],
            dungeon,
            dungeons: [dungeon],
            isBoss,
            interruptible,
            dispelType,
          });
        }
      }
    }
  }

  const spells = [...bySpell.values()].sort((a, b) => a.spellId - b.spellId);
  const seed = {
    generatedAt: new Date().toISOString(),
    source: 'MDT dungeon Lua (packages/data/dungeons) — re-run scripts/import-mdt.mjs to refresh',
    dungeons: dungeons.sort(),
    counts: {
      dungeons: dungeons.length,
      enemies: enemyCount,
      spells: spells.length,
      interruptible: spells.filter((s) => s.interruptible).length,
      withDispelType: spells.filter((s) => s.dispelType).length,
    },
    spells,
  };

  const enemyDb = {
    generatedAt: new Date().toISOString(),
    source: 'MDT dungeon Lua (packages/data/dungeons) — re-run scripts/import-mdt.mjs to refresh',
    dungeons: dungeonEnemies,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, JSON.stringify(seed, null, 2) + '\n');
  writeFileSync(enemiesFile, JSON.stringify(enemyDb, null, 2) + '\n');

  const enemyTotals = Object.values(dungeonEnemies).reduce((n, d) => n + Object.keys(d.enemies).length, 0);
  console.log(`[import-mdt] ${files.length} dungeon files -> ${spells.length} distinct spells`);
  console.log(`[import-mdt] counts:`, seed.counts);
  console.log(`[import-mdt] enemy facts: ${enemyTotals} npcs across ${Object.keys(dungeonEnemies).length} dungeons`);
  console.log(`[import-mdt] wrote ${outFile}`);
  console.log(`[import-mdt] wrote ${enemiesFile}`);
}

main();
