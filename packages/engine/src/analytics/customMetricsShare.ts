// Sharing + presets for custom metrics (#13). Two jobs:
//   1. Convert the curated PRESET/template schema (human-authored, editor-field names) into the
//      engine's CustomMetricRule — presetToRule / metricToSubject.
//   2. Normalize PASTED json into rules (import) and serialize rules to shareable json (export), so
//      players can swap metric packs. Import is permissive: it accepts our export wrapper, a bare
//      engine rule (or array), a preset (or array), or the library file shapes ({templates|presets|
//      metricExamples}).
// This is the SINGLE conversion source of truth; the @wow/data build script emits presets in the
// template `metric` shape and the app converts here, so the mapping lives in exactly one place.

import { POWER_TYPES, type Comparator, type CustomMetricRule, type MetricSubject, type MetricTarget } from './customMetrics.js';

/** Wrapper format players paste to share. Bump `version` if the shape changes. */
export const SHARE_FORMAT = 'wow-mplus-custom-metrics';
export const SHARE_VERSION = 1;

/** snake_case resource names (the preset schema) → WoW power-type id (the engine subject). */
const RESOURCE_TO_POWER: Record<string, number> = {
  mana: 0,
  rage: 1,
  focus: 2,
  energy: 3,
  combo_points: 4,
  runic_power: 6,
  soul_shards: 7,
  astral_power: 8,
  maelstrom: 11,
  chi: 12,
  insanity: 13,
  fury: 17,
  pain: 18,
  essence: 19,
};

/** The template/editor `metric` shape (what the preset library and shared packs author). */
export interface PresetMetric {
  type: 'resource' | 'aura' | 'buff_missing' | 'cooldown_sitting_on' | 'charges_capped' | 'targets_hit';
  target?: string;
  // resource
  resource?: string;
  comparator?: string;
  value?: number;
  // aura / buff_missing
  spellId?: number;
  stackComparator?: string;
  stacks?: number;
  auraKind?: string;
  inCombatOnly?: boolean;
  // cooldown_sitting_on
  cooldownSeconds?: number;
  idleThresholdSeconds?: number;
  // charges_capped
  maxCharges?: number;
  rechargeSeconds?: number;
  // targets_hit
  minTargets?: number;
  windowSeconds?: number;
}

/** One entry in the generated preset library (lean metadata + the template metric). */
export interface MetricPreset {
  id: string;
  /** Representative class/spec/role (display fallback). The full applicability is `applies`. */
  class: string;
  spec: string;
  role: string;
  name: string;
  description?: string;
  priority?: string;
  tags?: string[];
  talentDependent?: boolean;
  contextSensitive?: boolean;
  requiresReview?: boolean;
  reviewReasons?: string[];
  /** Every spec this metric applies to — identical metrics are merged into one entry tagged with all
   *  the specs it's relevant to (rather than a duplicate row per spec). Always ≥1 entry. */
  applies?: { class: string; spec: string; role: string }[];
  metric: PresetMetric;
}

export interface MetricPresetLibrary {
  generatedAt?: string;
  gameContext?: Record<string, unknown>;
  presets: MetricPreset[];
}

const COMPARATORS = new Set<Comparator>(['>', '>=', '<', '<=']);
const asComparator = (c: unknown, dflt: Comparator): Comparator =>
  typeof c === 'string' && COMPARATORS.has(c as Comparator) ? (c as Comparator) : dflt;

/** Map a target string from any schema to a MetricTarget. `allies` is the preset spelling of `players`. */
export function normalizeTarget(t: unknown): MetricTarget {
  if (t === 'allies') return 'players';
  if (t === 'self' || t === 'players' || t === 'enemies' || t === 'all') return t;
  if (t && typeof t === 'object' && typeof (t as { guid?: unknown }).guid === 'string') return t as MetricTarget;
  return 'self';
}

const auraTypeFrom = (k: unknown): 'BUFF' | 'DEBUFF' | undefined =>
  k === 'buff' || k === 'BUFF' ? 'BUFF' : k === 'debuff' || k === 'DEBUFF' ? 'DEBUFF' : undefined;

const num = (v: unknown, dflt: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : dflt);

/** Convert a preset/template `metric` (OR an already-engine `subject`) into a MetricSubject.
 *  Throws with a human message when the metric can't be represented. */
