<!-- Death review: per player death, what killed them (with avoidability), how fast they died, and
     whether they pressed the defensives they had off cooldown. The headline MVP panel. -->
<script lang="ts">
  import type { DeathRecapResult, DeathRecapRow } from '@wow/engine';
  import { mmss, abbrev } from './report.js';
  import WowheadLink from './WowheadLink.svelte';
  import DeathAutopsy from './DeathAutopsy.svelte';
  import { anon } from './anon.svelte.js';

  import type { SeekOptions } from './replayController.svelte.js';
  type SeekFn = (ms: number, opts?: SeekOptions) => void;
  let { recap, firstMs, onSeek }: { recap: DeathRecapResult | null; firstMs: number; onSeek?: SeekFn } = $props();
  let deaths = $derived(recap?.deaths ?? []);

  // Jump the replay to the death; the drawer's lead-in lands the clock a bit before it so it plays in.
  function review(d: DeathRecapRow) {
    onSeek?.(d.tsMs, { label: `death: ${anon.name(d.name)}` });
  }

  function avoidBadge(d: DeathRecapRow): { cls: string; text: string } | null {
    switch (d.killingBlowAvoidable) {
      case 'avoidable':
        return { cls: 'bad', text: 'Avoidable' };
      case 'interruptible':
        return { cls: 'warn', text: 'Interruptible' };
      case 'unavoidable':
        return { cls: 'unknown', text: 'Unavoidable' };
      case 'unknown':
        return { cls: 'unknown', text: 'Unknown mechanic' };
      default:
        return null;
    }
  }
  const PACE: Record<DeathRecapRow['deathPace'], { cls: string; text: string }> = {
    'one-shot': { cls: 'bad', text: 'One-shot' },
    burst: { cls: 'warn', text: 'Burst' },
    gradual: { cls: 'info', text: 'Gradual' },
    unknown: { cls: 'unknown', text: 'Pace unknown' },
  };
  /** Self-survival CDs that were off cooldown but not pressed — the actionable misses. */
  function missed(d: DeathRecapRow) {
    return d.defensives.filter((x) => x.selfSurvival && x.availableAtDeath && !x.usedInWindow);
  }
  function pressed(d: DeathRecapRow) {
    return d.defensives.filter((x) => x.selfSurvival && x.usedInWindow);
  }
</script>

