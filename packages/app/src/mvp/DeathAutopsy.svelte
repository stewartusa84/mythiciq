<!-- Death autopsy graph: the pre-death window (≤ AUTOPSY_WINDOW_MS, 8s) as one picture.
     - HP plotted as a line/area; hover an event dot to see what moved it (damage/heal card).
     - Horizontal tracks for self-survival defensives (muted = available, glowing = active) and for
       any dangerous debuff that was on the player.
     - Vertical lines for major moments (avoidable hits + the killing blow).
     The data is baked by the engine (deaths.recap → row.autopsy); this is pure rendering. -->
<script lang="ts">
  import type { DeathAutopsy, AutopsyEvent } from '@wow/engine';
  import { abbrev } from './report.js';
  import { tip } from './tip.js';
  import { anon } from './anon.svelte.js';
  import type { SeekOptions } from './replayController.svelte.js';

  type SeekFn = (ms: number, opts?: SeekOptions) => void;
  let { autopsy, onSeek }: { autopsy: DeathAutopsy; onSeek?: SeekFn } = $props();

  // --- layout ---------------------------------------------------------------
  let w = $state(0); // measured chart width (px); 0 until mounted
  const PAD_L = 8;
  const PAD_R = 8;
  const PAD_T = 8;
  const HP_H = 92; // HP plot height
  const AXIS_H = 14; // time-axis strip under the HP plot
  const ROW_H = 14; // a defensive/debuff track row
  const ROW_GAP = 4;

  let rows = $derived(autopsy.defensives.length + autopsy.debuffs.length);
  let plotTop = PAD_T;
  let plotBottom = $derived(PAD_T + HP_H);
  let tracksTop = $derived(plotBottom + AXIS_H);
  let height = $derived(tracksTop + rows * (ROW_H + ROW_GAP) + 4);
  let innerW = $derived(Math.max(0, w - PAD_L - PAD_R));

  let span = $derived(Math.max(1, autopsy.endMs - autopsy.startMs));
  function x(ms: number): number {
    return PAD_L + (innerW * (ms - autopsy.startMs)) / span;
  }
  // HP fraction → y (1.0 at top of plot, 0 at bottom).
  function yFrac(f: number): number {
    return plotBottom - Math.max(0, Math.min(1, f)) * HP_H;
  }

  function fracOf(hp: number, maxHp: number): number {
    return maxHp > 0 ? hp / maxHp : 0;
  }
  // hold-last HP fraction at ms (fallback for an event with no baked post-event fraction)
  function hpFracAt(ms: number): number {
    const s = autopsy.hp;
    let f = s.length ? fracOf(s[0]!.hp, s[0]!.maxHp) : 0;
    for (const p of s) {
      if (p.ms > ms) break;
      f = fracOf(p.hp, p.maxHp);
    }
    return f;
  }

  let hpPoints = $derived(autopsy.hp.map((p) => `${x(p.ms).toFixed(1)},${yFrac(fracOf(p.hp, p.maxHp)).toFixed(1)}`).join(' '));
  let hpArea = $derived(
    autopsy.hp.length
      ? `${PAD_L},${plotBottom} ${hpPoints} ${x(autopsy.endMs).toFixed(1)},${plotBottom}`
      : '',
  );

  // gridlines at 25/50/75/100%
  const GRID = [1, 0.75, 0.5, 0.25];

  function evRadius(ev: AutopsyEvent): number {
    const m = autopsy.maxHp > 0 ? Math.abs(ev.amount) / autopsy.maxHp : 0;
    return Math.max(2.5, Math.min(7, 2.5 + m * 9));
  }
  function evY(ev: AutopsyEvent): number {
    return yFrac(ev.hpFractionAfter ?? hpFracAt(ev.ms));
  }

  // --- hover card -----------------------------------------------------------
  let hover = $state<{ ev: AutopsyEvent; px: number; py: number } | null>(null);
  function relSec(ms: number): string {
    return `${((ms - autopsy.endMs) / 1000).toFixed(1)}s`;
  }
  function seek(ms: number, label: string) {
    onSeek?.(ms, { label });
  }
</script>

