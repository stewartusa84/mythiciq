<!-- Insights tab: user-defined custom metrics (window discovery). Discovered windows are lifted to App
     and drawn as colored bands on the replay drawer's timeline. More insight panels will land here. -->
<script lang="ts">
  import type { ParserClient, OwnerInfo } from '@wow/engine';
  import CustomMetrics from '../../panels/CustomMetrics.svelte';

  type WindowLite = { label: string; startMs: number; endMs: number; unitName?: string; detail?: string; color?: string; spellId?: number; id?: string };
  let {
    client,
    runIndex,
    owner,
    firstMs,
    onWindows,
  }: {
    client: ParserClient | null;
    runIndex: number;
    owner: OwnerInfo | null;
    firstMs: number;
    onWindows: (w: WindowLite[]) => void;
  } = $props();
</script>

<div class="insights">
  <p class="lead muted">
    Tag a condition (resource threshold, buff up/down, cooldown idle, charges capped) and the engine finds
    the time windows where it held. Discovered windows appear as colored bands on the Deep Dive replay.
  </p>
  <CustomMetrics {client} {runIndex} {owner} {firstMs} {onWindows} title="Custom metrics" />
</div>

<style>
  /* CustomMetrics is the shared diagnostic panel (light on /diag). Here it's re-skinned to the dark MVP
     theme via :global() overrides keyed off the MVP tokens — the component itself is left untouched.
     `color-scheme: dark` makes native controls (select popups, checkboxes, number spinners) render dark. */
  .insights { display: flex; flex-direction: column; gap: 10px; color-scheme: dark; }
  .lead { font-size: 13px; margin: 0; }

  .insights :global(.section) {
    background: var(--surface); color: var(--text);
    border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; margin: 0;
  }
  .insights :global(.section > h2) {
    color: var(--text); border-bottom: 1px solid var(--border); font-size: 15px; padding-bottom: 8px;
  }

  /* Form controls → dark fields. */
  .insights :global(select),
  .insights :global(input:not([type='checkbox'])),
  .insights :global(button) {
    background: var(--surface-2); color: var(--text);
    border: 1px solid var(--border); border-radius: 6px; padding: 3px 8px;
  }
  .insights :global(input[type='checkbox']) { accent-color: var(--accent); }
  .insights :global(button) { cursor: pointer; font-weight: 600; }
  .insights :global(button:hover:not(:disabled)) { border-color: var(--hover-accent, #8a5cff); color: var(--hover-accent, #8a5cff); }
  .insights :global(button:disabled) { opacity: 0.45; cursor: default; }
  /* The per-row remove ✕ stays a borderless red glyph. */
  .insights :global(button.x) { background: none; border: none; color: var(--bad); padding: 0; font-weight: 700; }
  /* Text-only buttons (active card body, library row body, inline links) — no button chrome. */
  .insights :global(button.astext),
  .insights :global(button.linkbtn),
  .insights :global(button.mx),
  .insights :global(button.pdel) { background: none; border: none; padding: 0; }
  .insights :global(button.astext:hover),
  .insights :global(button.mx:hover) { border: none; }
  .insights :global(button.astext) { color: var(--text); }
  .insights :global(.flabel) { color: var(--muted); }
  .insights :global(.primary) { border-color: var(--accent); color: var(--accent); }
  .insights :global(.ptoggle.on) { color: #6cc070; border-color: #6cc070; background: color-mix(in srgb, #6cc070 14%, transparent); }
  .insights :global(.count) { background: var(--surface); color: var(--muted); }

  /* Create / edit modal → dark. */
  .insights :global(.modal) { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
  .insights :global(.modal-head),
  .insights :global(.modal-foot) { border-color: var(--border); }
  .insights :global(.help) { background: var(--surface-2); }
  .insights :global(.modal .del) { color: var(--bad); border: none; }

  /* Metric result cards → dark. */
  .insights :global(.rule) { border-color: var(--border); background: var(--surface-2); }
  .insights :global(.rstats) { color: var(--muted); }

  /* Discovered-window chips + error banner, themed. */
  .insights :global(.winchip) {
    background: var(--surface-2); border: 1px solid var(--border); color: var(--muted);
    border-radius: 4px; padding: 0 5px; font-size: 11px;
  }
  .insights :global(.err) {
    color: var(--bad); background: rgba(248, 113, 113, 0.12); border: 1px solid rgba(248, 113, 113, 0.3);
    border-radius: 6px; padding: 4px 8px; margin: 6px 0; font-size: 12px;
  }

  /* Preset library + import/export panels → dark. */
  .insights :global(.lib),
  .insights :global(.share) { border-color: var(--border); background: var(--surface-2); }
  .insights :global(textarea) {
    background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 8px;
  }
  .insights :global(.preset.sel) { background: color-mix(in srgb, var(--accent) 18%, transparent); }
</style>