<section class="card">
  <h2>Deaths {#if deaths.length}<span class="muted">· {deaths.length}</span>{/if}</h2>

  {#if deaths.length === 0}
    <p class="muted none">No player deaths in this run. 🎉</p>
  {:else}
    <div class="list">
      {#each deaths as d (d.actorId + ':' + d.tsMs)}
        {@const ab = avoidBadge(d)}
        {@const miss = missed(d)}
        {@const used = pressed(d)}
        <div class="death" class:clickable={!!onSeek}>
          <div class="row1">
            <span class="when">{mmss(d.tsMs - firstMs)}</span>
            <span class="who">{anon.name(d.name)}</span>
            {#if d.classSpec}<span class="spec muted">{d.classSpec}</span>{/if}
            <span class="spacer"></span>
            <span class="badge {PACE[d.deathPace].cls}">{PACE[d.deathPace].text}</span>
            {#if onSeek}
              <button class="review" title="jump the replay to this death" onclick={() => review(d)}>▶ review</button>
            {/if}
          </div>

          <div class="row2">
            <span class="muted">Killed by</span>
            <span class="kb"><WowheadLink id={d.killingBlowSpellId} name={d.killingBlowName ?? 'unknown'} /></span>
            {#if d.killingBlowAmount !== undefined}<span class="kbamt" title="killing-blow damage">{abbrev(d.killingBlowAmount)}</span>{/if}
            {#if ab}<span class="badge {ab.cls}">{ab.text}</span>{/if}
            {#if d.timeFromHealthyMs !== null}
              <span class="muted small">· {(d.timeFromHealthyMs / 1000).toFixed(1)}s from full HP</span>
            {/if}
          </div>

          {#if d.damageTakenInWindow > 0 || d.healingReceivedInWindow > 0}
            <!-- Coverage compares healing to the SURVIVABLE damage — the killing blow is excluded so a
                 single lethal spike doesn't make a healer who was keeping up look absent. -->
            {@const nonLethal = Math.max(0, d.damageTakenInWindow - (d.killingBlowAmount ?? 0))}
            {@const cov = nonLethal > 0 ? Math.round((d.healingReceivedInWindow / nonLethal) * 100) : null}
            <div class="row-heal" title="Effective healing received vs. the survivable damage taken in the last {d.windowSeconds}s (the killing blow is excluded). A rough read of whether the healer was keeping up (low coverage), they were out-damaged, or it was a triage call.">
              <span class="muted">Healing received</span>
              <span class="hr" class:lean={cov !== null && cov < 40}>{abbrev(d.healingReceivedInWindow)}</span>
              {#if cov !== null}
                <span class="muted small">· covered {cov}% of {abbrev(nonLethal)} survivable damage (last {d.windowSeconds}s)</span>
              {:else}
                <span class="muted small">· the killing blow was nearly all the damage (last {d.windowSeconds}s)</span>
              {/if}
            </div>
          {/if}

          <div class="row3">
            <span class="verdict">{d.verdict}</span>
          </div>

          {#if miss.length || used.length}
            <div class="chips">
              {#each miss as m (m.spellId)}
                <span class="badge warn" title="off cooldown, not used"><WowheadLink id={m.spellId} name={m.name} /></span>
              {/each}
              {#each used as u (u.spellId)}
                <span class="badge good" title="pressed in window"><WowheadLink id={u.spellId} name={u.name} /></span>
              {/each}
            </div>
          {/if}

          <!-- Autopsy graph: HP line + events + defensive/debuff tracks + markers for the last Ns. -->
          <div class="autopsy-wrap">
            <div class="autopsy-cap">
              <span class="muted">Autopsy</span>
              <span class="muted small">· last {(d.autopsy.windowMs / 1000).toFixed(0)}s · hover a dot for the hit/heal</span>
              <span class="spacer"></span>
              <span class="leg"><i class="d-dmg"></i>damage</span>
              <span class="leg"><i class="d-heal"></i>heal</span>
              <span class="leg"><i class="d-def"></i>defensive</span>
              <span class="leg"><i class="d-dbf"></i>debuff</span>
            </div>
            <DeathAutopsy autopsy={d.autopsy} {onSeek} />
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .none { margin: 4px 0; }
  .list { display: flex; flex-direction: column; gap: 10px; }
  .death {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    background: var(--surface-2);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .review {
    background: var(--accent); color: #061018; border: none; border-radius: 6px;
    font-weight: 600; font-size: 12px; padding: 2px 9px; cursor: pointer;
  }
  .review:hover { filter: brightness(1.08); }
  .row1 { display: flex; align-items: center; gap: 10px; }
  .when {
    font-variant-numeric: tabular-nums; font-weight: 700; color: var(--accent);
    background: var(--surface); padding: 1px 7px; border-radius: 6px; font-size: 13px;
  }
  .who { font-weight: 700; font-size: 15px; }
  .spec { font-size: 12px; }
  .spacer { flex: 1; }
  .row2 { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .kb { font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
  .kb :global(a) { font-weight: 600; }
  .kbamt { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--bad, crimson); }
  .small { font-size: 12px; }
  .row-heal { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; font-size: 13px; }
  .row-heal .hr { font-weight: 700; font-variant-numeric: tabular-nums; color: var(--good, #5fd08a); }
  /* Low coverage = the player got little healing relative to the damage; flag it for the eye. */
  .row-heal .hr.lean { color: var(--warn, #e0a82e); }
  .row3 .verdict { font-size: 13px; color: var(--text); }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
  /* Spell chips: keep the badge's warn/good color (override Wowhead's inline link color). */
  .chips .badge { display: inline-flex; align-items: center; gap: 4px; }
  .chips .badge :global(a) { color: inherit !important; text-decoration: none; }
  .chips .badge :global(a:hover) { text-decoration: underline; }

  .autopsy-wrap {
    margin-top: 6px; border-top: 1px solid var(--border); padding-top: 6px;
  }
  .autopsy-cap { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .autopsy-cap .small { font-size: 11px; }
  .autopsy-cap .spacer { flex: 1; }
  .leg { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; color: var(--muted); }
  .leg i { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .leg .d-dmg { background: var(--bad); border-radius: 50%; }
  .leg .d-heal { background: var(--good); border-radius: 50%; }
  .leg .d-def { background: var(--accent); }
  .leg .d-dbf { background: rgba(251, 113, 133, 0.6); }
</style>
