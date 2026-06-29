<!-- Run History: the last few M+ runs kept locally (IndexedDB, see historyStore.ts). Click a row to
     pull the run back up — it re-parses the stored sub-log into a full report + replay. Used both in
     the rail sidebar and (compact) on the landing page. -->
<script lang="ts">
  import type { RunReport } from '@wow/engine';
  import { mmss, runResult, type RunResult } from './report.js';
  import { affixName } from './affixes.js';
  import { runStatus } from './runStatus.svelte.js';
  import type { HistoryEntry } from './historyStore.js';
  import { auth } from './auth.svelte.js';
  import { FLAGS } from './flags.js';
  import { shareConfigured, createShare } from './share.js';
  import type { CloudRunMeta } from './cloudBackup.js';

  let {
    entries,
    onOpen,
    onDelete,
    busyHash = null,
    compact = false,
  }: {
    entries: HistoryEntry[];
    onOpen: (hash: string) => void;
    onDelete: (hash: string) => void;
    busyHash?: string | null;
    compact?: boolean;
  } = $props();

  function resultOf(e: HistoryEntry): { result: RunResult; stars: number } {
    // meta carries the same fields runResult reads (completed/abandoned/chests); honor a user override.
    return runResult(e.meta as unknown as RunReport['run'], runStatus.isAbandoned(e.hash));
  }
  const badgeClass = (r: RunResult) =>
    r === 'timed' || r === 'completed' ? 'good' : r === 'abandoned' ? 'bad' : r === 'over-time' ? 'warn' : 'info';

  const when = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' +
    new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

  // Sharing: only when a backend + Cognito are configured AND the user is signed in (so there's a place
  // to upload + an owner to key the share on). Hidden on the compact landing list. One share flow at a
  // time (inline confirm → create → copy link), keyed by the row's hash.
  const canShare = $derived(!FLAGS.demo && shareConfigured() && auth.status === 'signed-in' && !compact);
  let share = $state<{ hash: string; phase: 'confirm' | 'sharing' | 'done' | 'error'; url?: string; error?: string } | null>(null);
  // Whether this share should be anonymized + opened for discussion (hides names, requires sign-in to
  // view). Reset each time the panel opens. Only offered when the run has its cached report (the roster
  // source the anonymizer needs).
  let shareAnon = $state(false);

  function startShare(hash: string) {
    share = { hash, phase: 'confirm' };
    shareAnon = false;
  }
  function cancelShare() {
    share = null;
  }
  async function confirmShare(e: HistoryEntry) {
    share = { hash: e.hash, phase: 'sharing' };
    const meta = { ...e.meta, startedAtMs: e.startedAtMs } as CloudRunMeta;
    const res = await createShare(e.hash, meta, shareAnon ? { anonymize: true, discussion: true } : {});
    if (res.ok) {
      share = { hash: e.hash, phase: 'done', url: res.value.url };
      try {
        await navigator.clipboard.writeText(res.value.url);
      } catch {
        /* clipboard blocked — the link is shown for manual copy */
      }
    } else {
      share = { hash: e.hash, phase: 'error', error: res.error };
    }
  }
</script>

