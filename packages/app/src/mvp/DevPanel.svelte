<script lang="ts">
  // DEV-ONLY reset panel. Rendered only under `import.meta.env.DEV` (the Vite dev server) — it is
  // tree-shaken out of any production build, so it can never reach users. Quick resets for the local
  // state that's otherwise sticky across reloads (the first-run tour, opt-in choices, saved metrics,
  // history, …) so onboarding / first-run UX can be re-tested without hand-editing storage.
  import { settings } from './settings.svelte.js';
  import { loadBench } from './loadBench.svelte.js';
  import { devSeed } from './devSeed.svelte.js';

  let open = $state(false);
  let flash = $state(''); // tiny inline confirmation after an action

  // All persisted keys (see each module's `KEY`/`DB_NAME`). Kept here so a "clear all" is exhaustive.
  const LOCAL_KEYS = [
    'wow.settings.v1',
    'wow.auth.v1',
    'wow.removalDiscoveries.v1',
    'wow.runStatus.abandoned.v1',
    'customMetricRules',
    'customMetricLibrary',
    'wow.devSeed.v1',
    'rt.showCapacity',
    'rt.showInterrupts',
    'rt.showAvoidable',
  ];
  const SESSION_KEYS = ['wow.auth.pkce'];
  const IDB_NAME = 'mythiciq'; // run-history store

  function note(msg: string) {
    flash = msg;
    setTimeout(() => (flash = ''), 1800);
  }

  // Replay the first-run walkthrough WITHOUT a reload — resetTour flips the reactive flag, and App's
  // effect re-fires to start the tour on the loaded run (if any).
  function replayTour() {
    settings.resetTour();
    note(document.querySelector('[data-tour="stage"]') ? 'tour will replay' : 'load a run to see it');
  }

  function remove(keys: string[], store: Storage) {
    for (const k of keys) {
      try {
        store.removeItem(k);
      } catch {
        /* ignore */
      }
    }
  }

  function resetSettings() {
    remove(['wow.settings.v1'], localStorage);
    location.reload();
  }
  function clearMetrics() {
    remove(['customMetricRules', 'customMetricLibrary'], localStorage);
    location.reload();
  }
  function resetCelebrations() {
    settings.resetCelebrations();
    settings.resetPersonalBests();
    note('celebrations + PBs reset — re-open a timed run');
  }
  function clearHistory() {
    try {
      indexedDB.deleteDatabase(IDB_NAME);
    } catch {
      /* ignore */
    }
    note('history cleared');
  }
  // Groups/LFG placeholders — local only (never hit the backend), so this just (re)fills / clears the
  // local devSeed store; nothing to clean up in the cloud.
  function seedGroups() {
    devSeed.seed();
    note(`seeded ${devSeed.cards.length} runs + ${devSeed.pool.length} pool cards (open Groups)`);
  }
  function clearGroups() {
    devSeed.clear();
    note('placeholder runs cleared');
  }
  function clearAll() {
    if (!confirm('Clear ALL MythicIQ local data (settings, auth, metrics, history) and reload?')) return;
    remove(LOCAL_KEYS, localStorage);
    remove(SESSION_KEYS, sessionStorage);
    try {
      indexedDB.deleteDatabase(IDB_NAME);
    } catch {
      /* ignore */
    }
    location.reload();
  }
</script>

