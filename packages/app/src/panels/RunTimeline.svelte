<!-- WCL-style full-run timeline for the replay. A single time axis (run start→end) drives, in order:
     boss-encounter highlight bands, a mirrored damage/healing area+line chart (done above the midline,
     taken below), overlay marker lanes (deaths / interrupts / missed mechanics / low-HP / custom
     metrics), a playhead at the clock T, and an aligned seek slider. All horizontal positions map
     through the same x(ms) so everything lines up in time. The chart paths are $derived from the view
     (computed once per load); only the playhead/seek move per frame. -->
<script lang="ts">
  import type { ReplayView } from '@wow/engine';
  import { anon } from '../mvp/anon.svelte.js';
  import { mmss } from '../mvp/report.js';
  import WowheadLink from '../mvp/WowheadLink.svelte';
  import type { SeekHighlight } from '../mvp/replayController.svelte.js';

  type MetricWindowLite = { label: string; startMs: number; endMs: number; unitName?: string; detail?: string; color?: string; spellId?: number; id?: string };
  type LowHp = { unitId: number; name: string; windows: { startMs: number; endMs: number }[] };

  let {
    view,
    t,
    lowHp = [],
    windows = [],
    focus = null,
    onScrub,
    onJump,
  }: {
    view: ReplayView;
    t: number;
    lowHp?: LowHp[];
    windows?: MetricWindowLite[];
    focus?: SeekHighlight | null;
    /** scrub the clock exactly here (slider / click on chart) */
    onScrub: (ms: number) => void;
    /** jump to a moment (marker click) — parent may apply a lead-in */
    onJump: (ms: number) => void;
  } = $props();

  const first = $derived(view.firstMs);
  const last = $derived(view.lastMs);
  const dur = $derived(Math.max(last - first, 1));

  // Lane visibility toggles (shown in the legend row). Persisted so the preference sticks across runs.
  const lsBool = (k: string, dflt: boolean): boolean => {
    try { const v = localStorage.getItem(k); return v === null ? dflt : v === '1'; } catch { return dflt; }
  };
  let showCapacity = $state(lsBool('rt.showCapacity', true));
  let showInterrupts = $state(lsBool('rt.showInterrupts', true));
  let showAvoidable = $state(lsBool('rt.showAvoidable', true));
  $effect(() => { try { localStorage.setItem('rt.showCapacity', showCapacity ? '1' : '0'); } catch { /* ignore */ } });
  $effect(() => { try { localStorage.setItem('rt.showInterrupts', showInterrupts ? '1' : '0'); } catch { /* ignore */ } });
  $effect(() => { try { localStorage.setItem('rt.showAvoidable', showAvoidable ? '1' : '0'); } catch { /* ignore */ } });

  // Lucide line icons for the toggle buttons.
  const ICON_CAPACITY =
    '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>';
  const ICON_INTERRUPTS =
    '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>';
  const ICON_AVOIDABLE =
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>';
  /** ms → percent across the axis (for DOM overlays). */
  const pct = (ms: number) => ((ms - first) / dur) * 100;
  const rel = (ms: number) => mmss(ms - first);
  /** Keep an edge-anchored chip (hover readout / current-time) from clipping at the chart edges. */
  const tipShift = (p: number) => (p < 8 ? '0' : p > 92 ? '-100%' : '-50%');

  const PLAYER_COLORS = ['#d9534f', '#e07b39', '#caa43a', '#5aa84a', '#3a93b0', '#8a5fb0', '#c45c8a'];
  const METRIC_PALETTE = ['#e8a000', '#3a93b0', '#8a5fb0', '#5aa84a', '#c45c8a', '#caa43a'];

  // ---- chart geometry (virtual viewBox 1000 × 100, non-uniformly scaled to fill width) ----
  const VW = 1000, H = 100, MID = 50, AMP = 47;
  const tl = $derived(view.timeline());
  // bucket-center x in [0, VW]
  const bx = (b: number) => (((tl.startMs - first) + b * tl.bucketMs + tl.bucketMs / 2) / dur) * VW;
  const maxOf = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), 0);
  // Damage done (outgoing DPS) dwarfs damage taken in M+, so a shared max flattens the taken area
  // into an invisible sliver. Scale each to ITS OWN max — each fills its half; the point of the
  // taken series is the SHAPE/timing of incoming spikes, not magnitude-comparison with outgoing.
  const dmgDoneMax = $derived(Math.max(1, maxOf(tl.dmgDone)));
  const dmgTakenMax = $derived(Math.max(1, maxOf(tl.dmgTaken)));
  // Healing done ≈ healing received (healers heal the group), so a shared max keeps them comparable.
  const healMax = $derived(Math.max(1, maxOf(tl.healDone), maxOf(tl.healTaken)));

  // dir: -1 = up (offense / done), +1 = down (defense / taken)
  function areaPath(vals: number[], max: number, dir: 1 | -1): string {
    const n = vals.length;
    if (!n) return '';
    let d = `M ${bx(0).toFixed(1)} ${MID}`;
    for (let b = 0; b < n; b++) d += ` L ${bx(b).toFixed(1)} ${(MID + dir * (vals[b]! / max) * AMP).toFixed(1)}`;
    d += ` L ${bx(n - 1).toFixed(1)} ${MID} Z`;
    return d;
  }
  function linePts(vals: number[], max: number, dir: 1 | -1): string {
    return vals.map((v, b) => `${bx(b).toFixed(1)},${(MID + dir * (v / max) * AMP).toFixed(1)}`).join(' ');
  }
  const dmgDonePath = $derived(areaPath(tl.dmgDone, dmgDoneMax, -1));
  const dmgTakenPath = $derived(areaPath(tl.dmgTaken, dmgTakenMax, 1));
  const healDonePts = $derived(linePts(tl.healDone, healMax, -1));
  const healTakenPts = $derived(linePts(tl.healTaken, healMax, 1));

  // ---- overlays (computed once from the view) ----
  const encounters = $derived(view.encounters());
  const deaths = $derived(view.deathsBetween(first, last).filter((d) => d.isPlayer));
  const interrupts = $derived(view.interrupts());
  const missed = $derived(view.avoidableHits());
  // Healer capacity band: merge the per-bucket capacity series into contiguous tone segments (green
  // comfortable / amber working / red maxed) so the lane is a continuous pressure read, not 1000 cells.
  const CAP_AMBER = 0.55;
  const CAP_RED = 0.8;
  const capTone = (c: number): 'green' | 'amber' | 'red' => (c >= CAP_RED ? 'red' : c >= CAP_AMBER ? 'amber' : 'green');
  const capacityLanes = $derived.by(() => {
    const tl = view.timeline();
    return view.healerUnits().map((u) => {
      const series = view.capacitySeries(u.unitId) ?? [];
      const segs: { startMs: number; endMs: number; tone: 'green' | 'amber' | 'red'; avg: number }[] = [];
      let i = 0;
      while (i < series.length) {
        const tone = capTone(series[i]!);
        let j = i;
        let sum = 0;
        while (j < series.length && capTone(series[j]!) === tone) { sum += series[j]!; j++; }
        segs.push({ startMs: tl.startMs + i * tl.bucketMs, endMs: tl.startMs + j * tl.bucketMs, tone, avg: sum / (j - i) });
        i = j;
      }
      return { unitId: u.unitId, name: u.name, segs };
    });
  });
  // group custom-metric windows by their identifier (fallback: label) → one colored lane each, tagged
  // with the capital-letter designation that also labels the matching row on the Insights page.
  const metricGroups = $derived.by(() => {
    const map = new Map<string, { id: string; label: string; color: string; spellId?: number; windows: MetricWindowLite[] }>();
    for (const w of windows) {
      const key = w.id ?? w.label;
      let g = map.get(key);
      if (!g) { g = { id: w.id ?? String.fromCharCode(65 + map.size), label: w.label, color: w.color ?? METRIC_PALETTE[map.size % METRIC_PALETTE.length]!, ...(w.spellId ? { spellId: w.spellId } : {}), windows: [] }; map.set(key, g); }
      g.windows.push(w);
    }
    return [...map.values()];
  });

  let chartEl = $state<HTMLElement | null>(null);
  function fracFromX(clientX: number): number {
    if (!chartEl) return 0;
    const r = chartEl.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / Math.max(r.width, 1)));
  }
  function seekFromX(clientX: number) {
    onScrub(first + fracFromX(clientX) * dur);
  }

  // Hover readout: the time under the cursor while pointing at the seek/chart surface.
  let hoverMs = $state<number | null>(null);
  function onHoverMove(e: MouseEvent) {
    hoverMs = first + fracFromX(e.clientX) * dur;
  }

  // Metric hover card: ONE shared JS-positioned popover used by both the lane designator (A/B…) and the
  // individual band segments. It shows the metric card + a list of segment timeframes (one for a band,
  // all of them for the designator), grouped by watched unit so the unit shows once on its own line.
  // It flips above/below the anchor based on available space and caps its height to the viewport, so a
  // long list is always fully visible (scrolls internally) — never sliding under the drawer handle.
  type Seg = { startMs: number; endMs: number; unitName?: string; detail?: string };
  type HoverCard = {
    id: string; label: string; color: string; spellId?: number;
    segments: Seg[]; source: 'band' | 'gutter';
    cx: number; top: number; bottom: number; // anchor rect (viewport px)
  };
  let hoverCard = $state<HoverCard | null>(null);
  // `cardLive` = the card is interactive (pointer-events on) + shows a reach-in bridge. Hover-INTENT
  // resolves the tension between "updates live while sweeping" and "hoverable to reach the spell link":
  // a band card starts click-through (so moving band→band keeps updating it, never intercepting the next
  // band's hover) and only goes live after the cursor settles on a band; the gutter (A/B) card — anchored
  // off in the gutter, away from any bands — goes live immediately.
  let cardLive = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const SETTLE_MS = 200; // pause this long on a band → the card becomes grabbable
  function clearSettle() { if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; } }
  function keepCard() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }
  function hideCardSoon() {
    keepCard();
    clearSettle();
    hideTimer = setTimeout(() => { hoverCard = null; cardLive = false; }, 240);
  }
  function showCard(e: Event, mg: { id: string; label: string; color: string; spellId?: number }, segments: Seg[], source: 'band' | 'gutter') {
    keepCard();
    clearSettle();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hoverCard = {
      id: mg.id, label: mg.label, color: mg.color, spellId: mg.spellId, source,
      segments: segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, unitName: s.unitName, detail: s.detail })),
      cx: r.left + r.width / 2, top: r.top, bottom: r.bottom,
    };
    // Gutter card: live immediately (no bands near it). Band card: click-through until the cursor settles.
    if (source === 'gutter') cardLive = true;
    else { cardLive = false; settleTimer = setTimeout(() => (cardLive = true), SETTLE_MS); }
  }
  // Group a card's segments by watched unit so the unit name is shown once (its own line), not inlined
  // on every timeframe.
  function groupByUnit(segs: Seg[]): { unit?: string; windows: Seg[] }[] {
    const map = new Map<string, Seg[]>();
    for (const s of segs) {
      const k = s.unitName ?? '';
      (map.get(k) ?? map.set(k, []).get(k)!).push(s);
    }
    return [...map.entries()].map(([unit, windows]) => ({ unit: unit || undefined, windows }));
  }
  // Position the card: anchored at the segment/badge center, flipped to whichever side has more room,
  // height-capped to that side so the whole card stays on screen (the timeframe list scrolls if needed).
  function placement(h: HoverCard) {
    const W = typeof window !== 'undefined' ? window.innerWidth : 9999;
    const H = typeof window !== 'undefined' ? window.innerHeight : 9999;
    const left = Math.max(120, Math.min(W - 120, h.cx));
    const above = h.top - 8;
    const below = H - h.bottom - 8;
    const side: 'above' | 'below' = below >= above ? 'below' : 'above';
    return { side, left, top: h.top, bottom: h.bottom, H, maxH: Math.max(90, side === 'below' ? below : above) };
  }
  function cardStyle(p: ReturnType<typeof placement>): string {
    const pos = p.side === 'below' ? `top:${p.bottom + 8}px` : `bottom:${p.H - p.top + 8}px`;
    return `left:${p.left}px; transform:translateX(-50%); max-height:${p.maxH}px; ${pos};`;
  }
  // A transparent corridor bridging the gap between the anchor and the card. Fixed + z-indexed so it
  // sits ABOVE the bands: moving the cursor onto the card crosses the bridge (which keeps the card open)
  // instead of a neighbouring band (which would hijack the card). Covers the 8px gap + a little overlap.
  function bridgeStyle(p: ReturnType<typeof placement>): string {
    const top = p.side === 'below' ? p.bottom : p.top - 12;
    return `left:${p.left}px; transform:translateX(-50%); width:180px; top:${top}px; height:12px;`;
  }
