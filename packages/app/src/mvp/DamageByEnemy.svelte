<!-- Damage taken grouped by ENEMY (npc type): who's actually hurting the party. Every instance of the
     same mob combines into one row so it's easy to spot the top threat when several adds are up — bosses
     get their own row. Each enemy expands to show its top abilities + which players ate the damage. -->
<script lang="ts">
  import type { DamageTakenByEnemyResult } from '@wow/engine';
  import { abbrev } from './report.js';
  import WowheadLink from './WowheadLink.svelte';
  import { anon } from './anon.svelte.js';

  let { result }: { result: DamageTakenByEnemyResult | null } = $props();

  let rows = $derived((result?.byEnemy ?? []).filter((e) => e.total > 0));
  let max = $derived(Math.max(1, rows[0]?.total ?? 0));
  let total = $derived(result?.totalTaken ?? 0);

  // Expanded enemies (by key) — show full ability + per-player breakdown on click.
  let open = $state<Set<string>>(new Set());
  function toggle(key: string) {
    const next = new Set(open);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    open = next;
  }
  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(v / total >= 0.1 ? 0 : 1)}%` : '');
  // Percent of an enemy's OWN total (for the hover breakdown) — string label + numeric width.
  const ofEnemy = (v: number, enemyTotal: number) =>
    enemyTotal > 0 ? `${((v / enemyTotal) * 100).toFixed(v / enemyTotal >= 0.1 ? 0 : 1)}%` : '0%';
  const frac = (v: number, enemyTotal: number) => (enemyTotal > 0 ? (v / enemyTotal) * 100 : 0);
  // Any run has a preventable split worth showing the legend for?
  let hasSplit = $derived(!!result && (result.split.interruptible > 0 || result.split.dispellable > 0));
</script>

<section class="card">
  <h2>Damage Taken by Enemy</h2>

  {#if rows.length === 0}
    <p class="muted">No enemy damage recorded in this run.</p>
  {:else}
    <div class="total">
      <span class="num">{abbrev(total)}</span>
      <span class="muted">total damage taken · {rows.length} enemies</span>
    </div>

    {#if hasSplit && result}
      <div class="legend">
        <span class="lg"><span class="sw intr"></span>from interruptible casts <b>{abbrev(result.split.interruptible)}</b> ({pct(result.split.interruptible)})</span>
        <span class="lg"><span class="sw disp"></span>from dispellable debuffs <b>{abbrev(result.split.dispellable)}</b> ({pct(result.split.dispellable)})</span>
        <span class="lg"><span class="sw other"></span>other</span>
      </div>
    {/if}

    <div class="list">
      {#each rows as e (e.key)}
        {@const isOpen = open.has(e.key)}
        <div class="enemy" class:open={isOpen}>
          <button class="row" onclick={() => toggle(e.key)} aria-expanded={isOpen}>
            <div class="lbl">
              <span class="chev" class:rot={isOpen}>▸</span>
              <span class="name" title={e.name}>
                {#if e.npcId}<WowheadLink id={e.npcId} name={e.name} kind="npc" />{:else}{e.name}{/if}
              </span>
              {#if e.instances > 1}<span class="mult" title="{e.instances} of this enemy dealt damage">×{e.instances}</span>{/if}
            </div>
            <span class="val"><span class="pctv">{pct(e.total)}</span>{abbrev(e.total)}</span>
          </button>
          <div class="bar-wrap">
            <div class="track seg">
              <div class="fill intr" style="width:{(e.split.interruptible / max) * 100}%"></div>
              <div class="fill disp" style="width:{(e.split.dispellable / max) * 100}%"></div>
              <div class="fill other" style="width:{(e.split.other / max) * 100}%"></div>
            </div>
            <div class="pop">
              <div class="pop-h">{e.name}</div>
              {#each [
                { cls: 'intr', label: 'Interruptible casts', v: e.split.interruptible },
                { cls: 'disp', label: 'Dispellable debuffs', v: e.split.dispellable },
                { cls: 'other', label: 'Other', v: e.split.other },
              ] as m (m.cls)}
                <div class="pm">
                  <div class="pm-h">
                    <span class="sw {m.cls}"></span>
                    <span class="pm-l">{m.label}</span>
                    <span class="pm-v">{abbrev(m.v)}</span>
                    <span class="pm-p">{ofEnemy(m.v, e.total)}</span>
                  </div>
                  <div class="pm-track"><div class="pm-fill {m.cls}" style="width:{frac(m.v, e.total)}%"></div></div>
                </div>
              {/each}
              <div class="pm-tot"><span class="pm-l">Total</span><span class="pm-v">{abbrev(e.total)}</span></div>
            </div>
          </div>

          {#if isOpen}
            <div class="detail">
              <div class="dcol">
                <div class="dh muted">Abilities</div>
                {#each e.bySpell as s (s.id)}
                  <div class="dbar">
                    <div class="dlbl">
                      <span class="dn" title={s.name}><WowheadLink id={s.id} name={s.name} /></span>
                      <span class="dv">{abbrev(s.value)}</span>
                    </div>
                    <div class="dtrack"><div class="dfill" style="width:{(s.value / e.total) * 100}%"></div></div>
                  </div>
                {/each}
              </div>
              <div class="dcol">
                <div class="dh muted">Damaged</div>
                {#each e.byTarget as t (t.id)}
                  <div class="dbar">
                    <div class="dlbl">
                      <span class="dn" title={anon.name(t.name)}>{anon.name(t.name)}</span>
                      <span class="dv">{abbrev(t.value)}</span>
                    </div>
                    <div class="dtrack"><div class="dfill alt" style="width:{(t.value / e.total) * 100}%"></div></div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <p class="muted small foot">{result?.coverageNote}</p>
  {/if}
</section>

<style>
  .small { font-size: 12px; }
  .total { display: flex; align-items: baseline; gap: 10px; margin-bottom: 14px; }
  .total .num { font-size: 28px; font-weight: 700; color: var(--bad); }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .enemy { border-radius: 8px; }
  .row {
    display: flex; justify-content: space-between; align-items: baseline; gap: 10px; width: 100%;
    background: none; border: none; padding: 0 0 3px; cursor: pointer; color: var(--text); text-align: left;
  }
  .lbl { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
  .chev { color: var(--muted); font-size: 10px; transition: transform 0.12s; display: inline-block; }
  .chev.rot { transform: rotate(90deg); }
  .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name :global(a) { color: var(--text); text-decoration: none; }
  .name :global(a:hover) { text-decoration: underline; color: var(--accent); }
  .mult { font-size: 11px; color: var(--muted); flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .val { font-variant-numeric: tabular-nums; color: var(--muted); flex-shrink: 0; display: flex; align-items: baseline; gap: 8px; }
  .pctv { color: var(--text); opacity: 0.6; font-size: 12px; }

  /* Legend for the segmented bar's preventable-damage split. */
  .legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: -6px 0 14px; font-size: 12px; color: var(--muted); }
  .lg { display: inline-flex; align-items: center; gap: 6px; }
  .lg b { color: var(--text); font-weight: 600; font-variant-numeric: tabular-nums; }
  .sw { width: 10px; height: 10px; border-radius: 2px; flex-shrink: 0; display: inline-block; }
  .sw.intr { background: #c58aff; }
  .sw.disp { background: #4fd0c9; }
  .sw.other { background: var(--bad, crimson); opacity: 0.7; }
  .sw.blank { background: transparent; }

  /* Segmented bar (interruptible / dispellable / other) + hover breakdown card. */
  .bar-wrap { position: relative; }
  .track { height: 6px; background: var(--track, rgba(255,255,255,0.06)); border-radius: 3px; overflow: hidden; }
  .track.seg { display: flex; }
  .fill { height: 100%; }
  .fill.intr { background: #c58aff; }
  .fill.disp { background: #4fd0c9; }
  .fill.other { background: var(--bad, crimson); opacity: 0.7; }
  .pop {
    position: absolute; z-index: 20; top: calc(100% + 6px); left: 0; min-width: 230px;
    display: none; padding: 8px 10px; border-radius: 8px;
    background: rgba(12, 25, 50, 0.98); border: 1px solid var(--border); box-shadow: 0 18px 48px rgba(0, 0, 0, 0.45);
  }
  .bar-wrap:hover .pop { display: block; }
  .pop-h { font-size: 12px; font-weight: 700; margin-bottom: 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Each split portion: a header row (swatch · label · value · pct) over a percentage bar. */
  .pm { margin-top: 7px; }
  .pm-h { display: grid; grid-template-columns: 12px 1fr auto auto; align-items: center; gap: 8px; font-size: 12px; margin-bottom: 3px; }
  .pm-l { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pm-v { font-variant-numeric: tabular-nums; color: var(--text); }
  .pm-p { font-variant-numeric: tabular-nums; color: var(--muted); min-width: 34px; text-align: right; }
  .pm-track { height: 5px; background: var(--track, rgba(255,255,255,0.06)); border-radius: 3px; overflow: hidden; }
  .pm-fill { height: 100%; }
  .pm-fill.intr { background: #c58aff; }
  .pm-fill.disp { background: #4fd0c9; }
  .pm-fill.other { background: var(--bad, crimson); opacity: 0.7; }
  .pm-tot { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 600;
    border-top: 1px solid var(--border); margin-top: 8px; padding-top: 6px; }
  .pm-tot .pm-v { font-variant-numeric: tabular-nums; }

  .detail { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; margin: 10px 0 6px; padding-left: 17px; }
  .dh { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .dbar { margin-bottom: 6px; }
  .dlbl { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; margin-bottom: 2px; }
  .dn { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dn :global(a) { color: var(--text); text-decoration: none; }
  .dn :global(a:hover) { text-decoration: underline; color: var(--accent); }
  .dv { font-variant-numeric: tabular-nums; color: var(--muted); flex-shrink: 0; }
  .dtrack { height: 4px; background: var(--track, rgba(255,255,255,0.06)); border-radius: 2px; overflow: hidden; }
  .dfill { height: 100%; background: var(--accent); opacity: 0.7; }
  .dfill.alt { background: var(--warn); }
  .foot { margin: 14px 0 0; }
  @media (max-width: 720px) { .detail { grid-template-columns: 1fr; gap: 6px; } }
</style>
