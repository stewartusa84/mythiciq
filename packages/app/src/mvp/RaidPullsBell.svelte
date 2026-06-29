<!-- Topbar Pulls feed (desktop raid review). The companion carves each raid boss pull as it ends and
     surfaces it here, grouped by boss, so a raid leader can scrub mechanics between pulls. A button +
     dropdown mirroring NotificationsBell's self-contained outside-click/Escape pattern; clicking a
     pull opens it from local History into the replay stage. Rendered only when there are pulls this
     session (a raid night), so the topbar stays clean otherwise. -->
<script lang="ts">
  import { mmss } from './report.js';
  import { raidPulls, type RaidPull, type PullGroup } from './raidPulls.svelte.js';

  let {
    onOpenPull,
    onDismiss,
    onSeen,
  }: {
    onOpenPull: (hash: string) => void;
    onDismiss?: (hash: string) => void;
    onSeen?: () => void;
  } = $props();

  let menuOpen = $state(false);
  // Hashes unread when the dropdown opened — snapshotted so the "new" highlight persists while reading.
  let unreadSnapshot = $state<Set<string>>(new Set());

  // Lucide "swords".
  const SWORDS =
    '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>';

  const groups = $derived(raidPulls.grouped);
  const count = $derived(raidPulls.unseenCount);

  function toggle() {
    menuOpen = !menuOpen;
    if (menuOpen) {
      unreadSnapshot = new Set(raidPulls.pulls.filter((p) => !p.seen).map((p) => p.hash));
      onSeen?.();
    }
  }
  function close() { menuOpen = false; }
  function open(hash: string) {
    onOpenPull(hash);
    close();
  }
  function groupHead(g: PullGroup): string {
    const diff = g.difficultyName ? `${g.difficultyName} · ` : '';
    const n = g.pulls.length;
    return `${diff}${n} ${n === 1 ? 'pull' : 'pulls'}${g.kills ? ` · ${g.kills}K` : ''}${g.wipes ? ` · ${g.wipes}W` : ''}`;
  }
  function pullLabel(p: RaidPull): string {
    return `${p.success ? '✓ Kill' : '✗ Wipe'}${p.durationMs ? ` · ${mmss(p.durationMs)}` : ''}`;
  }
</script>

<svelte:window onclick={close} onkeydown={(e) => { if (menuOpen && e.key === 'Escape') close(); }} />

{#if raidPulls.pulls.length > 0}
  <div class="bell" onclick={(e) => e.stopPropagation()} role="presentation">
    <button
      class="bellbtn"
      class:has={count > 0}
      title={count > 0 ? `Raid pulls — ${count} new` : 'Raid pulls'}
      aria-label={count > 0 ? `Raid pulls (${count} new)` : 'Raid pulls'}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={toggle}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html SWORDS}</svg>
      <span class="lbl">Pulls</span>
      {#if count > 0}<span class="badge" aria-hidden="true">{count > 9 ? '9+' : count}</span>{/if}
    </button>

    {#if menuOpen}
      <div class="menu" role="menu" aria-label="Raid pulls">
        <div class="menuhead">
          <span class="mhtitle">Raid pulls</span>
          <span class="mhsub">Click to review</span>
        </div>
        <div class="list">
          {#each groups as g (g.encounterId)}
            <div class="boss">
              <div class="bosshead">
                <span class="bossname">{g.bossName}</span>
                <span class="bossmeta">{groupHead(g)}</span>
              </div>
              {#each g.pulls as p (p.hash)}
                {@const isNew = unreadSnapshot.has(p.hash)}
                <div class="ncard" class:unread={isNew}>
                  <button type="button" class="ncard-main" onclick={() => open(p.hash)}>
                    <span class="pull-out" class:kill={p.success} class:wipe={!p.success}>{pullLabel(p)}</span>
                    <span class="nc-go">Open →</span>
                  </button>
                  <button class="nc-x" title="Dismiss" aria-label="Dismiss pull" onclick={() => onDismiss?.(p.hash)}>✕</button>
                </div>
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .bell { position: relative; display: inline-flex; }
  .bellbtn {
    display: inline-flex; align-items: center; justify-content: center; gap: 5px; position: relative;
    background: transparent; color: var(--muted); border: 1px solid var(--border);
    border-radius: 6px; height: 26px; padding: 0 8px; cursor: pointer;
  }
  .bellbtn:hover { color: var(--text); border-color: var(--muted); }
  .bellbtn.has { color: var(--text); }
  .bellbtn svg { width: 15px; height: 15px; }
  .lbl { font-size: 11.5px; font-weight: 700; }
  .badge {
    position: absolute; top: -6px; right: -6px; min-width: 15px; height: 15px; padding: 0 3px;
    display: inline-flex; align-items: center; justify-content: center; border-radius: 999px;
    font-size: 9px; font-weight: 800; line-height: 1; color: #0a0c10;
    background: var(--accent, #6ea8fe); border: 1.5px solid var(--bg, #0e1116);
  }

  .menu {
    position: absolute; right: 0; top: calc(100% + 6px); width: 320px; max-width: 88vw;
    background: var(--card-bg, #161a22); border: 1px solid var(--border, #2a2f3a);
    border-radius: 10px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5); z-index: 80; overflow: hidden;
  }
  .menuhead {
    display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    padding: 10px 12px; border-bottom: 1px solid var(--border);
  }
  .mhtitle { font-size: 13px; font-weight: 700; color: var(--text); }
  .mhsub { font-size: 11px; color: var(--muted); }

  .list { max-height: min(60vh, 460px); overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 8px; }
  .boss { display: flex; flex-direction: column; gap: 3px; }
  .bosshead {
    display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 2px 6px 1px;
  }
  .bossname { font-size: 12.5px; font-weight: 800; color: var(--text); }
  .bossmeta { font-size: 10.5px; color: var(--muted); }

  .ncard {
    position: relative; display: flex; align-items: stretch; gap: 4px; border-radius: 8px;
    border: 1px solid transparent;
  }
  .ncard.unread { background: color-mix(in srgb, var(--accent, #6ea8fe) 8%, transparent); border-color: color-mix(in srgb, var(--accent, #6ea8fe) 22%, var(--border)); }
  .ncard-main {
    flex: 1; min-width: 0; padding: 7px 8px 7px 10px; border-radius: 8px;
    display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%;
    text-align: left; background: transparent; border: none; color: inherit; font: inherit; cursor: pointer;
  }
  .ncard-main:hover { background: var(--surface-2, rgba(255, 255, 255, 0.05)); }
  .pull-out { font-size: 12px; font-weight: 700; }
  .pull-out.kill { color: var(--good, #4ade80); }
  .pull-out.wipe { color: var(--bad, #f87171); }
  .nc-go { font-size: 11px; font-weight: 700; color: var(--accent, #6ea8fe); }
  .nc-x {
    flex: none; align-self: center; margin: 0 6px 0 0; width: 20px; height: 20px; border: none;
    border-radius: 6px; background: none; color: var(--muted); font-size: 11px; cursor: pointer; line-height: 1;
  }
  .nc-x:hover { color: var(--text); background: var(--surface-2, rgba(255, 255, 255, 0.06)); }
</style>
