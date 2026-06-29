// Persistent DB2 importer. Reads the wowdev/wago.tools CSV table dumps in curation/db2 and emits
// generated/spell-facts.json — the GENERATED MECHANICAL LAYER that sits UNDER the hand curation
// (mirrors how spell-seed.json sits under overlay.json). Per spell id we derive, authoritatively:
//   name            <- SpellName.Name_lang
//   removableBy[]   <- SpellCategories.DispelType (school) + .Mechanic + SpellEffect.EffectMechanic
//                      (snare/root/bleed/stun/silence) + SpellEffect.EffectAura==301 (healing-absorb)
//   provides[]      <- SpellEffect Effect==38 DISPEL (MiscValue_0 = dispel type removed)
//                      + EffectAura==77 MECHANIC_IMMUNITY (MiscValue_0 = mechanic cleared)  [removers]
//   durationSeconds <- SpellMisc.DurationIndex -> SpellDuration.Duration
//   maxStacks       <- SpellAuraOptions.CumulativeAura
//
// Scoped to the spell ids we actually reference (curation debuffs + removers + MDT seed) so the
// generated file stays small. Re-run after refreshing the CSVs or adding curation ids:
//   pnpm --filter @wow/data run import:db2   (or: node packages/data/scripts/import-db2.mjs)
//
// Judgment fields (priority/avoidable/interrupt priority) are NOT here — they live in curation.

import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dataRoot = join(here, '..');
const db2Dir = join(dataRoot, 'curation', 'db2');
const outPath = join(dataRoot, 'generated', 'spell-facts.json');

// --- enum -> category maps (verified against known spells in the curation notes) ------------
const DISPEL_TO_CAT = { 1: 'magic', 2: 'curse', 3: 'disease', 4: 'poison', 9: 'enrage' };
const MECHANIC_TO_CAT = { 7: 'root', 9: 'silence', 11: 'snare', 12: 'stun', 15: 'bleed' };
const HEAL_ABSORB_AURA = 301;
const EFFECT_DISPEL = 38; // DISPEL: MiscValue_0 = dispel type removed
const EFFECT_DISPEL_MECHANIC = 39; // DISPEL_MECHANIC: MiscValue_0 = mechanic cleared
const AURA_MECHANIC_IMMUNITY = 77; // MECHANIC_IMMUNITY: MiscValue_0 = mechanic granted immunity to

// quote-aware CSV line split (names contain commas inside quotes; "" is an escaped quote)
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const num = (f, i) => Number((f[i] ?? '').trim());

// Stream a CSV, skipping rows whose spell id is not wanted (fast tail/head slice before the full
// parse). `idPos` is where the spell id sits: 'first' (SpellName/SpellDuration) or 'last' (SpellID col).
async function eachWanted(file, idPos, wanted, handle) {
  const rl = createInterface({ input: createReadStream(join(db2Dir, file)), crlfDelay: Infinity });
  let idx = null;
  for await (const raw of rl) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line) continue;
    if (!idx) {
      idx = {};
      parseCsvLine(line).forEach((h, i) => (idx[h.trim()] = i));
      continue;
    }
    const sidStr = idPos === 'last' ? line.slice(line.lastIndexOf(',') + 1) : line.slice(0, line.indexOf(','));
    const sid = Number(sidStr.trim());
    if (!wanted || wanted.has(sid)) handle(parseCsvLine(line), idx, sid);
  }
}

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'));
}

