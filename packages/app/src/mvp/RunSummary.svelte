<!-- At-a-glance run header: dungeon, key level, affixes, time, result, death count. -->
<script lang="ts">
  import type { RunReport } from '@wow/engine';
  import { mmss, runResult, raidSummary } from './report.js';
  import { affixName } from './affixes.js';
  import { runStatus } from './runStatus.svelte.js';
  import { runHash } from './runHash.js';
  import WowheadLink from './WowheadLink.svelte';

  let { report, deathCount }: { report: RunReport; deathCount: number } = $props();
  let run = $derived(report.run);
  let hash = $derived(runHash(report));
  // Raid sessions get a different header (instance + difficulty + bosses killed/pulled) — no
  // keystone/stars/timer/affixes/abandoned-prompt.
  let isRaid = $derived(run.contentType === 'raid');
  let raid = $derived(raidSummary(report));
  // For a single-encounter raid run, lead with the boss name (the instance shows as a subtitle);
  // a multi-boss session keeps the instance name as the title.
  let name = $derived(
    isRaid
      ? (raid?.bossName ?? raid?.instanceName ?? 'Raid')
      : (run.dungeonName ?? (run.synthetic ? 'Whole log' : 'Unknown dungeon')),
  );
  // Instance shown as context only when it's not already the title (i.e. we have a boss name).
  let raidSubtitle = $derived(isRaid && raid?.bossName ? raid.instanceName : undefined);
  // completionTimeMs is the in-game timer time; fall back to wall-clock span (it's 0 on an
  // abandoned key's reset END, so only trust it for an actual completion).
  let timeMs = $derived(
    run.completed && run.completionTimeMs ? run.completionTimeMs : run.durationMs,
  );

  // Result for the header badge (timed ★/★★/★★★, over-time, completed, abandoned, in-progress).
  // A user override can force a stuck "in progress" run (re-rolled key, no END) to abandoned.
  let overridden = $derived(runStatus.isAbandoned(hash));
  let base = $derived(runResult(run, overridden));
  let result = $derived(base.result);
  let stars = $derived(base.stars);
  // Only offer the "is it complete?" prompt for a genuinely in-progress run not already overridden.
  let canMarkAbandoned = $derived(result === 'in-progress' && !run.synthetic);
  let badgeClass = $derived(
    result === 'timed' || result === 'completed'
      ? 'good'
      : result === 'abandoned'
        ? 'bad'
        : result === 'over-time'
          ? 'warn'
          : 'info',
  );
</script>

