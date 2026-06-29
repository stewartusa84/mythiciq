// Build the custom-metric PRESET library shipped to the app's preset browser.
//
// Source: curation/custom-metrics-examples.json — the hand-authored, all-spec starter templates
// (editor-schema `metric` shape). This script validates each entry against the five supported metric
// types, strips the verbose editor schema/aliases, and emits a lean generated/metric-presets.json:
//   { generatedAt, gameContext, presets: [ {id,class,spec,role,name,description,priority,tags,
//     talentDependent,contextSensitive,requiresReview,reviewReasons?,metric} ] }
// The app imports this via "@wow/data/metric-presets" and converts each `metric` → an engine rule at
// add-time (the conversion lives in @wow/engine's customMetricsShare, the single source of truth).
//
// Run: pnpm --filter @wow/data run import:metric-presets  (or: node scripts/import-metric-presets.mjs)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SRC = join(root, 'curation', 'custom-metrics-examples.json');
const OUT = join(root, 'generated', 'metric-presets.json');

const KNOWN_RESOURCES = new Set([
  'mana', 'rage', 'focus', 'energy', 'combo_points', 'runic_power', 'soul_shards',
  'astral_power', 'maelstrom', 'chi', 'insanity', 'fury', 'pain', 'essence',
]);
const COMPARATORS = new Set(['>', '>=', '<', '<=']);

/** Validate (and lightly normalize) one template `metric`. Returns the cleaned metric or throws. */
function checkMetric(m) {
  if (!m || typeof m !== 'object') throw new Error('missing metric');
  switch (m.type) {
    case 'resource':
      if (!KNOWN_RESOURCES.has(String(m.resource))) throw new Error(`unknown resource "${m.resource}"`);
      if (!COMPARATORS.has(m.comparator)) throw new Error(`bad comparator "${m.comparator}"`);
      if (typeof m.value !== 'number') throw new Error('resource value not a number');
      return { type: 'resource', target: m.target ?? 'self', resource: m.resource, comparator: m.comparator, value: m.value };
    case 'aura':
      if (!m.spellId) throw new Error('aura missing spellId');
      return { type: 'aura', target: m.target ?? 'self', spellId: m.spellId, stackComparator: m.stackComparator ?? '>=', stacks: m.stacks ?? 1, auraKind: m.auraKind ?? 'any' };
    case 'buff_missing':
      if (!m.spellId) throw new Error('buff_missing missing spellId');
      return { type: 'buff_missing', target: m.target ?? 'self', spellId: m.spellId, auraKind: m.auraKind ?? 'any', inCombatOnly: m.inCombatOnly !== false };
    case 'cooldown_sitting_on':
      if (!m.spellId) throw new Error('cooldown missing spellId');
      return { type: 'cooldown_sitting_on', target: m.target ?? 'self', spellId: m.spellId, cooldownSeconds: m.cooldownSeconds ?? 0, idleThresholdSeconds: m.idleThresholdSeconds ?? 5 };
    case 'charges_capped':
      if (!m.spellId) throw new Error('charges missing spellId');
      return { type: 'charges_capped', target: m.target ?? 'self', spellId: m.spellId, maxCharges: m.maxCharges ?? 2, rechargeSeconds: m.rechargeSeconds ?? 30 };
    default:
      throw new Error(`unknown metric type "${m.type}"`);
  }
}

const src = JSON.parse(readFileSync(SRC, 'utf8'));
const templates = Array.isArray(src.templates) ? src.templates : [];
if (templates.length === 0) {
  console.error(`No templates found in ${SRC}`);
  process.exit(1);
}