</script>

{#snippet ico(d: string)}
  <svg class="rt-ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html d}</svg>
{/snippet}

<div class="rt">
  <!-- legend (directly above the chart it describes) + lane-visibility toggles on the opposite side -->
  <div class="rt-row">
    <div class="rt-gutter"></div>
    <div class="rt-legend">
      <span class="li"><span class="sw" style="background:#d9534f"></span>dmg done</span>
      <span class="li"><span class="sw" style="background:#e0843a"></span>dmg taken</span>
      <span class="li"><span class="sw" style="background:#5fd08a"></span>heal done</span>
      <span class="li"><span class="sw" style="background:#4aa3d0"></span>heal taken</span>
    </div>
    <div class="rt-toggles">
      {#if capacityLanes.length}
        <button class="rt-toggle" class:on={showCapacity} aria-pressed={showCapacity} title="{showCapacity ? 'Hide' : 'Show'} healer capacity" onclick={() => (showCapacity = !showCapacity)}>{@render ico(ICON_CAPACITY)}</button>
      {/if}
      {#if interrupts.length}
        <button class="rt-toggle" class:on={showInterrupts} aria-pressed={showInterrupts} title="{showInterrupts ? 'Hide' : 'Show'} interrupts" onclick={() => (showInterrupts = !showInterrupts)}>{@render ico(ICON_INTERRUPTS)}</button>
      {/if}
      {#if missed.length}
        <button class="rt-toggle" class:on={showAvoidable} aria-pressed={showAvoidable} title="{showAvoidable ? 'Hide' : 'Show'} avoidable damage taken" onclick={() => (showAvoidable = !showAvoidable)}>{@render ico(ICON_AVOIDABLE)}</button>
      {/if}
    </div>
  </div>

  <!-- chart row: a left gutter (matches the lane-label column) keeps the plot area aligned with the
       marker lanes + seek slider below, so every time position lines up vertically. -->
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="rt-row">
    <div class="rt-gutter"></div>
    <div class="rt-chart" bind:this={chartEl} onclick={(e) => seekFromX(e.clientX)} onmousemove={onHoverMove} onmouseleave={() => (hoverMs = null)}>
    {#each encounters as e (e.startMs)}
      <div
        class="rt-enc {e.success === false ? 'wipe' : e.success ? 'kill' : ''}"
        style="left:{pct(e.startMs)}%; width:{Math.max(pct(e.endMs) - pct(e.startMs), 0.4)}%"
      >
        <span class="rt-enc-name">{e.name}</span>
      </div>
    {/each}
    <svg class="rt-svg" viewBox="0 0 {VW} {H}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1={MID} x2={VW} y2={MID} class="rt-mid" />
      <path d={dmgTakenPath} class="rt-area dmgtaken" />
      <path d={dmgDonePath} class="rt-area dmgdone" />
      <polyline points={healTakenPts} class="rt-line healtaken" />
      <polyline points={healDonePts} class="rt-line healdone" />
    </svg>
    {#if focus}
      <div class="rt-focus" style="left:{pct(focus.startMs)}%; width:{Math.max(pct(focus.endMs) - pct(focus.startMs), 0.5)}%"></div>
    {/if}
    <div class="rt-playhead" style="left:{pct(t)}%">
      <div class="rt-now" style="transform: translateX({tipShift(pct(t))})">{rel(t)}</div>
    </div>
    {#if hoverMs !== null}
      {@const hp = pct(hoverMs)}
      <div class="rt-hover-line" style="left:{hp}%"></div>
      <div class="rt-hover-tip" style="left:{hp}%; transform: translateX({tipShift(hp)})">{rel(hoverMs)}</div>
    {/if}
    </div>
  </div>

  <!-- overlay marker lanes (time-aligned with the chart above) -->
  <div class="rt-lanes">
    {#if deaths.length}
      <div class="rt-lane">
        <div class="rt-gutter rt-lbl">deaths</div>
        <div class="rt-track">
          {#each deaths as d, i (d.unitId + ':' + d.ms + ':' + i)}
            <button class="rt-mk death" style="left:{pct(d.ms)}%" title="☠ {anon.name(d.name)} · {rel(d.ms)}" aria-label="death {anon.name(d.name)}" onclick={() => onJump(d.ms)}>☠</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if showInterrupts && interrupts.length}
      <div class="rt-lane">
        <div class="rt-gutter rt-lbl" title="enemy casts that were interrupted (↯)">interrupts</div>
        <div class="rt-track">
          {#each interrupts as ie, i (ie.byUnit + ':' + ie.ms + ':' + i)}
            <button class="rt-mk intr" style="left:{pct(ie.ms)}%" title="↯ {anon.name(view.nameOf(ie.byUnit) ?? '')} kicked {view.spellName(ie.spellId)} · {rel(ie.ms)}" aria-label="interrupt" onclick={() => onJump(ie.ms)}>↯</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if showAvoidable && missed.length}
      <!-- avoidable damage a player took from a mechanic they could have dodged (⚠). -->
      <div class="rt-lane">
        <div class="rt-gutter rt-lbl" title="avoidable damage taken — mechanics a player could have dodged (⚠)">avoidable</div>
        <div class="rt-track">
          {#each missed as m, i (i)}
            <button class="rt-mk miss" style="left:{pct(m.ms)}%" title="⚠ {anon.name(view.nameOf(m.unitId) ?? '')} hit by {view.spellName(m.spellId)} ({Math.round(m.amount).toLocaleString()}) · {rel(m.ms)}" aria-label="avoidable damage" onclick={() => onJump(m.ms)}>⚠</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if lowHp.length}
      <div class="rt-lane">
        <div class="rt-gutter rt-lbl" title="players below 25% HP">low HP</div>
        <div class="rt-track">
          {#each lowHp as g, gi (g.unitId)}
            {#each g.windows as w, i (i)}
              <button
                class="rt-band"
                style="left:{pct(w.startMs)}%; width:{Math.max(pct(w.endMs) - pct(w.startMs), 0.3)}%; background:{PLAYER_COLORS[gi % PLAYER_COLORS.length]}"
                title="{anon.name(g.name)} below 25% HP · {rel(w.startMs)}→{rel(w.endMs)}"
                aria-label="{anon.name(g.name)} low HP"
                onclick={() => onScrub(w.startMs)}></button>
            {/each}
          {/each}
        </div>
      </div>
    {/if}
    {#if showCapacity}
      {#each capacityLanes as cl (cl.unitId)}
        <div class="rt-lane">
          <div class="rt-gutter rt-lbl" title="{anon.name(cl.name)} — healer capacity: share of AVAILABLE cast time spent on healing casts (≈ how busy they are). Disc/Mistweaver count damage too. Approx; ignores movement/LoS/mana.">hcap</div>
          <div class="rt-track">
            {#each cl.segs as s, i (i)}
              <button
                class="rt-cap rt-cap-{s.tone}"
                style="left:{pct(s.startMs)}%; width:{Math.max(pct(s.endMs) - pct(s.startMs), 0.2)}%"
                title="{anon.name(cl.name)} ~{Math.round(s.avg * 100)}% capacity · {rel(s.startMs)}→{rel(s.endMs)}"
                aria-label="capacity {Math.round(s.avg * 100)}%"
                onclick={() => onScrub(s.startMs)}></button>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
    {#each metricGroups as mg (mg.id)}
      <div class="rt-lane">
        <!-- gutter = a colored letter badge (matches the Insights row); hovering it shows the shared card
             listing every segment's timeframe. Hovering a band shows the same card for that one segment. -->
        <div class="rt-gutter rt-mgut">
          <span
            class="rt-mbadge"
            style="background:{mg.color}"
            role="button"
            tabindex="0"
            aria-label="{mg.label} — {mg.windows.length} segment{mg.windows.length === 1 ? '' : 's'}"
            onmouseenter={(e) => showCard(e, mg, mg.windows, 'gutter')}
            onmouseleave={hideCardSoon}
            onfocus={(e) => showCard(e, mg, mg.windows, 'gutter')}
            onblur={hideCardSoon}>{mg.id}</span>
        </div>
        <div class="rt-track">
          {#each mg.windows as w, i (i)}
            <button
              class="rt-band"
              style="left:{pct(w.startMs)}%; width:{Math.max(pct(w.endMs) - pct(w.startMs), 0.3)}%; background:{mg.color}"
              aria-label="{w.label} {rel(w.startMs)}→{rel(w.endMs)}"
              onmouseenter={(e) => showCard(e, mg, [w], 'band')}
              onmouseleave={hideCardSoon}
              onfocus={(e) => showCard(e, mg, [w], 'band')}
              onblur={hideCardSoon}
              onclick={() => onScrub(w.startMs)}></button>
          {/each}
        </div>
      </div>
    {/each}
  </div>

  <!-- time axis: 0:00 at the plot's left edge, run end at the right edge (click the chart to seek) -->
  <div class="rt-row">
    <div class="rt-gutter"></div>
    <div class="rt-axis"><span>0:00</span><span>{rel(last)}</span></div>
  </div>

  <!-- Shared metric hover card (fixed, flipped + height-capped to stay on screen). Used by both the lane
       designator (all segments) and a single band; segments grouped by unit (unit shown once). Stays open
       while hovered so the Wowhead spell link is usable. -->
  {#if hoverCard}
    {@const p = placement(hoverCard)}
    <!-- Bridge + interactivity appear once the card is "live": immediately for the gutter card, or after
         a brief settle for a band card (so sweeping band→band keeps updating it click-through, and pausing
         lets you reach in to hover the Wowhead spell link). -->
    {#if cardLive}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="rt-card-bridge" style={bridgeStyle(p)} aria-hidden="true" onmouseenter={keepCard} onmouseleave={hideCardSoon}></div>
    {/if}
    <div class="rt-card" class:passthru={!cardLive} style={cardStyle(p)} role="tooltip" onmouseenter={keepCard} onmouseleave={hideCardSoon}>
      <div class="rt-card-head">
        <div class="rt-mpop-row"><span class="rt-mbadge" style="background:{hoverCard.color}">{hoverCard.id}</span><span class="rt-mpop-label">{hoverCard.label}</span></div>
        {#if hoverCard.spellId}<div class="rt-mpop-spell"><WowheadLink id={hoverCard.spellId} /></div>{/if}
      </div>
      <div class="rt-mpop-times">
        {#each groupByUnit(hoverCard.segments) as g (g.unit ?? '')}
          {#if g.unit}<div class="rt-mpop-unit">{anon.name(g.unit)}</div>{/if}
          {#each g.windows as w, i (i)}
            <div class="rt-mpop-time">⏱ {rel(w.startMs)} → {rel(w.endMs)}{#if w.detail} · {w.detail}{/if}</div>
          {/each}
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Every row is [gutter][plot]; the gutter is a fixed width shared by the lane labels, the chart, the
     seek slider, and the axis — so all plot areas start at the same x and have the same width, lining
     up vertically in time. */
  .rt { --rt-gutter: 66px; --rt-gap: 6px; display: flex; flex-direction: column; gap: 3px; margin: 2px 0 8px; }
  .rt-row { display: flex; align-items: center; gap: var(--rt-gap); }
  .rt-gutter { flex: 0 0 var(--rt-gutter); width: var(--rt-gutter); }
  .rt-chart {
    position: relative; flex: 1; min-width: 0; height: 88px; border: 1px solid var(--rp-border, #ccc); border-radius: 5px;
    overflow: hidden; background: var(--rp-surface-2, #f7f7f7); cursor: crosshair;
  }
  .rt-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  .rt-mid { stroke: var(--rp-border, #ccc); stroke-width: 1; vector-effect: non-scaling-stroke; opacity: 0.6; }
  .rt-area { stroke: none; }
  .rt-area.dmgdone { fill: #d9534f; opacity: 0.5; }
  .rt-area.dmgtaken { fill: #e0843a; opacity: 0.5; }
  .rt-line { fill: none; stroke-width: 1.4; vector-effect: non-scaling-stroke; opacity: 0.95; }
  .rt-line.healdone { stroke: #5fd08a; }
  .rt-line.healtaken { stroke: #4aa3d0; }
  /* Encounter highlight band: faint fill + large faint boss name. */
  .rt-enc { position: absolute; top: 0; bottom: 0; background: rgba(120, 150, 200, 0.09); border-left: 1px solid rgba(120,150,200,0.4); border-right: 1px solid rgba(120,150,200,0.4); pointer-events: none; overflow: hidden; }
  .rt-enc.kill { background: rgba(95, 208, 138, 0.1); border-color: rgba(95,208,138,0.4); }
  .rt-enc.wipe { background: rgba(217, 83, 79, 0.12); border-color: rgba(217,83,79,0.45); }
  .rt-enc-name {
    position: absolute; top: 4px; left: 50%; transform: translateX(-50%); white-space: nowrap;
    font-size: 13px; font-weight: 800; letter-spacing: 0.02em; opacity: 0.22;
    color: var(--rp-text, #222); pointer-events: none;
  }
  .rt-focus { position: absolute; top: 0; bottom: 0; background: var(--rp-focus, #ffc23d); opacity: 0.22; pointer-events: none; box-shadow: 0 0 0 1px var(--rp-focus, #e8a000) inset; }
  /* Current-time bar: bright accent line spanning the chart + a time chip pinned to its foot. */
  .rt-playhead { position: absolute; top: 0; bottom: 0; width: 2px; transform: translateX(-1px); background: var(--rp-focus, #e8a000); opacity: 1; pointer-events: none; z-index: 6; box-shadow: 0 0 5px rgba(0, 0, 0, 0.45); }
  .rt-playhead::before {
    content: ''; position: absolute; top: -1px; left: 50%; transform: translateX(-50%);
    border-left: 5px solid transparent; border-right: 5px solid transparent;
    border-top: 6px solid var(--rp-focus, #e8a000);
  }
  .rt-now {
    position: absolute; bottom: 2px; left: 0; padding: 1px 5px; border-radius: 3px; pointer-events: none;
    font-size: 11px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;
    background: var(--rp-focus, #e8a000); color: #1a1a1a; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
  }
  /* Hover readout: a dashed guide + a time chip following the cursor across the seek surface. */
  .rt-hover-line { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--rp-text, #111); opacity: 0.35; pointer-events: none; }
  .rt-hover-tip {
    position: absolute; top: 3px; padding: 1px 5px; border-radius: 3px; pointer-events: none;
    font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap;
    background: var(--rp-text, #111); color: var(--rp-surface, #fff); opacity: 0.9;
  }

  .rt-lanes { display: flex; flex-direction: column; gap: 2px; }
  .rt-lane { display: flex; align-items: center; gap: var(--rt-gap); }
  .rt-lbl { text-align: right; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: var(--rp-muted, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  /* Metric lane gutter: a colored letter badge (the identifier, shared with the Insights row). Hovering
     it (or a band) opens the shared .rt-card popover below. */
  .rt-mgut { display: flex; align-items: center; justify-content: flex-end; }
  .rt-mbadge {
    display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px;
    padding: 0 3px; border-radius: 3px; color: #1a1a1a; font-size: 11px; font-weight: 800; line-height: 1;
    font-variant-numeric: tabular-nums; cursor: pointer;
  }
  /* Shared metric hover card: fixed, positioned + height-capped in JS (cardStyle) so it flips to the
     side with more room and never slides off-screen; a long timeframe list scrolls inside it. Narrow +
     tall for readability. The head (badge/label/spell) stays put; the timeframe list scrolls. */
  .rt-card {
    position: fixed; z-index: 50; min-width: 150px; max-width: 220px;
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--rp-surface, #fff); color: var(--rp-text, #222); border: 1px solid var(--rp-border, #ccc);
    border-radius: 6px; padding: 6px 8px; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
  }
  /* Transparent hover corridor between the anchor and the card (sits above the bands so they don't
     hijack the card while the cursor crosses). z just under the card. */
  .rt-card-bridge { position: fixed; z-index: 49; background: transparent; }
  /* Band card is click-through so moving across segments keeps updating it (never intercepts the next
     band's hover). The gutter card stays interactive so its Wowhead spell link is hoverable. */
  .rt-card.passthru { pointer-events: none; }
  .rt-card-head { flex: 0 0 auto; }
  .rt-mpop-row { display: flex; align-items: center; gap: 6px; }
  .rt-mpop-label { font-size: 12px; font-weight: 600; text-transform: none; letter-spacing: 0; white-space: normal; }
  .rt-mpop-spell { margin-top: 4px; font-size: 12px; }
  .rt-mpop-spell :global(a) { text-decoration: none; }
  /* The watched unit on its own line (shown once per unit). */
  .rt-mpop-unit { margin-top: 6px; font-size: 12px; font-weight: 600; color: var(--rp-text, #222); }
  .rt-mpop-unit:first-child { margin-top: 0; }
  .rt-mpop-time { margin-top: 2px; font-size: 11px; font-variant-numeric: tabular-nums; color: var(--rp-muted, #777); }
  /* The timeframe list scrolls so the card stays within its capped height. */
  .rt-mpop-times { margin-top: 4px; flex: 1 1 auto; overflow-y: auto; display: flex; flex-direction: column; }
  .rt-track { position: relative; flex: 1; min-width: 0; height: 13px; background: var(--rp-surface-2, #f2f2f2); border-radius: 3px; }
  .rt-mk {
    position: absolute; top: 50%; transform: translate(-50%, -50%); padding: 0; width: 14px; height: 13px;
    line-height: 13px; font-size: 10px; text-align: center; border: none; background: transparent; cursor: pointer;
  }
  .rt-mk.death { color: #ff5566; }
  .rt-mk.intr { color: #7aa6e0; }
  .rt-mk.miss { color: #e0b34a; }
  .rt-mk:hover { filter: brightness(1.3); }
  .rt-band { position: absolute; top: 1px; bottom: 1px; min-width: 2px; padding: 0; border: none; border-radius: 2px; opacity: 0.8; cursor: pointer; }
  .rt-band:hover { opacity: 1; }
  /* Healer capacity band: a continuous green→amber→red pressure strip across the run. */
  .rt-cap { position: absolute; top: 0; bottom: 0; min-width: 1px; padding: 0; border: none; cursor: pointer; }
  .rt-cap:hover { filter: brightness(1.25); }
  .rt-cap-green { background: color-mix(in srgb, var(--rp-good, #5fd08a) 55%, transparent); }
  .rt-cap-amber { background: color-mix(in srgb, var(--rp-focus, #e8b84b) 70%, transparent); }
  .rt-cap-red { background: color-mix(in srgb, var(--rp-danger, #ff6b6b) 80%, transparent); }

  .rt-axis { flex: 1; min-width: 0; display: flex; justify-content: space-between; font-variant-numeric: tabular-nums; font-size: 11px; color: var(--rp-muted, #888); }

  .rt-legend { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; color: var(--rp-muted, #777); }
  .li { display: inline-flex; align-items: center; gap: 4px; }
  .sw { width: 11px; height: 9px; border-radius: 2px; display: inline-block; flex: 0 0 auto; }

  /* Lane-visibility toggles (right side of the legend row). Icon buttons; lit when the lane is shown. */
  .rt-toggles { flex: 0 0 auto; display: flex; gap: 4px; }
  .rt-toggle {
    display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 20px; padding: 0;
    border: 1px solid var(--rp-border, #ccc); border-radius: 4px; background: transparent; color: var(--rp-muted, #999);
    cursor: pointer; transition: color 0.12s, border-color 0.12s, background 0.12s;
  }
  .rt-toggle:hover { color: var(--rp-text, #222); border-color: var(--rp-text, #999); }
  .rt-toggle.on { color: var(--rp-focus, #e8a000); border-color: currentColor; background: color-mix(in srgb, currentColor 14%, transparent); }
  .rt-ti { width: 13px; height: 13px; display: block; }
</style>