<div class="autopsy" bind:clientWidth={w}>
  {#if w > 60}
    <svg {height} width={w} viewBox={`0 0 ${w} ${height}`} role="img" aria-label="death autopsy timeline">
      <!-- HP plot background + gridlines -->
      <rect x={PAD_L} y={plotTop} width={innerW} height={HP_H} class="plotbg" rx="4" />
      {#each GRID as g (g)}
        <line x1={PAD_L} x2={w - PAD_R} y1={yFrac(g)} y2={yFrac(g)} class="grid" />
        <text x={PAD_L + 3} y={yFrac(g) - 2} class="gridlbl">{Math.round(g * 100)}%</text>
      {/each}

      <!-- vertical markers: major moments -->
      {#each autopsy.markers as m, mi (mi)}
        <g
          class="marker {m.kind}"
          role="button"
          tabindex="-1"
          onclick={() => seek(m.ms, m.kind === 'avoidable' ? `avoidable: ${m.name}` : `killing blow: ${m.name}`)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') seek(m.ms, m.name); }}
          use:tip={`${m.kind === 'avoidable' ? '⚠ Avoidable' : '☠ Killing blow'} · ${m.name}${m.amount ? ' · ' + abbrev(m.amount) : ''} · ${relSec(m.ms)}`}
        >
          <!-- wide transparent line widens the hover/click target beyond the thin visible stroke -->
          <line class="mhit" x1={x(m.ms)} x2={x(m.ms)} y1={plotTop} y2={tracksTop + rows * (ROW_H + ROW_GAP)} />
          <line x1={x(m.ms)} x2={x(m.ms)} y1={plotTop} y2={tracksTop + rows * (ROW_H + ROW_GAP)} />
          <text x={x(m.ms)} y={plotTop + 9} class="mlbl">{m.kind === 'avoidable' ? '⚠' : '☠'}</text>
        </g>
      {/each}

      <!-- HP area + line -->
      {#if hpArea}
        <polygon points={hpArea} class="hparea" />
        <polyline points={hpPoints} class="hpline" />
      {/if}

      <!-- event dots -->
      {#each autopsy.events as ev, i (i)}
        <circle cx={x(ev.ms)} cy={evY(ev)} r={evRadius(ev)} class="ev {ev.kind}" class:avoid={ev.avoidable} />
        <!-- wide transparent hit target for easy hover -->
        <circle
          cx={x(ev.ms)}
          cy={evY(ev)}
          r={Math.max(7, evRadius(ev) + 3)}
          class="evhit"
          role="button"
          tabindex="-1"
          onmouseenter={() => (hover = { ev, px: x(ev.ms), py: evY(ev) })}
          onmouseleave={() => (hover = null)}
          onclick={() => seek(ev.ms, `${ev.spellName}`)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') seek(ev.ms, ev.spellName); }}
        />
      {/each}

      <!-- time axis -->
      <text x={PAD_L} y={plotBottom + 11} class="axis start">−{(autopsy.windowMs / 1000).toFixed(0)}s</text>
      <text x={w - PAD_R} y={plotBottom + 11} class="axis end">death</text>

      <!-- defensive + debuff tracks -->
      {#each autopsy.defensives as d, ri (d.spellId)}
        {@const ty = tracksTop + ri * (ROW_H + ROW_GAP)}
        <text x={PAD_L + 2} y={ty + ROW_H - 3} class="rowlbl def">{d.name}</text>
        {#each d.availableIntervals as iv, k (k)}
          <rect x={x(iv.startMs)} y={ty + 3} width={Math.max(1, x(iv.endMs) - x(iv.startMs))} height={ROW_H - 6} class="bar avail"
            use:tip={`${d.name} · available (off cooldown)`} />
        {/each}
        {#each d.activeIntervals as iv, k (k)}
          <rect x={x(iv.startMs)} y={ty + 1} width={Math.max(1, x(iv.endMs) - x(iv.startMs))} height={ROW_H - 2} class="bar active"
            use:tip={`${d.name} · ACTIVE`} />
        {/each}
      {/each}
      {#each autopsy.debuffs as db, di (db.spellId)}
        {@const ty = tracksTop + (autopsy.defensives.length + di) * (ROW_H + ROW_GAP)}
        <text x={PAD_L + 2} y={ty + ROW_H - 3} class="rowlbl debuff">{db.name}</text>
        {#each db.intervals as iv, k (k)}
          <rect x={x(iv.startMs)} y={ty + 1} width={Math.max(1, x(iv.endMs) - x(iv.startMs))} height={ROW_H - 2} class="bar dbf" class:removable={db.removable}
            use:tip={`${db.name} · dangerous debuff${db.removable ? ' (removable)' : ' (heal through)'}`} />
        {/each}
      {/each}
    </svg>

    {#if hover}
      {@const ev = hover.ev}
      <div class="acard" style="left:{hover.px}px; top:{hover.py}px;">
        <div class="ah">
          <span class="atag {ev.kind}">{ev.kind === 'damage' ? '−' : '+'}{abbrev(ev.amount)}</span>
          <span class="aname">{ev.spellName}</span>
        </div>
        <div class="asub">
          {ev.kind === 'damage' ? 'from' : 'by'} {anon.name(ev.sourceName) || 'environment'} · {relSec(ev.ms)}
        </div>
        {#if ev.kind === 'damage' && (ev.absorbed || ev.overkill)}
          <div class="asub small">
            {#if ev.absorbed}◈ {abbrev(ev.absorbed)} absorbed{/if}{#if ev.absorbed && ev.overkill} · {/if}{#if ev.overkill}{abbrev(ev.overkill)} overkill{/if}
          </div>
        {/if}
        {#if ev.kind === 'heal' && ev.overheal}
          <div class="asub small">{abbrev(ev.overheal)} overheal</div>
        {/if}
        {#if ev.avoidable}<div class="asub avoidline">⚠ avoidable damage</div>{/if}
        {#if ev.hpFractionAfter !== null}<div class="asub small">→ {Math.round(ev.hpFractionAfter * 100)}% HP</div>{/if}
      </div>
    {/if}
  {/if}
</div>

<style>
  .autopsy { position: relative; width: 100%; margin-top: 4px; }
  svg { display: block; width: 100%; overflow: visible; }

  .plotbg { fill: rgba(3, 8, 18, 0.45); stroke: var(--border); stroke-width: 1; }
  .grid { stroke: var(--border); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.5; }
  .gridlbl { fill: var(--muted); font-size: 9px; opacity: 0.7; }

  .hparea { fill: rgba(251, 113, 133, 0.16); }
  .hpline { fill: none; stroke: #ff9bb0; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }

  .ev { stroke: rgba(3, 8, 18, 0.85); stroke-width: 1; }
  .ev.damage { fill: var(--bad); }
  .ev.heal { fill: var(--good); }
  .ev.avoid { stroke: var(--warn); stroke-width: 2; }
  .evhit { fill: transparent; cursor: pointer; }

  .marker line { stroke-width: 1.5; opacity: 0.55; }
  .marker.avoidable line { stroke: var(--warn); stroke-dasharray: 3 2; }
  .marker.killing-blow line { stroke: var(--bad); }
  .marker { cursor: pointer; }
  /* wide, invisible hover/click target — `pointer-events:stroke` hit-tests the full width despite
     being transparent, so the thin dotted line is easy to grab. */
  .marker line.mhit { stroke: transparent; stroke-width: 14; opacity: 1; stroke-dasharray: none; pointer-events: stroke; }
  .marker:hover line:not(.mhit) { opacity: 0.95; }
  .mlbl { font-size: 10px; text-anchor: middle; }
  .marker.avoidable .mlbl { fill: var(--warn); }
  .marker.killing-blow .mlbl { fill: var(--bad); }

  .axis { fill: var(--muted); font-size: 9.5px; }
  .axis.end { text-anchor: end; }

  .rowlbl { font-size: 9.5px; dominant-baseline: auto; }
  .rowlbl.def { fill: var(--muted); }
  .rowlbl.debuff { fill: var(--warn); }

  .bar { rx: 2px; }
  /* available = muted/gray; active = bright glow */
  .bar.avail { fill: rgba(120, 140, 175, 0.28); }
  .bar.active { fill: var(--accent); filter: drop-shadow(0 0 3px var(--accent)); }
  .bar.dbf { fill: rgba(251, 113, 133, 0.5); }
  .bar.dbf.removable { fill: rgba(251, 191, 36, 0.55); }

  .acard {
    position: absolute; transform: translate(-50%, calc(-100% - 10px)); pointer-events: none;
    background: rgba(3, 8, 18, 0.97); border: 1px solid var(--border); border-radius: 7px;
    padding: 6px 9px; min-width: 130px; max-width: 230px; z-index: 30;
    box-shadow: 0 6px 22px rgba(0, 0, 0, 0.5);
  }
  .ah { display: flex; align-items: baseline; gap: 7px; }
  .atag { font-weight: 800; font-variant-numeric: tabular-nums; font-size: 14px; }
  .atag.damage { color: var(--bad); }
  .atag.heal { color: var(--good); }
  .aname { font-weight: 600; font-size: 12.5px; color: var(--text); }
  .asub { font-size: 11px; color: var(--muted); margin-top: 2px; }
  .asub.small { font-size: 10.5px; opacity: 0.85; }
  .asub.avoidline { color: var(--warn); font-weight: 600; }
</style>