const presets = [];
const skipped = [];
const seen = new Set();
for (const t of templates) {
  try {
    if (!t.id || seen.has(t.id)) throw new Error(t.id ? `duplicate id "${t.id}"` : 'missing id');
    seen.add(t.id);
    const metric = checkMetric(t.metric);
    presets.push({
      id: t.id,
      class: t.class ?? 'Unknown',
      spec: t.spec ?? 'Unknown',
      role: t.role ?? 'dps',
      name: t.name ?? t.id,
      ...(t.description ? { description: t.description } : {}),
      ...(t.priority ? { priority: t.priority } : {}),
      ...(Array.isArray(t.tags) && t.tags.length ? { tags: t.tags } : {}),
      ...(t.talentDependent ? { talentDependent: true } : {}),
      ...(t.contextSensitive ? { contextSensitive: true } : {}),
      ...(t.requiresReview ? { requiresReview: true } : {}),
      ...(Array.isArray(t.reviewReasons) && t.reviewReasons.length ? { reviewReasons: t.reviewReasons } : {}),
      metric,
    });
  } catch (e) {
    skipped.push(`${t.id ?? '(no id)'}: ${e.message}`);
  }
}

// Collapse presets that share the EXACT same metric (same target + subject) into ONE entry tagged
// with every spec it applies to (`applies`), instead of N near-identical rows. Most resource caps
// (Energy, Mana, Rage…) and shared cooldowns recur verbatim across a class's specs — one library
// entry that surfaces under each spec filter is the right model, not a copy per spec.
const sigOf = (p) => JSON.stringify([p.metric.target ?? 'self', p.metric]);
const bySig = new Map();
for (const p of presets) {
  const s = sigOf(p);
  if (!bySig.has(s)) bySig.set(s, []);
  bySig.get(s).push(p);
}
const uniqArr = (xs) => [...new Set(xs)];
const merged = [];
const nameConflicts = [];
for (const group of bySig.values()) {
  const applies = group.map((p) => ({ class: p.class, spec: p.spec, role: p.role }));
  if (group.length === 1) {
    merged.push({ ...group[0], applies });
    continue;
  }
  // Representative name = the most common one in the group (ties → first authored).
  const nameCounts = new Map();
  for (const p of group) nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
  const names = [...nameCounts.keys()];
  if (names.length > 1) nameConflicts.push({ names, specs: group.map((p) => `${p.class}/${p.spec}`) });
  const repName = names.sort((a, b) => nameCounts.get(b) - nameCounts.get(a))[0];
  const rep = group.find((p) => p.name === repName) ?? group[0];
  const tags = uniqArr(group.flatMap((p) => p.tags ?? []));
  const reviewReasons = uniqArr(group.flatMap((p) => p.reviewReasons ?? []));
  const priority = group.some((p) => p.priority === 'core') ? 'core' : rep.priority;
  merged.push({
    id: rep.id,
    class: rep.class, // representative (display fallback / back-compat)
    spec: rep.spec,
    role: rep.role,
    name: repName,
    ...(rep.description ? { description: rep.description } : {}),
    ...(priority ? { priority } : {}),
    ...(tags.length ? { tags } : {}),
    ...(group.some((p) => p.talentDependent) ? { talentDependent: true } : {}),
    ...(group.some((p) => p.contextSensitive) ? { contextSensitive: true } : {}),
    ...(group.some((p) => p.requiresReview) ? { requiresReview: true } : {}),
    ...(reviewReasons.length ? { reviewReasons } : {}),
    applies,
    metric: rep.metric,
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  ...(src.gameContext ? { gameContext: src.gameContext } : {}),
  presets: merged,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');

const classes = new Set(merged.flatMap((p) => p.applies.map((a) => a.class))).size;
const specs = new Set(merged.flatMap((p) => p.applies.map((a) => `${a.class}/${a.spec}`))).size;
console.log(`metric-presets: ${merged.length} unique metrics (from ${presets.length} authored) across ${classes} classes / ${specs} specs → ${OUT}`);
if (nameConflicts.length) {
  console.warn(`note: ${nameConflicts.length} merged metric(s) had differing names across specs — used the most common:`);
  for (const c of nameConflicts) console.warn(`  ${c.specs.join(', ')}: ${c.names.map((n) => `"${n}"`).join(' vs ')}`);
}
if (skipped.length) console.warn(`skipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