<div class="hist" class:compact>
  {#if entries.length === 0}
    <p class="empty muted">No saved runs yet — analyze a log and your last 3 runs are kept here for quick replay.</p>
  {:else}
    <ul class="rows">
      {#each entries as e (e.hash)}
        {@const r = resultOf(e)}
        {@const timeMs = e.meta.completed && e.meta.completionTimeMs ? e.meta.completionTimeMs : e.meta.durationMs}
        <li class="row" class:busy={busyHash === e.hash}>
          <div class="rowmain">
          <button class="open" title="Open this run (re-parse → full report + replay)" onclick={() => onOpen(e.hash)} disabled={!!busyHash}>
            <div class="line1">
              {#if e.meta.contentType === 'raid'}
                <span class="dungeon">{e.meta.instanceName ?? 'Raid'}</span>
                {#if e.meta.difficultyName}<span class="key">{e.meta.difficultyName}</span>{/if}
                <span class="badge {(e.meta.bossesKilled ?? 0) > 0 ? 'good' : 'warn'}">
                  {e.meta.bossesKilled ?? 0}/{e.meta.bossesPulled ?? 0}
                </span>
              {:else}
                <span class="dungeon">{e.meta.dungeonName ?? 'Unknown dungeon'}</span>
                {#if e.meta.keystoneLevel}<span class="key">+{e.meta.keystoneLevel}</span>{/if}
                <span class="badge {badgeClass(r.result)}">
                  {#if r.result === 'timed'}★{r.stars}
                  {:else if r.result === 'over-time'}⏱
                  {:else if r.result === 'completed'}✓
                  {:else if r.result === 'abandoned'}✗
                  {:else}…{/if}
                </span>
              {/if}
            </div>
            <div class="line2 muted">
              <span>{when(e.startedAtMs)}</span>
              <span>· {mmss(timeMs)}</span>
              <span>· {e.meta.deaths} death{e.meta.deaths === 1 ? '' : 's'}</span>
              {#if !compact}<span>· {size(e.gzSize)}</span>{/if}
            </div>
            {#if !compact && e.meta.affixes.length}
              <div class="affixes">
                {#each e.meta.affixes as a}<span class="affix">{affixName(a)}</span>{/each}
              </div>
            {/if}
          </button>
          <div class="rowacts">
            {#if canShare}
              <button class="share" title="Share a replay link for this run" aria-label="Share replay link" onclick={() => startShare(e.hash)} disabled={!!busyHash}>🔗</button>
            {/if}
            <button class="del" title="Remove from history" aria-label="Remove from history" onclick={() => onDelete(e.hash)} disabled={!!busyHash}>✕</button>
          </div>
          </div>
          {#if share && share.hash === e.hash}
            <div class="sharepanel">
              {#if share.phase === 'confirm'}
                {#if e.hasReport}
                  <label class="sp-opt">
                    <input type="checkbox" bind:checked={shareAnon} />
                    <span>Anonymize &amp; open for discussion</span>
                  </label>
                {/if}
                {#if shareAnon}
                  <p class="sp-warn">Player names are hidden (shown as Tank / Healer / DPS 1…). Anyone <b>signed in</b> with the link can watch and comment. You can revoke it later.</p>
                {:else}
                  <p class="sp-warn">Anyone with the link can watch this replay, <b>including player names</b>. The link is private until you share it, and you can revoke it later.</p>
                {/if}
                <div class="sp-acts">
                  <button class="sp-go" onclick={() => confirmShare(e)}>Create link</button>
                  <button class="sp-ghost" onclick={cancelShare}>Cancel</button>
                </div>
              {:else if share.phase === 'sharing'}
                <p class="sp-info">{shareAnon ? 'Anonymizing & creating link…' : 'Uploading run & creating link…'}</p>
              {:else if share.phase === 'done'}
                <p class="sp-ok">✓ Link copied to clipboard</p>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <input class="sp-link" readonly value={share.url} onclick={(ev) => ev.currentTarget.select()} />
                <div class="sp-acts"><button class="sp-ghost" onclick={cancelShare}>Done</button></div>
              {:else if share.phase === 'error'}
                <p class="sp-err">Couldn’t create link: {share.error}</p>
                <div class="sp-acts"><button class="sp-ghost" onclick={cancelShare}>Close</button></div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .hist { display: flex; flex-direction: column; }
  .empty { font-size: 13px; margin: 0; padding: 6px 2px; }
  .rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; flex-direction: column; gap: 4px; }
  .row.busy { opacity: 0.6; }
  .rowmain { display: flex; align-items: stretch; gap: 4px; }
  .open {
    flex: 1; min-width: 0; text-align: left; cursor: pointer;
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 8px;
    padding: 8px 10px; color: var(--text); display: flex; flex-direction: column; gap: 3px;
  }
  .open:hover:not(:disabled) { border-color: var(--hover-accent, #8a5cff); }
  .open:disabled { cursor: default; }
  .line1 { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
  .dungeon { font-weight: 700; font-size: 13.5px; }
  .key { font-size: 12px; font-weight: 700; color: var(--accent); }
  .badge {
    margin-left: auto; font-size: 11px; font-weight: 800; padding: 1px 7px; border-radius: 999px;
    border: 1px solid currentColor; line-height: 1.4; white-space: nowrap;
  }
  .badge.good { color: var(--good); }
  .badge.bad { color: var(--bad); }
  .badge.warn { color: var(--warn); }
  .badge.info { color: var(--muted); }
  .line2 { font-size: 11.5px; display: flex; gap: 4px; flex-wrap: wrap; }
  .affixes { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
  .affix {
    font-size: 10.5px; color: var(--muted); background: var(--surface);
    border: 1px solid var(--border); border-radius: 4px; padding: 0 5px;
  }
  .rowacts { flex: 0 0 auto; display: flex; flex-direction: column; gap: 4px; }
  .del, .share {
    flex: 1; width: 30px; cursor: pointer;
    background: none; border: 1px solid var(--border); border-radius: 8px; color: var(--muted);
  }
  .del:hover:not(:disabled) { color: var(--bad); border-color: var(--bad); }
  .share:hover:not(:disabled) { color: var(--hover-accent, #8a5cff); border-color: var(--hover-accent, #8a5cff); }
  .del:disabled, .share:disabled { cursor: default; opacity: 0.5; }

  /* Inline share flow (confirm → create → copy link). */
  .sharepanel {
    border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px;
    background: var(--surface); display: flex; flex-direction: column; gap: 7px;
  }
  .sp-opt { display: flex; align-items: center; gap: 7px; font-size: 12px; font-weight: 600; cursor: pointer; }
  .sp-opt input { accent-color: var(--accent, #6ea8fe); width: 15px; height: 15px; cursor: pointer; }
  .sp-warn { margin: 0; font-size: 11.5px; line-height: 1.45; color: var(--warn, #e0a82e); }
  .sp-info { margin: 0; font-size: 12px; color: var(--muted); }
  .sp-ok { margin: 0; font-size: 12px; font-weight: 700; color: var(--good); }
  .sp-err { margin: 0; font-size: 11.5px; color: var(--bad); }
  .sp-acts { display: flex; gap: 6px; }
  .sp-go {
    cursor: pointer; font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 6px;
    background: var(--accent, #6ea8fe); color: #0a0c10; border: none;
  }
  .sp-ghost {
    cursor: pointer; font-size: 12px; padding: 4px 10px; border-radius: 6px;
    background: none; border: 1px solid var(--border); color: var(--muted);
  }
  .sp-ghost:hover { color: var(--text); border-color: var(--muted); }
  .sp-link {
    width: 100%; box-sizing: border-box; font-size: 11.5px; font-family: ui-monospace, monospace;
    padding: 5px 7px; border-radius: 6px; border: 1px solid var(--border);
    background: var(--surface-2); color: var(--text); color-scheme: dark;
  }

  /* Compact (landing page): tighter, no affix/size lines. */
  .compact .open { padding: 6px 9px; }
</style>