export function metricToSubject(m: PresetMetric | MetricSubject | Record<string, unknown>): MetricSubject {
  // Already an engine subject? (carries `kind`)
  const kind = (m as { kind?: string }).kind;
  if (typeof kind === 'string') {
    const s = m as MetricSubject;
    switch (s.kind) {
      case 'resource':
        return { kind: 'resource', powerType: num(s.powerType, 0), cmp: asComparator(s.cmp, '>='), value: num(s.value, 0) };
      case 'aura':
        return { kind: 'aura', spellId: num(s.spellId, 0), minStacks: num(s.minStacks, 1), ...(s.auraType ? { auraType: s.auraType } : {}) };
      case 'aura-missing':
        return { kind: 'aura-missing', spellId: num(s.spellId, 0), ...(s.auraType ? { auraType: s.auraType } : {}), inCombatOnly: s.inCombatOnly !== false };
      case 'cooldown':
        return { kind: 'cooldown', spellId: num(s.spellId, 0), cooldownSeconds: num(s.cooldownSeconds, 0), minIdleSeconds: num(s.minIdleSeconds, 5) };
      case 'charges':
        return { kind: 'charges', spellId: num(s.spellId, 0), maxCharges: num(s.maxCharges, 2), rechargeSeconds: num(s.rechargeSeconds, 30) };
      case 'targets-hit':
        return { kind: 'targets-hit', spellId: num(s.spellId, 0), minTargets: num(s.minTargets, 2), ...(s.windowMs !== undefined ? { windowMs: num(s.windowMs, 1000) } : {}) };
      default:
        throw new Error(`unknown subject kind "${String(kind)}"`);
    }
  }

  // Otherwise it's the template `metric` shape (carries `type`).
  const t = m as PresetMetric;
  switch (t.type) {
    case 'resource': {
      const powerType = RESOURCE_TO_POWER[(t.resource ?? '').toLowerCase()];
      if (powerType === undefined) throw new Error(`unknown resource "${t.resource}"`);
      return { kind: 'resource', powerType, cmp: asComparator(t.comparator, '>='), value: num(t.value, 0) };
    }
    case 'aura': {
      if (!t.spellId) throw new Error('aura metric missing spellId');
      // The engine only models "≥ minStacks"; a < / <= stackComparator can't be represented.
      if (t.stackComparator === '<' || t.stackComparator === '<=') throw new Error('aura with "<" stack comparator is not supported');
      return { kind: 'aura', spellId: t.spellId, minStacks: num(t.stacks, 1), ...(auraTypeFrom(t.auraKind) ? { auraType: auraTypeFrom(t.auraKind)! } : {}) };
    }
    case 'buff_missing': {
      if (!t.spellId) throw new Error('buff_missing metric missing spellId');
      return { kind: 'aura-missing', spellId: t.spellId, ...(auraTypeFrom(t.auraKind) ? { auraType: auraTypeFrom(t.auraKind)! } : {}), inCombatOnly: t.inCombatOnly !== false };
    }
    case 'cooldown_sitting_on': {
      if (!t.spellId) throw new Error('cooldown metric missing spellId');
      return { kind: 'cooldown', spellId: t.spellId, cooldownSeconds: num(t.cooldownSeconds, 0), minIdleSeconds: num(t.idleThresholdSeconds, 5) };
    }
    case 'charges_capped': {
      if (!t.spellId) throw new Error('charges metric missing spellId');
      return { kind: 'charges', spellId: t.spellId, maxCharges: num(t.maxCharges, 2), rechargeSeconds: num(t.rechargeSeconds, 30) };
    }
    case 'targets_hit': {
      if (!t.spellId) throw new Error('targets_hit metric missing spellId');
      return {
        kind: 'targets-hit',
        spellId: t.spellId,
        minTargets: num(t.minTargets, 2),
        ...(t.windowSeconds !== undefined ? { windowMs: Math.round(num(t.windowSeconds, 1) * 1000) } : {}),
      };
    }
    default:
      throw new Error(`unknown metric type "${String((t as { type?: unknown }).type)}"`);
  }
}