<section class="card summary">
  <div class="top">
    <div class="title">
      <span class="dungeon">{name}</span>
      {#if raidSubtitle}<span class="instance">{raidSubtitle}</span>{/if}
      {#if isRaid && run.difficultyName}<span class="diff">{run.difficultyName}</span>{/if}
      {#if !isRaid && run.keystoneLevel}<span class="key">+{run.keystoneLevel}</span>{/if}
    </div>
    {#if isRaid && raid}
      <div class="result">
        <span class="badge {raid.killed === raid.pulled && raid.killed > 0 ? 'good' : raid.killed > 0 ? 'info' : 'warn'}">
          {raid.killed}/{raid.pulled} {raid.pulled === 1 ? 'boss' : 'bosses'}
        </span>
      </div>
    {:else if !run.synthetic}
      <div class="result">
        <span class="badge {badgeClass}">
          {#if result === 'timed'}
            <span class="timed-label">Timed</span><span class="stars" title="{stars} of 3 chests"
              >{'★'.repeat(stars)}<span class="star-dim">{'★'.repeat(3 - stars)}</span></span>
          {:else if result === 'over-time'}
            ⏱ Over time
          {:else if result === 'completed'}
            ✓ Completed
          {:else if result === 'abandoned'}
            ✗ Abandoned
          {:else}
            In progress
          {/if}
        </span>
        {#if canMarkAbandoned}
          <div class="prompt-wrap">
            <button class="prompt-trigger" aria-label="Is this run complete?">?</button>
            <div class="prompt-pop" role="dialog">
              <p>Is this run complete? It appears <b>in progress</b> — abandoned keys (re-rolled before finishing) often look like this.</p>
              <button class="prompt-yes" onclick={() => runStatus.markAbandoned(hash)}>Yes — mark abandoned</button>
            </div>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="stats">
    <div class="stat"><span class="k">Time</span><span class="v">{mmss(timeMs)}{#if run.timerMs}<span class="timer">&nbsp;/&nbsp;{mmss(run.timerMs)}</span>{/if}</span></div>
    <div class="stat"><span class="k">Deaths</span><span class="v" class:bad={deathCount > 0}>{deathCount}</span></div>
    <div class="stat"><span class="k">Events</span><span class="v">{report.totalEvents.toLocaleString()}</span></div>
    {#if run.affixes.length}
      <div class="stat affixes">
        <span class="k">Affixes</span>
        <span class="v">{#each run.affixes as a}<span class="affix"><WowheadLink id={a} kind="affix" name={affixName(a)} /></span>{/each}</span>
      </div>
    {/if}
  </div>
</section>

<style>
  .summary { padding: 18px 20px; }
  .top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .title { display: flex; align-items: baseline; gap: 10px; }
  .dungeon { font-size: 22px; font-weight: 700; }
  .key { font-size: 18px; font-weight: 700; color: var(--accent); }
  .instance { font-size: 14px; font-weight: 500; color: var(--muted); }
  .diff {
    font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    padding: 2px 8px; border-radius: 6px; color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }
  .stats { display: flex; flex-wrap: wrap; gap: 26px; margin-top: 14px; }
  .stat { display: flex; flex-direction: column; gap: 2px; }
  .stat .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
  .stat .v { font-size: 18px; font-weight: 600; }
  .stat .v.bad { color: var(--bad); }
  .timer { color: var(--muted); font-weight: 500; font-size: 14px; }
  .timed-label { margin-right: 5px; }
  .stars { letter-spacing: 1px; }
  .star-dim { opacity: 0.28; }
  .affixes .v { display: flex; gap: 8px; flex-wrap: wrap; }
  .affix {
    display: inline-flex; align-items: center; gap: 5px;
    font-size: 13px; font-weight: 600; padding: 2px 9px; border-radius: 6px;
    background: var(--surface-2);
  }
  .affix :global(a) { color: var(--text); text-decoration: none; }
  .affix :global(a:hover) { text-decoration: underline; }

  .result { display: flex; align-items: center; gap: 8px; }
  .prompt-wrap { position: relative; display: inline-flex; }
  .prompt-trigger {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border-radius: 50%; cursor: help;
    border: 1px solid var(--border); background: var(--surface-2);
    color: var(--muted); font-size: 11px; font-weight: 700;
  }
  .prompt-trigger:hover { color: var(--text); border-color: var(--hover-accent, #8a5cff); }
  .prompt-pop {
    position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
    width: 250px; padding: 11px 12px; border-radius: 8px;
    background: var(--surface-2); border: 1px solid var(--border);
    box-shadow: 0 8px 22px rgba(0,0,0,0.5);
    opacity: 0; visibility: hidden; transform: translateY(-4px);
    transition: opacity 0.12s, transform 0.12s, visibility 0.12s;
  }
  /* Keep the popover open while hovering the trigger OR the popover itself (so the Yes button is reachable). */
  .prompt-wrap:hover .prompt-pop,
  .prompt-pop:hover,
  .prompt-trigger:focus-visible + .prompt-pop { opacity: 1; visibility: visible; transform: translateY(0); }
  .prompt-pop p { margin: 0 0 9px; font-size: 12px; line-height: 1.45; color: var(--text); font-weight: 400; }
  .prompt-yes {
    width: 100%; padding: 6px 10px; border-radius: 6px; cursor: pointer;
    border: 1px solid var(--bad, crimson); background: color-mix(in srgb, var(--bad, crimson) 16%, transparent);
    color: var(--bad, crimson); font-size: 12px; font-weight: 700;
  }
  .prompt-yes:hover { background: color-mix(in srgb, var(--bad, crimson) 26%, transparent); }
</style>