async function main() {
  // ---- wanted id set: curation debuffs + removers + MDT seed -----------------------------
  const wanted = new Set();
  const debuffs = await readJson(join(dataRoot, 'curation', 'debuffs.json'));
  for (const [dungeon, byId] of Object.entries(debuffs)) {
    if (dungeon.startsWith('_')) continue;
    for (const id of Object.keys(byId)) wanted.add(Number(id));
  }
  const removers = (await readJson(join(dataRoot, 'curation', 'removers.json'))).removers ?? {};
  for (const id of Object.keys(removers)) if (!id.startsWith('_')) wanted.add(Number(id));
  try {
    const seed = await readJson(join(dataRoot, 'generated', 'spell-seed.json'));
    for (const s of seed.spells ?? []) wanted.add(Number(s.spellId));
  } catch { /* seed optional */ }
  console.log(`wanted spell ids: ${wanted.size}`);

  // ---- SpellDuration (small): index id -> seconds ----------------------------------------
  const durationById = new Map();
  await eachWanted('SpellDuration.csv', 'first', null, (f, idx) => {
    durationById.set(num(f, idx.ID), num(f, idx.Duration) / 1000);
  });

  // per-spell accumulators
  const facts = new Map();
  const get = (id) => {
    let r = facts.get(id);
    if (!r) { r = { removableBy: new Set(), provides: new Set() }; facts.set(id, r); }
    return r;
  };

  // ---- SpellName -------------------------------------------------------------------------
  await eachWanted('SpellName.csv', 'first', wanted, (f, idx, sid) => {
    get(sid).name = (f[idx.Name_lang] ?? '').trim();
  });

  // ---- SpellCategories: DispelType (school) + Mechanic -----------------------------------
  await eachWanted('SpellCategories.csv', 'last', wanted, (f, idx, sid) => {
    const r = get(sid);
    const school = DISPEL_TO_CAT[num(f, idx.DispelType)];
    if (school) r.removableBy.add(school);
    const mech = MECHANIC_TO_CAT[num(f, idx.Mechanic)];
    if (mech) r.removableBy.add(mech);
  });

  // ---- SpellMisc: DurationIndex -> seconds (prefer base difficulty 0) ---------------------
  await eachWanted('SpellMisc.csv', 'last', wanted, (f, idx, sid) => {
    const r = get(sid);
    const secs = durationById.get(num(f, idx.DurationIndex));
    if (secs === undefined) return;
    if (num(f, idx.DifficultyID) === 0) r.durationSeconds = secs;
    else if (r.durationSeconds === undefined) r.durationSeconds = secs;
  });

  // ---- SpellAuraOptions: CumulativeAura (max stacks) -------------------------------------
  await eachWanted('SpellAuraOptions.csv', 'last', wanted, (f, idx, sid) => {
    const stacks = num(f, idx.CumulativeAura);
    if (stacks > 0) get(sid).maxStacks = stacks;
  });

  // ---- SpellEffect: heal-absorb, effect-level mechanic, dispel/mechanic-immunity provides --
  await eachWanted('SpellEffect.csv', 'last', wanted, (f, idx, sid) => {
    const r = get(sid);
    const aura = num(f, idx.EffectAura);
    const effect = num(f, idx.Effect);
    const misc0 = num(f, idx.EffectMiscValue_0);
    const effMech = MECHANIC_TO_CAT[num(f, idx.EffectMechanic)];
    if (aura === HEAL_ABSORB_AURA) r.removableBy.add('healing-absorb');
    if (effMech) r.removableBy.add(effMech);
    if (effect === EFFECT_DISPEL) { const c = DISPEL_TO_CAT[misc0]; if (c) r.provides.add(c); }
    if (effect === EFFECT_DISPEL_MECHANIC) { const c = MECHANIC_TO_CAT[misc0]; if (c) r.provides.add(c); }
    if (aura === AURA_MECHANIC_IMMUNITY) { const c = MECHANIC_TO_CAT[misc0]; if (c) r.provides.add(c); }
  });

  // ---- emit ------------------------------------------------------------------------------
  const ORDER = ['magic', 'curse', 'disease', 'poison', 'enrage', 'bleed', 'healing-absorb', 'snare', 'root', 'stun', 'silence'];
  const sortCats = (set) => [...set].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const out = {};
  let missing = 0;
  for (const id of [...wanted].sort((a, b) => a - b)) {
    const r = facts.get(id);
    if (!r || (!r.name && r.removableBy.size === 0 && r.provides.size === 0)) { missing++; continue; }
    const entry = {};
    if (r.name) entry.name = r.name;
    if (r.removableBy.size) entry.removableBy = sortCats(r.removableBy);
    if (r.provides.size) entry.provides = sortCats(r.provides);
    if (r.durationSeconds !== undefined) entry.durationSeconds = r.durationSeconds;
    if (r.maxStacks !== undefined) entry.maxStacks = r.maxStacks;
    out[id] = entry;
  }

  const payload = {
    _meta: {
      generatedBy: 'scripts/import-db2.mjs',
      generatedDate: new Date().toISOString().slice(0, 10),
      source: 'DB2 CSV dumps in curation/db2 (SpellName/SpellCategories/SpellMisc/SpellDuration/SpellAuraOptions/SpellEffect)',
      note: 'Generated mechanical layer merged UNDER curation. Do not hand-edit; re-run import:db2.',
      counts: { wanted: wanted.size, emitted: Object.keys(out).length, missing },
    },
    facts: out,
  };
  await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n');
  console.log(`emitted ${Object.keys(out).length} facts, ${missing} ids had no usable DB2 data -> ${outPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