<div class="dev">
  {#if open}
    <div class="panel">
      <div class="head">
        <span>DEV resets</span>
        <button class="x" onclick={() => (open = false)} aria-label="Close">✕</button>
      </div>
      <button onclick={replayTour}>Replay walkthrough</button>
      <button onclick={resetSettings}>Reset settings &amp; changelog</button>
      <button onclick={resetCelebrations}>Reset celebrations + PBs</button>
      <button onclick={clearMetrics}>Clear custom metrics</button>
      <button onclick={clearHistory}>Clear run history</button>
      <button onclick={seedGroups}>Seed Groups placeholders{#if devSeed.cards.length} ({devSeed.cards.length}){/if}</button>
      {#if devSeed.cards.length || devSeed.pool.length}
        <button onclick={clearGroups}>Clear Groups placeholders</button>
      {/if}
      <button class="danger" onclick={clearAll}>Clear ALL local data + reload</button>

      <!-- Load / tray-restore benchmark (see loadBench.svelte.ts). Cold UI load + each hide→show cycle. -->
      <div class="bench">
        <div class="bench-head">
          <span>Load timing</span>
          {#if loadBench.restores.length}<button class="bx" onclick={() => loadBench.reset()}>clear</button>{/if}
        </div>
        <div class="brow">
          <span>Cold UI load</span>
          <b>{loadBench.initialLoadMs == null ? '—' : `${loadBench.initialLoadMs} ms`}</b>
        </div>
        <div class="brow">
          <span>Tray restore (avg)</span>
          <b>{loadBench.avgPaintMs == null ? '—' : `${loadBench.avgPaintMs} ms`}</b>
        </div>
        <div class="brow">
          <span title="Override the unload-replay-on-tray delay so you don't wait the real minute. Needs the setting on.">Tray unload delay</span>
          <span class="delay">
            <input
              type="number"
              min="0"
              step="1"
              value={Math.round(loadBench.trayUnloadDelayMs / 1000)}
              onchange={(e) => (loadBench.trayUnloadDelayMs = Math.max(0, +e.currentTarget.value) * 1000)}
            />s
          </span>
        </div>
        {#if loadBench.restores.length}
          <div class="bsub">recent restores · paint (hidden)</div>
          {#each loadBench.restores as r (r.at)}
            <div class="brow tiny">
              <span>{new Date(r.at).toLocaleTimeString()}</span>
              <b>{r.paintMs} ms <span class="dim">({(r.hiddenMs / 1000).toFixed(1)}s)</span></b>
            </div>
          {/each}
        {:else}
          <div class="bsub">minimize to tray + restore to record</div>
        {/if}
        {#if loadBench.trayLog.length}
          <div class="bsub">tray events</div>
          {#each loadBench.trayLog as line (line)}
            <div class="brow tiny"><span class="tlog">{line}</span></div>
          {/each}
        {/if}
      </div>

      {#if flash}<div class="flash">{flash}</div>{/if}
    </div>
  {/if}
  <button class="toggle" onclick={() => (open = !open)} title="Dev resets (localhost only)">🧪 DEV</button>
</div>

<style>
  .dev {
    position: fixed;
    left: 12px;
    bottom: 12px;
    z-index: 1100; /* above the tour scrim so resets are reachable mid-tour */
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
  }
  .toggle {
    background: #2a1f3a;
    color: #d8b4fe;
    border: 1px dashed #9b6dd6;
    border-radius: 8px;
    padding: 5px 10px;
    cursor: pointer;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .toggle:hover {
    background: #34264a;
  }
  .panel {
    background: #14161c;
    border: 1px dashed #9b6dd6;
    border-radius: 10px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 220px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #d8b4fe;
    font-weight: 700;
    margin-bottom: 2px;
  }
  .x {
    background: none;
    border: none;
    color: #8b97a8;
    cursor: pointer;
    font-size: 13px;
  }
  .panel button:not(.x) {
    text-align: left;
    background: #1f2330;
    color: #e8edf4;
    border: 1px solid #2a313c;
    border-radius: 6px;
    padding: 7px 10px;
    cursor: pointer;
    font-size: 12px;
  }
  .panel button:not(.x):hover {
    border-color: #9b6dd6;
  }
  .panel button.danger {
    color: #ffb4b4;
    border-color: #5a2a2a;
  }
  .panel button.danger:hover {
    border-color: #e0a82e;
  }
  .flash {
    color: #5fd08a;
    font-size: 11px;
    padding-top: 2px;
  }
  .bench {
    margin-top: 4px;
    padding: 8px;
    border: 1px solid #2a313c;
    border-radius: 6px;
    background: #1a1e27;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .bench-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #d8b4fe;
    font-weight: 700;
    margin-bottom: 2px;
  }
  .bx {
    background: none;
    border: none;
    color: #8b97a8;
    cursor: pointer;
    font-size: 11px;
    padding: 0;
  }
  .bx:hover {
    color: #e8edf4;
  }
  .brow {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    color: #c3cbd6;
    font-size: 12px;
  }
  .brow b {
    color: #e8edf4;
    font-variant-numeric: tabular-nums;
  }
  .brow.tiny {
    font-size: 11px;
    color: #8b97a8;
  }
  .brow.tiny b {
    color: #c3cbd6;
    font-weight: 600;
  }
  .dim {
    color: #6b7686;
    font-weight: 400;
  }
  .delay {
    display: inline-flex;
    align-items: baseline;
    gap: 2px;
    color: #c3cbd6;
  }
  .delay input {
    width: 48px;
    background: #11151c;
    color: #e8edf4;
    border: 1px solid #2a313c;
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 11px;
    text-align: right;
    color-scheme: dark;
  }
  .bsub {
    color: #6b7686;
    font-size: 10px;
    padding-top: 2px;
  }
  .tlog {
    font-size: 10px;
    color: #9aa6b5;
    font-variant-numeric: tabular-nums;
  }
</style>
