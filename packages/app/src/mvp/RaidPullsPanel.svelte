<!-- Sidebar raid-pull switcher. Live desktop carving adds completed boss pulls to the session store;
     when the currently opened report is raid content, this panel gives a top-left way to hop between
     the latest pulls without putting raid-specific chrome in the global topbar. -->
<script lang="ts">
  import { mmss } from './report.js';
  import { raidPulls, type RaidPull, type PullGroup } from './raidPulls.svelte.js';

  let {
    currentHash = null,
    onOpenPull,
  }: {
    currentHash?: string | null;
    onOpenPull: (hash: string) => void;
  } = $props();

  const groups = $derived(raidPulls.grouped);
  const total = $derived(raidPulls.pulls.length);

  $effect(() => {
    if (total > 0) raidPulls.markSeen();
  });

  function groupHead(g: PullGroup): string {
    const diff = g.difficultyName ? `${g.difficultyName} · ` : '';
    const n = g.pulls.length;
    return `${diff}${n} ${n === 1 ? 'pull' : 'pulls'}${g.kills ? ` · ${g.kills}K` : ''}${g.wipes ? ` · ${g.wipes}W` : ''}`;
  }
  function pullLabel(p: RaidPull): string {
    return `${p.success ? 'Kill' : 'Wipe'}${p.durationMs ? ` · ${mmss(p.durationMs)}` : ''}`;
  }
</script>

{#if groups.length > 0}
  <section class="raid-switcher" aria-label="Recent raid pulls">
    <div class="rs-head">
      <span class="rs-title">Recent raid pulls</span>
      <span class="rs-count">{total}</span>
    </div>
    <div class="rs-groups">
      {#each groups as g (g.encounterId)}
        <div class="rs-boss">
          <div class="rs-bosshead">
            <span class="rs-bossname">{g.bossName}</span>
            <span class="rs-meta">{groupHead(g)}</span>
          </div>
          {#each g.pulls as p (p.hash)}
            {@const active = currentHash === p.hash}
            <button class="rs-pull" class:active onclick={() => onOpenPull(p.hash)} aria-current={active ? 'true' : undefined}>
              <span class="rs-outcome" class:kill={p.success} class:wipe={!p.success}>{pullLabel(p)}</span>
              <span class="rs-open">{active ? 'Open' : 'Review'}</span>
            </button>
          {/each}
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .raid-switcher {
    display: flex;
    flex-direction: column;
    gap: 8px;
    border: 1px solid rgba(143, 171, 222, 0.2);
    border-radius: 8px;
    padding: 10px;
    background: rgba(3, 8, 18, 0.28);
  }
  .rs-head,
  .rs-bosshead,
  .rs-pull {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .rs-title {
    color: #e7edf9;
    font-size: 12px;
    font-weight: 850;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .rs-count {
    min-width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent, #6ea8fe) 18%, transparent);
    color: var(--accent, #6ea8fe);
    font-size: 11px;
    font-weight: 800;
  }
  .rs-groups,
  .rs-boss {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .rs-bosshead {
    padding: 1px 2px 0;
    align-items: baseline;
  }
  .rs-bossname {
    min-width: 0;
    color: var(--text);
    font-size: 12.5px;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rs-meta {
    flex: none;
    color: var(--muted);
    font-size: 10.5px;
  }
  .rs-pull {
    width: 100%;
    min-height: 32px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
    padding: 6px 8px;
    text-align: left;
    font: inherit;
  }
  .rs-pull:hover,
  .rs-pull.active {
    border-color: var(--hover-accent, #8a5cff);
    background: color-mix(in srgb, var(--accent, #6ea8fe) 10%, var(--surface-2));
  }
  .rs-outcome {
    min-width: 0;
    font-size: 12px;
    font-weight: 750;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rs-outcome.kill { color: var(--good, #4ade80); }
  .rs-outcome.wipe { color: var(--bad, #f87171); }
  .rs-open {
    flex: none;
    color: var(--accent, #6ea8fe);
    font-size: 11px;
    font-weight: 800;
  }
</style>
