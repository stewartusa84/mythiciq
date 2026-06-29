<!-- (7) Custom metrics — user-defined "window discovery". Tag conditions you care about (e.g.
     "Maelstrom > 90", "charges capped", "sitting on a defensive") and the engine finds the time
     windows where each held, scoped to the selected run.

     Layout: a single always-on metric LIBRARY (curated presets + your own saved/imported metrics).
     ACTIVE metrics sit above the library (evaluated, with results, drawn on the replay timeline);
     the same metric shows "selected" in the library. Toggle a library row to activate/deactivate.
     Create a brand-new metric with the Create button (opens an explained modal); click any library
     row to edit it in that same modal. Clicking outside the modal (or Escape / Done) saves. -->
<script lang="ts">
  import {
    POWER_TYPES,
    presetToRule,
    normalizeSharedMetrics,
    exportSharedMetrics,
    type ParserClient,
    type CustomMetricRule,
    type MetricSubject,
    type MetricTarget,
    type CustomMetricsReport,
    type OwnerInfo,
    type MetricPreset,
  } from '@wow/engine';
  import presetLibrary from '@wow/data/metric-presets';
  import { mmss } from '../mvp/report.js';
  import WowheadLink from '../mvp/WowheadLink.svelte';

  type WindowLite = { label: string; startMs: number; endMs: number; unitName?: string; detail?: string; color?: string; spellId?: number; id?: string };
  // Per-metric colors (by rule order) — shared with the replay's stacked metric bands.
  const PALETTE = ['#e8a000', '#3a8fd0', '#5bb85b', '#c0504d', '#8064a2', '#16a3a3', '#d06fb0', '#9c8b3a'];
  const colorFor = (i: number) => PALETTE[i % PALETTE.length]!;
  // Stable capital-letter designation per metric (A, B, C…; AA, AB… past 26) — the identifier shared
  // between this rule table and the replay's metric lanes, easier to match than a bare color.
  const idFor = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(65 + Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
  let {
    client,
    runIndex,
    owner,
    firstMs,
    onWindows,
    // Heading text. Defaults to the /diag panel number; the MVP Insights tab passes a clean title.
    title = '7 · Custom metrics',
  }: {
    client: ParserClient | null;
    runIndex: number;
    owner: OwnerInfo | null;
    firstMs: number;
    onWindows: (w: WindowLite[]) => void;
    title?: string;
  } = $props();

  // ---- active metrics (evaluated + drawn on the replay) ----
  const LS_KEY = 'customMetricRules';
  const load = (): CustomMetricRule[] => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? (JSON.parse(raw) as CustomMetricRule[]) : [];
    } catch {
      return [];
    }
  };
  let rules = $state<CustomMetricRule[]>(load());
  const persist = () => localStorage.setItem(LS_KEY, JSON.stringify(rules));

  let report = $state<CustomMetricsReport | null>(null);
  let error = $state<string | null>(null);
  // Reactive ruleId → result lookup (re-derives whenever a new report arrives).
  let resultsById = $derived(new Map((report?.results ?? []).map((r) => [r.ruleId, r])));

  // Signature = target + (order-independent) subject. Identifies "the same metric" so the library can
  // mark active rows as selected and toggling can find/remove the matching active rule.
  function sigOf(target: MetricTarget, subject: MetricSubject): string {
    const keys = Object.keys(subject).sort();
    const norm: Record<string, unknown> = {};
    for (const k of keys) norm[k] = (subject as Record<string, unknown>)[k];
    const t = typeof target === 'string' ? target : JSON.stringify(target);
    return t + '|' + JSON.stringify(norm);
  }
  const ruleSig = (r: CustomMetricRule) => sigOf(r.target, r.subject);
  let activeSigs = $derived(new Set(rules.map(ruleSig)));

  // ---- modal form state (create + edit) ----
  let kind = $state<MetricSubject['kind']>('resource');
  let target = $state<'self' | 'players' | 'enemies'>('self');
  let powerType = $state(11); // Maelstrom
  let cmp = $state<'>' | '>=' | '<' | '<='>('>');
  let value = $state<number | null>(null); // empty by default → not addable until filled in
  let spellId = $state(0);
  let minStacks = $state(1);
  let auraType = $state<'' | 'BUFF' | 'DEBUFF'>('');
  let inCombatOnly = $state(true);
  let cooldownSeconds = $state(120);
  let minIdleSeconds = $state(5);
  let maxCharges = $state(2);
  let rechargeSeconds = $state(30);
  let minTargets = $state(3); // targets-hit: flag casts that hit fewer than this many enemies
  let windowSeconds = $state(1);
  let labelInput = $state(''); // optional metric name (blank → auto-derived)

  // What the modal is editing. `lib` = a saved metric (id); `active` = an active rule with no library
  // backing (legacy); `new` = create OR forking a preset (saves a fresh copy on Done).
  type EditTarget =
    | { mode: 'new' }
    | { mode: 'lib'; id: string; oldSig: string }
    | { mode: 'active'; id: string; oldSig: string };
  let editing = $state<EditTarget | null>(null);

  let powerName = $derived(POWER_TYPES.find((p) => p.id === powerType)?.name ?? `power ${powerType}`);

  // Whether the current form has enough filled in to form a valid metric.
  let formValid = $derived.by(() => {
    switch (kind) {
      case 'resource':
        return Number.isFinite(value);
      case 'aura':
      case 'aura-missing':
        return spellId > 0;
      case 'cooldown':
        return spellId > 0 && cooldownSeconds > 0;
      case 'charges':
        return spellId > 0 && maxCharges > 0 && rechargeSeconds > 0;
      case 'targets-hit':
        return spellId > 0 && minTargets > 0;
    }
  });

  function buildSubject(): MetricSubject {
    switch (kind) {
      case 'resource':
        return { kind, powerType, cmp, value: value ?? 0 };
      case 'aura':
        return { kind, spellId, minStacks, ...(auraType ? { auraType } : {}) };
      case 'aura-missing':
        return { kind, spellId, ...(auraType ? { auraType } : {}), inCombatOnly };
      case 'cooldown':
        return { kind, spellId, cooldownSeconds, minIdleSeconds };
      case 'charges':
        return { kind, spellId, maxCharges, rechargeSeconds };
      case 'targets-hit':
        return { kind, spellId, minTargets, windowMs: Math.round(windowSeconds * 1000) };
    }
  }
  function defaultLabel(s: MetricSubject): string {
    const who = target === 'self' ? '' : `${target} `;
    if (s.kind === 'resource') return `${who}${POWER_TYPES.find((p) => p.id === s.powerType)?.name ?? `power ${s.powerType}`} ${s.cmp} ${s.value}`;
    if (s.kind === 'aura') return `${who}aura ${s.spellId}${(s.minStacks ?? 1) > 1 ? ` ≥${s.minStacks}` : ''}`;
    if (s.kind === 'aura-missing') return `${who}${s.spellId} MISSING${s.inCombatOnly ? ' (in combat)' : ''}`;
    if (s.kind === 'cooldown') return `${who}sitting on ${s.spellId} (${s.cooldownSeconds}s CD)`;
    if (s.kind === 'targets-hit') return `${who}${s.spellId} hit <${s.minTargets} targets`;
    return `${who}${s.spellId} charges capped (${s.maxCharges}×${s.rechargeSeconds}s)`;
  }

  /** The spell id a rule targets (null for resource rules, which have none). */
  function subjectSpellId(r: CustomMetricRule): number | null {
    return r.subject.kind !== 'resource' ? r.subject.spellId : null;
  }
  /** Human descriptor WITHOUT the raw spell id — the spell is shown separately as a Wowhead icon/name. */
  function ruleText(r: CustomMetricRule): string {
    const who = r.target === 'self' ? '' : `${r.target} `;
    const s = r.subject;
    switch (s.kind) {
      case 'resource':
        return `${who}${POWER_TYPES.find((p) => p.id === s.powerType)?.name ?? `power ${s.powerType}`} ${s.cmp} ${s.value}`;
      case 'aura':
        return `${who}up${(s.minStacks ?? 1) > 1 ? ` ≥${s.minStacks}` : ''}${s.auraType ? ` (${s.auraType.toLowerCase()})` : ''}`;
      case 'aura-missing':
        return `${who}missing${s.inCombatOnly ? ' (in combat)' : ''}`;
      case 'cooldown':
        return `${who}unused (${s.cooldownSeconds}s CD)`;
      case 'charges':
        return `${who}charges capped (${s.maxCharges}×${s.rechargeSeconds}s)`;
      case 'targets-hit':
        return `${who}hit <${s.minTargets} targets`;
    }
  }

  // Plain-English explainer for each metric kind, shown in the modal.
  const KIND_HELP: Record<MetricSubject['kind'], string> = {
    resource:
      'Finds every window where a resource (Maelstrom, Insanity, Runic Power…) stayed above or below a threshold — e.g. capped resources you were wasting.',
    aura: 'Finds every window a buff or debuff was active, optionally at a minimum stack count.',
    'aura-missing':
      'Finds the gaps where a buff you normally keep up had dropped — e.g. a missing Bone Shield. Only counts units that used the buff at least once.',
    cooldown: 'Finds the time spent sitting on a cooldown while it was available and unused.',
    charges: 'Finds the time an ability sat at max charges, wasting recharge.',
    'targets-hit':
      'Finds casts that hit fewer than N enemies — suboptimal AoE (e.g. Spinning Crane Kick or Chain Lightning on too few targets).',
  };

  // Live, plain-English preview of what the current form will find.
  let previewText = $derived.by(() => {
    if (!formValid) return 'Fill in the fields above to preview what this finds.';
    const s = buildSubject();
    const who =
      target === 'self' ? (owner ? `you (${owner.name})` : 'you') : target === 'players' ? 'any player' : 'any enemy';
    switch (s.kind) {
      case 'resource':
        return `Finds every window where ${who}'s ${powerName} is ${s.cmp} ${s.value}.`;
      case 'aura':
        return `Finds every window the aura was active on ${who}${(s.minStacks ?? 1) > 1 ? ` at ≥${s.minStacks} stacks` : ''}.`;
      case 'aura-missing':
        return `Finds the gaps where the buff was NOT up on ${who}${s.inCombatOnly ? ' (only while in combat)' : ''}.`;
      case 'cooldown':
        return `Finds the time ${who} spent sitting on the ability while off cooldown (≥${minIdleSeconds}s idle, ${s.cooldownSeconds}s CD).`;
      case 'charges':
        return `Finds the time ${who} sat at max charges (${s.maxCharges}), wasting recharge.`;
      case 'targets-hit':
        return `Finds casts by ${who} that hit fewer than ${s.minTargets} enemies within ${windowSeconds}s.`;
    }
  });

  function removeRule(id: string) {
    rules = rules.filter((r) => r.id !== id);
    commitActive();
  }
  function addRules(incoming: CustomMetricRule[]) {
    if (!incoming.length) return;
    rules = [...rules, ...incoming];
    persist();
    void evaluate();
  }
  /** Persist the active set and (re)evaluate, or clear the replay bands when empty. */
  function commitActive() {
    persist();
    if (rules.length) void evaluate();
    else {
      report = null;
      onWindows([]);
    }
  }
  /** Activate a metric if an identical one isn't already active. */
  function ensureActive(target_: MetricTarget, subject: MetricSubject, label: string) {
    const s = sigOf(target_, subject);
    if (!rules.some((r) => ruleSig(r) === s)) {
      rules = [...rules, { id: crypto.randomUUID(), label, target: target_, subject }];
      persist();
      void evaluate();
    }
  }
  function deactivateSig(s: string) {
    rules = rules.filter((r) => ruleSig(r) !== s);
    commitActive();
  }

  // Toolbar icons (Lucide line icons). `plus` = create; `download`/`upload` for import/export.
  const ICON_PLUS = '<path d="M12 5v14"/><path d="M5 12h14"/>';
  const ICON_IMPORT =
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>';
  const ICON_EXPORT =
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>';

  // ---- metric library (curated presets + your own saved/imported metrics, in one list) ----
  const PRESETS: MetricPreset[] = presetLibrary.presets ?? [];
  // Your saved metrics persist locally so an imported pack stays reusable across runs.
  const LIB_KEY = 'customMetricLibrary';
  const loadLib = (): CustomMetricRule[] => {
    try {
      const raw = localStorage.getItem(LIB_KEY);
      return raw ? (JSON.parse(raw) as CustomMetricRule[]) : [];
    } catch {
      return [];
    }
  };
  let userLib = $state<CustomMetricRule[]>(loadLib());
  const persistLib = () => localStorage.setItem(LIB_KEY, JSON.stringify(userLib));
  // Dedup signature: same target + subject + label = the same metric.
  const libSig = (r: CustomMetricRule) => JSON.stringify([r.target, r.subject, r.label]);
  function saveToLibrary(incoming: CustomMetricRule[]) {
    const have = new Set(userLib.map(libSig));
    const add = incoming.filter((r) => !have.has(libSig(r))).map((r) => ({ ...r }));
    if (add.length) {
      userLib = [...add, ...userLib]; // newest first
      persistLib();
    }
  }
  function removeFromLibrary(id: string) {
    userLib = userLib.filter((r) => r.id !== id);
    persistLib();
  }

  let fClass = $state('all');
  let fSpec = $state('all');
  let fRole = $state('all');
  let fTag = $state('all');
  let search = $state('');

  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  // A preset can apply to many specs (identical metrics are merged into one entry — see the importer).
  type Applies = { class: string; spec: string; role: string };
  const appliesOf = (p: MetricPreset): Applies[] => p.applies ?? [{ class: p.class, spec: p.spec, role: p.role }];
  function scopeLabel(applies: Applies[]): string {
    if (applies.length <= 1) return applies[0] ? `${applies[0].class} · ${applies[0].spec}` : '';
    const cls = uniq(applies.map((a) => a.class));
    if (cls.length === 1) return `${cls[0]} · ${uniq(applies.map((a) => a.spec)).length} specs`;
    return `${cls.length} classes · ${applies.length} specs`;
  }
  let classes = $derived(uniq(PRESETS.flatMap((p) => appliesOf(p).map((a) => a.class))));
  let specs = $derived(uniq(PRESETS.flatMap((p) => appliesOf(p).filter((a) => fClass === 'all' || a.class === fClass).map((a) => a.spec))));
  let roles = $derived(uniq(PRESETS.flatMap((p) => appliesOf(p).map((a) => a.role))));
  let tags = $derived(uniq(PRESETS.flatMap((p) => p.tags ?? [])));

  // A unified library item — a curated preset OR one of your saved/imported metrics — so both render
  // in a single list. `rule` is the underlying metric (stable id for saved; preset-derived otherwise).
  type LibItem = {
    key: string;
    mine: boolean;
    name: string;
    applies: Applies[]; // specs this metric is relevant to (empty for your saved metrics)
    description?: string; // the line under the name (scope + curator note, or your rule text)
    searchText: string;
    tags: string[];
    spellId?: number | null;
    priority?: string;
    warn?: boolean;
    warnReason?: string;
    rule: CustomMetricRule;
    sig: string;
    libId?: string; // userLib rule id (for delete/edit), present when mine
  };
  let libItems = $derived.by<LibItem[]>(() => {
    const mine: LibItem[] = userLib.map((r) => ({
      key: `u:${r.id}`,
      mine: true,
      name: r.label,
      applies: [],
      description: ruleText(r),
      searchText: `${r.label} ${ruleText(r)}`.toLowerCase(),
      tags: [],
      spellId: subjectSpellId(r),
      rule: r,
      sig: ruleSig(r),
      libId: r.id,
    }));
    const curated: LibItem[] = PRESETS.map((p) => {
      const r = presetToRule(p);
      const applies = appliesOf(p);
      const scope = scopeLabel(applies);
      return {
        key: `p:${p.id}`,
        mine: false,
        name: p.name,
        applies,
        description: `${scope}${p.description ? ` — ${p.description}` : ''}`,
        searchText: `${applies.map((a) => `${a.class} ${a.spec}`).join(' ')} ${p.name} ${p.description ?? ''}`.toLowerCase(),
        tags: p.tags ?? [],
        spellId: p.metric.spellId,
        priority: p.priority,
        warn: !!(p.requiresReview || p.talentDependent),
        warnReason: (p.reviewReasons ?? []).join(' ') || 'Base value — verify cooldown/charges for your talents & haste.',
        rule: r,
        sig: ruleSig(r),
      };
    });
    return [...mine, ...curated]; // your metrics first
  });
  // Your saved metrics are unclassified, so the class/spec/role/tag dropdowns scope the CURATED presets
  // only; yours always show (subject to the search box) so a just-imported metric stays findable. A
  // curated metric matches a class/spec/role filter if ANY of the specs it applies to matches.
  let filteredItems = $derived.by(() => {
    const q = search.trim().toLowerCase();
    return libItems.filter((it) => {
      const matchesSearch = q === '' || it.searchText.includes(q);
      if (it.mine) return matchesSearch;
      return (
        (fClass === 'all' || it.applies.some((a) => a.class === fClass)) &&
        (fSpec === 'all' || it.applies.some((a) => a.spec === fSpec)) &&
        (fRole === 'all' || it.applies.some((a) => a.role === fRole)) &&
        (fTag === 'all' || it.tags.includes(fTag)) &&
        matchesSearch
      );
    });
  });
  // Reset spec filter if it no longer belongs to the chosen class.
  $effect(() => {
    if (fSpec !== 'all' && !specs.includes(fSpec)) fSpec = 'all';
  });

  const isActive = (it: LibItem) => activeSigs.has(it.sig);
  function toggleActive(it: LibItem) {
    if (isActive(it)) deactivateSig(it.sig);
    else ensureActive(it.rule.target, it.rule.subject, it.rule.label);
  }

  // ---- modal open / close / save ----
  function resetForm() {
    kind = 'resource';
    target = 'self';
    powerType = 11;
    cmp = '>';
    value = null;
    spellId = 0;
    minStacks = 1;
    auraType = '';
    inCombatOnly = true;
    cooldownSeconds = 120;
    minIdleSeconds = 5;
    maxCharges = 2;
    rechargeSeconds = 30;
    minTargets = 3;
    windowSeconds = 1;
    labelInput = '';
  }
  function loadForm(r: CustomMetricRule) {
    target = typeof r.target === 'string' ? (r.target as 'self' | 'players' | 'enemies') : 'self';
    labelInput = r.label ?? '';
    const s = r.subject;
    kind = s.kind;
    if (s.kind === 'resource') {
      powerType = s.powerType;
      cmp = s.cmp;
      value = s.value;
    } else if (s.kind === 'aura') {
      spellId = s.spellId;
      minStacks = s.minStacks ?? 1;
      auraType = s.auraType ?? '';
    } else if (s.kind === 'aura-missing') {
      spellId = s.spellId;
      auraType = s.auraType ?? '';
      inCombatOnly = s.inCombatOnly !== false;
    } else if (s.kind === 'cooldown') {
      spellId = s.spellId;
      cooldownSeconds = s.cooldownSeconds;
      minIdleSeconds = s.minIdleSeconds ?? 5;
    } else if (s.kind === 'charges') {
      spellId = s.spellId;
      maxCharges = s.maxCharges;
      rechargeSeconds = s.rechargeSeconds;
    } else if (s.kind === 'targets-hit') {
      spellId = s.spellId;
      minTargets = s.minTargets;
      windowSeconds = (s.windowMs ?? 1000) / 1000;
    }
  }
  function openCreate() {
    resetForm();
    error = null;
    editing = { mode: 'new' };
  }
  function openEditItem(it: LibItem) {
    loadForm(it.rule);
    error = null;
    editing = it.mine ? { mode: 'lib', id: it.libId!, oldSig: it.sig } : { mode: 'new' };
  }
  function editActive(r: CustomMetricRule) {
    loadForm(r);
    error = null;
    const match = userLib.find((u) => ruleSig(u) === ruleSig(r));
    editing = match ? { mode: 'lib', id: match.id, oldSig: ruleSig(r) } : { mode: 'active', id: r.id, oldSig: ruleSig(r) };
  }

  function saveModal() {
    if (!formValid || !editing) return;
    const subject = buildSubject();
    const t: MetricTarget = target;
    const label = labelInput.trim() || defaultLabel(subject);
    const e = editing;
    if (e.mode === 'new') {
      // Create (or fork a preset): keep a saved copy in the library + activate it.
      const rule: CustomMetricRule = { id: crypto.randomUUID(), label, target: t, subject };
      saveToLibrary([rule]); // dedupes — unchanged preset edits don't pile up copies
      ensureActive(t, subject, label);
    } else if (e.mode === 'lib') {
      const updated: CustomMetricRule = { id: e.id, label, target: t, subject };
      userLib = userLib.map((r) => (r.id === e.id ? updated : r));
      persistLib();
      // Keep any active rule that mirrored the old metric in sync.
      if (activeSigs.has(e.oldSig)) {
        rules = rules.map((r) => (ruleSig(r) === e.oldSig ? { ...r, label, target: t, subject } : r));
        commitActive();
      }
    } else {
      // Editing an active-only rule (no library backing): update it in place.
      rules = rules.map((r) => (r.id === e.id ? { ...r, label, target: t, subject } : r));
      commitActive();
    }
  }
  function closeModal(save: boolean) {
    if (save) saveModal();
    editing = null;
  }
  function deleteFromModal() {
    const e = editing;
    if (!e) return;
    if (e.mode === 'lib') {
      removeFromLibrary(e.id);
      if (activeSigs.has(e.oldSig)) deactivateSig(e.oldSig);
    } else if (e.mode === 'active') {
      removeRule(e.id);
    }
    editing = null;
  }

  // ---- import / export (share metric packs as JSON) ----
  let showImport = $state(false);
  let importText = $state('');
  let importMsg = $state<string | null>(null);
  function doImport() {
    const { rules: imported, errors } = normalizeSharedMetrics(importText);
    saveToLibrary(imported); // keep them in your Library for reuse…
    addRules(imported); // …and activate them now
    importMsg =
      (imported.length ? `added ${imported.length} metric${imported.length === 1 ? '' : 's'} (saved to your library + active)` : 'no metrics added') +
      (errors.length ? ` · ${errors.length} skipped: ${errors.join('; ')}` : '');
    if (imported.length) {
      importText = '';
      showImport = false;
    }
  }

  let showExport = $state(false);
  let exportText = $derived(rules.length ? exportSharedMetrics(rules) : '');
  let copied = $state(false);
  async function copyExport() {
    try {
      await navigator.clipboard.writeText(exportText);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      copied = false;
    }
  }

  async function evaluate() {
    error = null;
    if (!client || rules.length === 0) {
      onWindows([]);
      return;
    }
    if (typeof client.evaluateMetrics !== 'function') {
      // Stale client instance (usually after a dev hot-reload). A full page reload fixes it.
      error = 'parser client is out of date — hard-reload the page (Ctrl+Shift+R) and re-load the log.';
      return;
    }
    try {
      // Plain-clone the reactive rules so structured-clone never trips on Svelte state proxies.
      const report_ = await client.evaluateMetrics(JSON.parse(JSON.stringify(rules)), runIndex);
      report = report_;
      const flat: WindowLite[] = [];
      // results order matches rules order, so the result index gives each metric its stable color.
      report_.results.forEach((r, ri) => {
        const color = colorFor(ri);
        const id = idFor(ri);
        const rule = rules[ri]; // results order matches rules order
        const sp = rule ? subjectSpellId(rule) : null;
        const label = rule ? ruleText(rule) : r.label;
        for (const w of r.windows) flat.push({ label, id, startMs: w.startMs, endMs: w.endMs, unitName: w.unitName, color, ...(sp ? { spellId: sp } : {}), ...(w.detail ? { detail: w.detail } : {}) });
      });
      onWindows(flat);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  // Re-evaluate when the run changes (rules persist; results are per-run).
  $effect(() => {
    runIndex;
    if (rules.length) void evaluate();
    else onWindows([]);
  });

  const fmt = (ms: number) => mmss(ms - firstMs);
  const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
</script>

<svelte:window onkeydown={(e) => { if (editing && e.key === 'Escape') closeModal(true); }} />

{#snippet ico(d: string)}
  <svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html d}</svg>
{/snippet}

<section class="section">
  <h2>{title}{#if owner}<span class="muted"> · you: {owner.name}</span>{/if}</h2>

  <div class="tools">
    <button class="primary" onclick={openCreate}>{@render ico(ICON_PLUS)} Create metric</button>
    <button class:active={showImport} onclick={() => (showImport = !showImport)}>{@render ico(ICON_IMPORT)} Import</button>
    <button class:active={showExport} onclick={() => (showExport = !showExport)} disabled={!rules.length}>{@render ico(ICON_EXPORT)} Export</button>
  </div>

  {#if error}<div class="err">⚠ {error}</div>{/if}
  {#if rules.some((r) => r.target === 'self') && !owner}
    <div class="err">⚠ couldn't detect the recording player (no MINE-affiliation unit) — "self" rules will match nothing; try a specific target.</div>
  {/if}

  {#if showImport}
    <div class="share">
      <div class="muted">Paste shared metrics JSON — an exported pack, a single engine rule, or a preset (one object or an array). They're saved to your Library and activated.</div>
      <textarea bind:value={importText} rows="6" spellcheck="false" placeholder={'{ "format": "wow-mplus-custom-metrics", "rules": [ … ] }'}></textarea>
      <div class="sharebtns">
        <button onclick={doImport} disabled={!client || !importText.trim()}>Import</button>
        {#if importMsg}<span class="muted">{importMsg}</span>{/if}
      </div>
    </div>
  {/if}

  {#if showExport && rules.length}
    <div class="share">
      <div class="muted">Copy this to share your {rules.length} metric{rules.length === 1 ? '' : 's'} (ids are regenerated on import).</div>
      <textarea readonly rows="6" spellcheck="false" value={exportText}></textarea>
      <div class="sharebtns"><button onclick={copyExport}>{copied ? '✓ copied' : 'Copy to clipboard'}</button></div>
    </div>
  {/if}

  <!-- WATCHLIST — the metrics you're tracking: evaluated, with results, drawn on the replay timeline. -->
  <div class="seclabel">Watchlist{#if rules.length}<span class="count">{rules.length}</span>{/if}</div>
  {#if rules.length === 0}
    <div class="muted empty2">Nothing on your watchlist yet. Add a metric from the Library below, or <button class="linkbtn" onclick={openCreate}>create your own</button>.</div>
  {:else}
    <div class="rules">
      {#each rules as r, ri (r.id)}
        {@const res = resultsById.get(r.id)}
        {@const sp = subjectSpellId(r)}
        <div class="rule">
          <div class="rhead">
            <span class="mid" style="background:{colorFor(ri)}" title="identifier {idFor(ri)} — matches the replay timeline lane">{idFor(ri)}</span>
            <button class="rtext astext" onclick={() => editActive(r)} title="edit this metric">
              {#if sp}<span class="rspell"><WowheadLink id={sp} /></span>{/if}<span class="rname">{r.label}</span>{#if res?.note}<span class="muted"> — {res.note}</span>{/if}
            </button>
            <button class="x" title="stop watching" onclick={() => removeRule(r.id)}>✕</button>
          </div>
          <div class="rstats">
            <span><b>{res?.windowCount ?? '—'}</b> windows</span>
            <span><b>{res ? secs(res.totalDurationMs) : '—'}</b> total</span>
            <span><b>{res ? res.pctOfRange.toFixed(1) + '%' : '—'}</b> of run</span>
            <span><b>{res ? secs(res.longestMs) : '—'}</b> longest</span>
          </div>
          {#if res && res.windows.length}
            <div class="winchips">
              {#each res.windows.slice(0, 40) as w (w.unitId + ':' + w.startMs)}
                <span class="winchip" title="{w.unitName} · {w.detail ?? ''}">{w.unitName !== owner?.name ? w.unitName + ' ' : ''}{fmt(w.startMs)}→{fmt(w.endMs)} ({secs(w.durationMs)})</span>
              {/each}
              {#if res.windows.length > 40}<span class="muted">+{res.windows.length - 40} more</span>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    <div class="muted hint">Discovered windows are drawn on the replay timeline — click one there to jump.</div>
  {/if}

  <!-- LIBRARY — always shown. Curated presets + your saved/imported metrics, one list. -->
  <div class="seclabel lib-label">Library <span class="muted">— click a metric to edit · watch to track it</span></div>
  <div class="lib">
    <div class="libfilters">
      <select bind:value={fClass}><option value="all">all classes</option>{#each classes as c}<option value={c}>{c}</option>{/each}</select>
      <select bind:value={fSpec}><option value="all">all specs</option>{#each specs as s}<option value={s}>{s}</option>{/each}</select>
      <select bind:value={fRole}><option value="all">all roles</option>{#each roles as r}<option value={r}>{r}</option>{/each}</select>
      <select bind:value={fTag}><option value="all">all tags</option>{#each tags as t}<option value={t}>{t}</option>{/each}</select>
      <input class="search" placeholder="search…" bind:value={search} />
      <span class="muted">{filteredItems.length} metric{filteredItems.length === 1 ? '' : 's'}</span>
    </div>
    <div class="libitems">
      {#each filteredItems as it (it.key)}
        <div class="preset" class:sel={isActive(it)}>
          <span class="pspell">{#if it.spellId}<WowheadLink id={it.spellId} />{/if}</span>
          <button class="pbody astext" onclick={() => openEditItem(it)} title="edit this metric">
            <div class="pname">
              {it.name}
              {#if it.mine}<span class="ptag mine">saved</span>{/if}
              {#if it.priority}<span class="ptag {it.priority}">{it.priority}</span>{/if}
              {#if it.warn}<span class="pwarn" title={it.warnReason}>⚠</span>{/if}
            </div>
            {#if it.description}<div class="pdesc muted">{it.description}</div>{/if}
          </button>
          <div class="pactions">
            {#if it.mine}<button class="pdel" title="Remove from library" aria-label="Remove from library" onclick={() => removeFromLibrary(it.libId!)}>✕</button>{/if}
            <button class="ptoggle" class:on={isActive(it)} onclick={() => toggleActive(it)} disabled={!client}>{isActive(it) ? '✓ watching' : '+ watch'}</button>
          </div>
        </div>
      {/each}
      {#if filteredItems.length === 0}<div class="muted empty">No metrics match those filters.</div>{/if}
    </div>
  </div>
</section>

<!-- Create / edit modal — an overlay so the form has room to breathe and explain itself. -->
{#if editing}
  <div class="modal-backdrop" role="presentation" onclick={() => closeModal(true)} onkeydown={() => {}}>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Edit metric" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
      <div class="modal-head">
        <span>{editing.mode === 'lib' || editing.mode === 'active' ? 'Edit metric' : 'Create metric'}</span>
        <button class="mx" title="close" aria-label="Close" onclick={() => closeModal(false)}>✕</button>
      </div>
      <div class="modal-body">
        <div class="field">
          <span class="flabel">When</span>
          <select bind:value={kind}>
            <option value="resource">a resource is above/below a value</option>
            <option value="aura">an aura (buff/debuff) is up</option>
            <option value="aura-missing">a buff is missing</option>
            <option value="cooldown">sitting on a cooldown</option>
            <option value="charges">charges are capped</option>
            <option value="targets-hit">a cast hit too few targets</option>
          </select>
        </div>
        <div class="help">{KIND_HELP[kind]}</div>

        <div class="field">
          <span class="flabel">For</span>
          <select bind:value={target}>
            <option value="self">myself{owner ? ` (${owner.name})` : ''}</option>
            <option value="players">all players</option>
            <option value="enemies">enemies</option>
          </select>
        </div>

        {#if kind === 'resource'}
          <div class="field">
            <span class="flabel">Resource</span>
            <select bind:value={powerType}>
              {#each POWER_TYPES as p}<option value={p.id}>{p.name}</option>{/each}
            </select>
          </div>
          <div class="field">
            <span class="flabel">Is</span>
            <div class="inline">
              <select bind:value={cmp} class="cmp"><option value=">">&gt;</option><option value=">=">&ge;</option><option value="<">&lt;</option><option value="<=">&le;</option></select>
              <input type="number" bind:value class="num" placeholder="value" />
            </div>
          </div>
        {:else if kind === 'aura'}
          <div class="field">
            <span class="flabel">Spell ID</span>
            <input type="number" bind:value={spellId} class="num" placeholder="e.g. 12345" />
          </div>
          <div class="field">
            <span class="flabel">Min stacks</span>
            <input type="number" bind:value={minStacks} class="num" min="1" />
          </div>
          <div class="field">
            <span class="flabel">Aura type</span>
            <select bind:value={auraType}><option value="">any</option><option value="BUFF">buff</option><option value="DEBUFF">debuff</option></select>
          </div>
        {:else if kind === 'aura-missing'}
          <div class="field">
            <span class="flabel">Spell ID</span>
            <input type="number" bind:value={spellId} class="num" placeholder="e.g. 12345" />
          </div>
          <div class="field">
            <span class="flabel">Aura type</span>
            <select bind:value={auraType}><option value="">any</option><option value="BUFF">buff</option><option value="DEBUFF">debuff</option></select>
          </div>
          <div class="field">
            <span class="flabel"></span>
            <label class="check" title="only flag gaps while the unit is in combat"><input type="checkbox" bind:checked={inCombatOnly} /> only while in combat</label>
          </div>
        {:else if kind === 'cooldown'}
          <div class="field">
            <span class="flabel">Spell ID</span>
            <input type="number" bind:value={spellId} class="num" placeholder="e.g. 12345" />
          </div>
          <div class="field">
            <span class="flabel">Cooldown</span>
            <div class="inline"><input type="number" bind:value={cooldownSeconds} class="num" /><span class="unit">sec</span></div>
          </div>
          <div class="field">
            <span class="flabel">Idle at least</span>
            <div class="inline"><input type="number" bind:value={minIdleSeconds} class="num" /><span class="unit">sec</span></div>
          </div>
        {:else if kind === 'charges'}
          <div class="field">
            <span class="flabel">Spell ID</span>
            <input type="number" bind:value={spellId} class="num" placeholder="e.g. 12345" />
          </div>
          <div class="field">
            <span class="flabel">Max charges</span>
            <input type="number" bind:value={maxCharges} class="num" />
          </div>
          <div class="field">
            <span class="flabel">Recharge</span>
            <div class="inline"><input type="number" bind:value={rechargeSeconds} class="num" /><span class="unit">sec</span></div>
          </div>
        {:else}
          <div class="field">
            <span class="flabel">Spell ID</span>
            <input type="number" bind:value={spellId} class="num" placeholder="e.g. 101546 (SCK)" />
          </div>
          <div class="field">
            <span class="flabel">Min targets</span>
            <input type="number" bind:value={minTargets} class="num" min="1" title="flag casts that hit FEWER than this many enemies" />
          </div>
          <div class="field">
            <span class="flabel">Within</span>
            <div class="inline"><input type="number" bind:value={windowSeconds} class="num" min="0.1" step="0.1" /><span class="unit">sec</span></div>
          </div>
        {/if}

        {#if kind !== 'resource' && spellId > 0}
          <div class="field">
            <span class="flabel">Spell</span>
            <span class="spellprev" title="spell {spellId}"><WowheadLink id={spellId} /></span>
          </div>
        {/if}

        <div class="field">
          <span class="flabel">Name</span>
          <input bind:value={labelInput} class="num" placeholder={formValid ? defaultLabel(buildSubject()) : 'optional name'} />
        </div>

        <div class="preview">{previewText}</div>
      </div>
      <div class="modal-foot">
        {#if editing.mode === 'lib' || editing.mode === 'active'}<button class="del" onclick={deleteFromModal}>Delete</button>{/if}
        <span class="foot-spacer"></span>
        <button class="primary" onclick={() => closeModal(true)} disabled={!formValid}>Done</button>
        <button class="ghost" onclick={() => closeModal(false)}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .muted { opacity: 0.65; }

  /* Toolbar */
  .tools { display: flex; gap: 6px; margin: 2px 0 10px; }
  .tools button { display: inline-flex; align-items: center; gap: 5px; }
  .tools button.active { outline: 2px solid currentColor; outline-offset: -2px; }
  .ti { width: 15px; height: 15px; flex: none; }
  .primary { font-weight: 700; }

  /* Section labels */
  .seclabel { display: flex; align-items: center; gap: 8px; font-size: 12.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.75; margin: 12px 0 6px; }
  .seclabel.lib-label { margin-top: 16px; }
  .seclabel .muted { font-weight: 400; text-transform: none; letter-spacing: 0; }
  .count { font-weight: 700; background: rgba(127, 127, 127, 0.18); border-radius: 10px; padding: 0 7px; font-size: 11px; }
  .empty2 { font-size: 12.5px; padding: 4px 0; }
  .linkbtn { background: none; border: none; padding: 0; color: var(--accent, #2e6fd6); cursor: pointer; font: inherit; text-decoration: underline; }

  /* Text-only buttons (active card body, library row body) — strip the button chrome. */
  .astext { background: none; border: none; padding: 0; margin: 0; font: inherit; text-align: left; color: inherit; cursor: pointer; width: 100%; }

  /* Form field layout (shared by the modal). */
  .field { display: grid; grid-template-columns: 110px 1fr; align-items: center; gap: 8px; }
  .flabel { font-size: 12px; text-align: right; opacity: 0.8; }
  .field > select, .field > input { width: 100%; box-sizing: border-box; }
  .inline { display: flex; align-items: center; gap: 6px; }
  .inline .num { flex: 1; }
  .cmp { flex: 0 0 auto; width: auto; }
  .unit { font-size: 11px; opacity: 0.6; }
  .check { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; }
  .spellprev { display: inline-flex; align-items: center; font-size: 12px; }
  .spellprev :global(a) { text-decoration: none; }
  .num { width: 100%; min-width: 0; box-sizing: border-box; }
  .x { color: crimson; border: none; background: none; cursor: pointer; }

  /* Active metric result cards. */
  .rules { display: flex; flex-direction: column; gap: 7px; }
  .rule { border: 1px solid #ddd; border-radius: 6px; padding: 6px 8px; }
  .rhead { display: flex; align-items: center; gap: 6px; }
  .rtext { flex: 1; min-width: 0; font-size: 12.5px; line-height: 1.3; }
  .rtext:hover .rname { text-decoration: underline; }
  .rspell { margin-right: 5px; }
  .rspell :global(a) { text-decoration: none; font-weight: 600; }
  .rhead .x { flex: 0 0 auto; line-height: 1; }
  .rstats { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 5px; font-size: 11.5px; opacity: 0.85; }
  .rstats b { font-variant-numeric: tabular-nums; }
  .winchips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 6px; }
  .hint { font-size: 11.5px; margin-top: 8px; }
  .winchip { background: #fff3df; border: 1px solid #e8c98a; padding: 0 4px; font-size: 11px; }
  /* Metric identifier badge: a colored chip carrying the capital-letter designation (A, B, C…) that
     also labels this metric's lane on the replay timeline — so a row and its band match at a glance. */
  .mid {
    display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px;
    padding: 0 3px; border-radius: 3px; vertical-align: middle; color: #1a1a1a;
    font-size: 11px; font-weight: 800; line-height: 1; font-variant-numeric: tabular-nums; flex: 0 0 auto;
  }
  .err { color: #b00; background: #fdeaea; border: 1px solid #e0b4b4; padding: 3px 6px; margin: 4px 0; font-size: 12px; }

  /* Library list */
  .lib, .share { border: 1px solid #ccc; border-radius: 6px; padding: 8px; margin-bottom: 8px; }
  .libfilters { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 8px; }
  .libfilters .search { flex: 1; min-width: 120px; }
  .libitems { display: flex; flex-direction: column; gap: 3px; max-height: 360px; overflow-y: auto; }
  /* Fixed-width spell column so every title/description left-aligns regardless of spell-name length
     (and rows with no spell still align — the column is reserved). */
  .preset { display: grid; grid-template-columns: 168px minmax(0, 1fr) auto; align-items: center; column-gap: 8px; padding: 4px 6px; border-radius: 5px; }
  .preset:hover { background: rgba(127, 127, 127, 0.08); }
  .preset.sel { background: rgba(80, 140, 210, 0.14); }
  .pspell { display: inline-flex; align-items: center; min-width: 0; overflow: hidden; }
  .pspell :global(a) { text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .pactions { display: inline-flex; align-items: center; gap: 6px; justify-content: flex-end; }
  .pbody { min-width: 0; }
  .pbody:hover .pname { text-decoration: underline; }
  .pname { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
  .pdesc { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ptag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; padding: 0 5px; border-radius: 8px; font-weight: 700; border: 1px solid currentColor; }
  .ptag.core { color: #2e8b57; }
  .ptag.advanced { color: #b8860b; }
  .ptag.mine { color: var(--accent, #2e6fd6); }
  .pwarn { cursor: help; color: #d08400; }
  .ptoggle { flex-shrink: 0; font-size: 12px; }
  .ptoggle.on { color: #2e8b57; border-color: currentColor; font-weight: 700; }
  .pdel { flex-shrink: 0; background: none; border: none; cursor: pointer; color: var(--bad, crimson); font-size: 12px; padding: 0 2px; }
  .empty { padding: 6px; }
  .share textarea { width: 100%; box-sizing: border-box; font-family: ui-monospace, monospace; font-size: 12px; resize: vertical; }
  .sharebtns { display: flex; align-items: center; gap: 8px; margin-top: 6px; }

  /* Modal */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px; }
  .modal { background: #fff; color: #1a1a1a; border-radius: 10px; width: min(520px, 100%); max-height: 90vh; overflow: auto; box-shadow: 0 12px 48px rgba(0, 0, 0, 0.35); display: flex; flex-direction: column; }
  .modal-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid #e2e2e2; font-weight: 700; font-size: 15px; }
  .modal-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 9px; }
  .help { font-size: 12.5px; line-height: 1.45; opacity: 0.85; background: rgba(127, 127, 127, 0.1); border-radius: 6px; padding: 8px 10px; }
  .preview { font-size: 13px; line-height: 1.4; font-weight: 600; margin-top: 2px; }
  .modal-foot { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid #e2e2e2; }
  .foot-spacer { flex: 1; }
  .mx { background: none; border: none; cursor: pointer; font-size: 16px; color: inherit; line-height: 1; }
  .modal .del { color: crimson; }
</style>
