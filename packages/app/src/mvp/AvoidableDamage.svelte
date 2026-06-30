<!-- Avoidable damage taken: total + top mechanics and top players as magnitude bars. Bounded by the
     curated avoidable list (coverage shown), per the engine's own caveat. -->
<script lang="ts">
  import type { AvoidableDamageResult } from '@wow/engine';
  import { abbrev } from './report.js';
  import WowheadLink from './WowheadLink.svelte';
  import { anon } from './anon.svelte.js';
  import { adviceFor, cardFor, type Lens } from './avoidableAdvice.js';
  import { mechanicDetail } from './mechanicDetail.svelte.js';
  import mBookIcon from '../../../assets/img/m-book.svg';

  let { result, lens }: { result: AvoidableDamageResult | null; lens?: Lens } = $props();
  let topSpells = $derived((result?.bySpell ?? []).slice(0, 8));
  let topUnits = $derived((result?.byUnit ?? []).slice(0, 8));
  let max = $derived(Math.max(1, topSpells[0]?.value ?? 0, topUnits[0]?.value ?? 0));
</script>

<section class="card">
  <h2>Avoidable Damage Taken</h2>

  {#if !result || result.totalAvoidable === 0}
    <p class="muted">
      No known avoidable damage in this run.
      <span class="small">({result?.knownAvoidableSpells ?? 0} avoidable mechanics in the database.)</span>
    </p>
  {:else}
    <div class="total">
      <span class="num">{abbrev(result.totalAvoidable)}</span>
      <span class="muted">total avoidable damage taken</span>
    </div>

    <div class="cols">
      <div class="colb">
        <div class="colh muted">By mechanic</div>
        {#each topSpells as s (s.id)}
          {@const adv = adviceFor(s.id, s.name, lens)}
          <div class="bar">
            <div class="lbl"><span class="name" title={s.name}><WowheadLink id={s.id} name={s.name} /></span><span class="val">{abbrev(s.value)}</span></div>
            <div class="bar-track"><div class="bar-fill" style="width: {(s.value / max) * 100}%"></div></div>
            {#if s.byUnit?.length}
              <div class="perplayer">
                {#each s.byUnit as pu (pu.id)}
                  <span class="ppchip"><span class="ppname" title={anon.name(pu.name)}>{anon.name(pu.name)}</span><span class="ppval">{abbrev(pu.value)}</span></span>
                {/each}
              </div>
            {/if}
            <div class="advice">
              <span class="arch" class:inferred={!adv.curated} title={adv.curated ? 'curated guidance' : 'general guidance by mechanic type'}>{adv.label}</span>
              <span class="tip">{adv.tip}</span>
              {#if cardFor(s.id)}
                <button class="tiny detbtn" onclick={() => mechanicDetail.open(s.id)} title="Mechanic details" aria-label="Mechanic details">
                  <span class="detico" style="--mbook: url({mBookIcon})"></span>
                  <span>Details</span>
                </button>
              {/if}
            </div>
            {#each adv.roles as r (r.role)}
              <div class="roleadvice">
                <span class="rolechip {r.role}">{r.role === 'dps' ? 'DPS' : r.role}</span>
                <span class="tip">{r.text}</span>
              </div>
            {/each}
          </div>
        {/each}
      </div>

      <div class="colb">
        <div class="colh muted">By player</div>
        {#each topUnits as u (u.id)}
          <div class="bar">
            <div class="lbl"><span class="name" title={anon.name(u.name)}>{anon.name(u.name)}</span><span class="val">{abbrev(u.value)}</span></div>
            <div class="bar-track"><div class="bar-fill alt" style="width: {(u.value / max) * 100}%"></div></div>
          </div>
        {/each}
      </div>
    </div>

    <p class="muted small foot">
      Known avoidable mechanics only ({result.knownAvoidableSpells} in database) — not ground truth.
      Tips are general guidance by mechanic type unless curated for the specific spell.
    </p>
  {/if}
</section>

<style>
  .small { font-size: 12px; }
  .total { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
  .total .num { font-size: 28px; font-weight: 700; color: var(--bad); }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .colh { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
  .bar { margin-bottom: 9px; }
  .lbl { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; margin-bottom: 3px; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name :global(a) { color: var(--text); text-decoration: none; }
  .name :global(a:hover) { text-decoration: underline; color: var(--accent); }
  .val { font-variant-numeric: tabular-nums; color: var(--muted); flex-shrink: 0; }
  .bar-fill.alt { background: var(--warn); }
  .foot { margin: 14px 0 0; }
  /* Per-player breakdown of who ate each mechanic. */
  .perplayer { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; font-size: 11.5px; }
  .ppchip { display: inline-flex; align-items: baseline; gap: 4px; color: var(--muted); }
  .ppname { max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ppval { font-variant-numeric: tabular-nums; color: var(--text); opacity: 0.85; }
  /* "How to avoid" guidance under each mechanic bar. */
  .advice { margin-top: 4px; font-size: 12px; line-height: 1.45; color: var(--muted); }
  .arch {
    display: inline-block; margin-right: 6px; padding: 0 6px; border-radius: 8px; font-size: 10px;
    font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; vertical-align: 1px;
    color: var(--warn, #e0a82e); border: 1px solid currentColor;
  }
  .arch.inferred { color: var(--muted); }
  .tip { color: var(--text); opacity: 0.85; }
  /* Inherits the app-wide `.tiny` button look (standard surface + border, accent on hover); we only
     add layout for the icon-only content. */
  .detbtn { margin-left: 6px; display: inline-flex; align-items: center; gap: 4px; vertical-align: -4px; color: var(--accent, #9bb6ff); }
  /* The "m-book" details mark, painted with the MythicIQ gradient via mask. */
  .detico {
    width: 18px; height: 13px; display: block;
    background: linear-gradient(135deg, #b86cff 0%, #7b55ff 45%, #238cff 100%);
    -webkit-mask: var(--mbook) center / contain no-repeat;
    mask: var(--mbook) center / contain no-repeat;
  }
  /* Role-specific advice lines under the generic tip (shown for the selected lens). */
  .roleadvice { margin-top: 3px; font-size: 12px; line-height: 1.45; display: flex; gap: 6px; align-items: baseline; }
  .rolechip {
    flex-shrink: 0; padding: 0 6px; border-radius: 8px; font-size: 9.5px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em; border: 1px solid currentColor; vertical-align: 1px;
  }
  .rolechip.tank { color: #6fb3ff; }
  .rolechip.healer { color: #5fd08a; }
  .rolechip.dps { color: #e0a82e; }
  @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
</style>
