<!-- Compact, dark, recursive renderer for analytic result values that don't (yet) have a bespoke MVP
     panel — used by Role Review and the extra Mechanics analytics. Handles the shapes our analytics
     actually produce: primitives, {name/id, value} ranking arrays (→ inline list), object maps
     (→ key/value rows), and falls back to compact JSON for anything unexpected. Self-imports for nesting. -->
<script lang="ts">
  import Self from './MetricView.svelte';
  import { abbrev } from './report.js';
  import { anon } from './anon.svelte.js';

  let { value, depth = 0 }: { value: unknown; depth?: number } = $props();

  const isPrimitive = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  function fmt(v: unknown): string {
    if (typeof v === 'number') {
      if (Math.abs(v) >= 1000) return abbrev(v);
      if (Number.isInteger(v)) return String(v);
      return v.toFixed(1);
    }
    if (v === null) return '—';
    // Strings may be player names (e.g. byUnit rankings) — anon.name only masks known roster names.
    return anon.name(String(v));
  }
  // A "ranking row" like { name|id, value } that we can show as name … value.
  function rankRow(v: unknown): { label: string; value: number } | null {
    if (v && typeof v === 'object' && 'value' in v && typeof (v as Record<string, unknown>).value === 'number') {
      const o = v as Record<string, unknown>;
      const label = (o.name ?? o.label ?? o.id ?? '?') as string | number;
      return { label: String(label), value: o.value as number };
    }
    return null;
  }
  let entries = $derived(value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as object) : []);
</script>

{#if isPrimitive(value)}
  <span class="prim">{fmt(value)}</span>
{:else if Array.isArray(value)}
  {#if value.length === 0}
    <span class="muted">none</span>
  {:else if value.every((v) => rankRow(v))}
    <div class="ranks">
      {#each value.slice(0, 12) as v}
        {@const r = rankRow(v)}
        <div class="rank"><span class="rl">{anon.name(r?.label)}</span><span class="rv">{fmt(r?.value)}</span></div>
      {/each}
    </div>
  {:else if value.every(isPrimitive)}
    <span>{value.map(fmt).join(', ')}</span>
  {:else}
    <div class="nest">{#each value.slice(0, 12) as v}<div class="row"><Self value={v} depth={depth + 1} /></div>{/each}</div>
  {/if}
{:else if value && typeof value === 'object'}
  <div class="kv">
    {#each entries as [k, v] (k)}
      <div class="krow">
        <span class="k">{k}</span>
        <span class="v">
          {#if isPrimitive(v)}<span class="prim">{fmt(v)}</span>{:else}<Self value={v} depth={depth + 1} />{/if}
        </span>
      </div>
    {/each}
  </div>
{:else}
  <span class="muted">—</span>
{/if}

<style>
  .prim { font-variant-numeric: tabular-nums; }
  .muted { color: var(--muted); }
  .kv { display: flex; flex-direction: column; gap: 2px; }
  .krow { display: grid; grid-template-columns: minmax(120px, 220px) 1fr; gap: 10px; align-items: baseline; }
  .krow > .k { color: var(--muted); font-size: 12px; }
  .ranks { display: flex; flex-direction: column; gap: 2px; }
  .rank { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
  .rank .rv { font-variant-numeric: tabular-nums; color: var(--muted); }
  .nest { display: flex; flex-direction: column; gap: 4px; }
  .nest .row { border-left: 2px solid var(--border); padding-left: 8px; }
</style>