/** Short human label for a subject (import/preset display), independent of the builder's labeller. */
export function describeSubject(subject: MetricSubject, target: MetricTarget): string {
  const who = target === 'self' ? '' : typeof target === 'string' ? `${target} ` : '';
  switch (subject.kind) {
    case 'resource':
      return `${who}${POWER_TYPES.find((p) => p.id === subject.powerType)?.name ?? `power ${subject.powerType}`} ${subject.cmp} ${subject.value}`;
    case 'aura':
      return `${who}aura ${subject.spellId}${(subject.minStacks ?? 1) > 1 ? ` ≥${subject.minStacks}` : ''}`;
    case 'aura-missing':
      return `${who}${subject.spellId} missing${subject.inCombatOnly ? ' (in combat)' : ''}`;
    case 'cooldown':
      return `${who}sitting on ${subject.spellId} (${subject.cooldownSeconds}s CD)`;
    case 'charges':
      return `${who}${subject.spellId} charges capped (${subject.maxCharges}×${subject.rechargeSeconds}s)`;
    case 'targets-hit':
      return `${who}${subject.spellId} hit <${subject.minTargets} targets`;
  }
}

const genId = (): string => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};

/** Convert one preset to a runnable rule (fresh id; label from the preset name). */
export function presetToRule(preset: MetricPreset): CustomMetricRule {
  const subject = metricToSubject(preset.metric);
  const target = normalizeTarget(preset.metric.target);
  return { id: genId(), label: preset.name || describeSubject(subject, target), target, subject };
}

/** Serialize rules to a shareable JSON string (drops local ids; import assigns fresh ones). */
export function exportSharedMetrics(rules: CustomMetricRule[]): string {
  return JSON.stringify(
    { format: SHARE_FORMAT, version: SHARE_VERSION, rules: rules.map((r) => ({ label: r.label, target: r.target, subject: r.subject })) },
    null,
    2,
  );
}

export interface ImportResult {
  rules: CustomMetricRule[];
  errors: string[];
}

/** Coerce one arbitrary item (engine rule, preset wrapper, or raw metric/subject) into a rule. */
function itemToRule(item: unknown): CustomMetricRule {
  if (!item || typeof item !== 'object') throw new Error('not an object');
  const obj = item as Record<string, unknown>;

  // Engine rule: { target?, subject, label? }
  if (obj.subject && typeof obj.subject === 'object') {
    const subject = metricToSubject(obj.subject as MetricSubject);
    const target = normalizeTarget(obj.target);
    const label = typeof obj.label === 'string' && obj.label ? obj.label : describeSubject(subject, target);
    return { id: genId(), label, target, subject };
  }
  // Preset wrapper: { metric, name?, ... }
  if (obj.metric && typeof obj.metric === 'object') return presetToRule(obj as unknown as MetricPreset);
  // Raw template metric ({ type, ... }) or raw engine subject ({ kind, ... }).
  if (typeof obj.type === 'string' || typeof obj.kind === 'string') {
    const subject = metricToSubject(obj);
    const target = normalizeTarget(obj.target);
    const label = typeof obj.name === 'string' && obj.name ? obj.name : typeof obj.label === 'string' && obj.label ? obj.label : describeSubject(subject, target);
    return { id: genId(), label, target, subject };
  }
  throw new Error('unrecognized metric object');
}

/** Permissively parse pasted JSON (string or already-parsed) into rules + per-item error messages. */
export function normalizeSharedMetrics(input: unknown): ImportResult {
  let data = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (e) {
      return { rules: [], errors: [`invalid JSON: ${e instanceof Error ? e.message : String(e)}`] };
    }
  }

  // Find the list of candidate items across the shapes we accept.
  let items: unknown[];
  if (Array.isArray(data)) {
    items = data;
  } else if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (Array.isArray(o.rules)) items = o.rules;
    else if (Array.isArray(o.presets)) items = o.presets;
    else if (Array.isArray(o.templates)) items = o.templates;
    else if (o.metricExamples && typeof o.metricExamples === 'object') items = Object.values(o.metricExamples as object);
    else items = [o]; // a single rule / preset / metric
  } else {
    return { rules: [], errors: ['expected a JSON object or array'] };
  }

  const rules: CustomMetricRule[] = [];
  const errors: string[] = [];
  items.forEach((it, i) => {
    try {
      rules.push(itemToRule(it));
    } catch (e) {
      errors.push(`item ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  if (rules.length === 0 && errors.length === 0) errors.push('no metrics found in the pasted JSON');
  return { rules, errors };
}
