<!-- Mechanics tab: a scannable read of the run's group-execution mechanics instead of a raw analytic
     dump. Avoidable damage (bespoke), then Interrupts / Dispels / Cleanse presented as headline rates +
     class-colored magnitude bars + per-debuff removal efficiency, mirroring the Role Review design. -->
<script lang="ts">
  import type {
    RunReport, RosterEntry, OwnerInfo,
    AvoidableDamageResult, InterruptPriorityResult, DispelPriorityResult, RemovalResult,
    InterruptAccountabilityResult,
  } from '@wow/engine';
  import AvoidableDamage from '../AvoidableDamage.svelte';
  import WowheadLink from '../WowheadLink.svelte';
  import { analytic, runParticipants } from '../report.js';
  import { anon } from '../anon.svelte.js';
  import { classColorOf } from '../specVisuals.js';
  import { tip } from '../tip.js';
  import type { Lens } from '../avoidableAdvice.js';

  let { report, roster, owner }: { report: RunReport; owner?: OwnerInfo | null; roster: RosterEntry[] } = $props();

  // Lens: read mechanics through a tank/healer/dps perspective — drives which curated tip text shows.
  // Defaults to the log owner's role; an explicit pick persists across runs/sessions.
  const LENS_KEY = 'wow.mechanicsLens';
  const LENSES: { id: Lens; label: string }[] = [
    { id: 'tank', label: 'Tank' },
    { id: 'healer', label: 'Healer' },
    { id: 'dps', label: 'DPS' },
    { id: 'all', label: 'All roles' },
  ];
  function ownerLens(): Lens {
    const r = roster.find((e) => e.name === owner?.name)?.role;
    return r === 'tank' || r === 'healer' ? r : 'dps';
  }
  function initialLens(): Lens {
    try {
      const s = localStorage.getItem(LENS_KEY);
      if (s === 'tank' || s === 'healer' || s === 'dps' || s === 'all') return s;
    } catch { /* ignore */ }
    return ownerLens(); // default to the uploading player's role
  }
  let lens = $state<Lens>(initialLens());
  function persistLens() {
    try { localStorage.setItem(LENS_KEY, lens); } catch { /* ignore */ }
  }
  let lensHint = $derived(
    lens === 'all'
      ? 'showing advice for every role'
      : `how a ${lens === 'dps' ? 'DPS' : lens} handles these mechanics`,
  );

  let avoidable = $derived(analytic<AvoidableDamageResult>(report, 'avoidableDamage'));
  let interrupts = $derived(analytic<InterruptPriorityResult>(report, 'interrupts.priority'));
  let dispels = $derived(analytic<DispelPriorityResult>(report, 'dispels.priority'));
  let removal = $derived(analytic<RemovalResult>(report, 'removal.cleanse'));
  let acct = $derived(analytic<InterruptAccountabilityResult>(report, 'interrupts.accountability'));

  // ---- Praise: clean execution ----
  // Players who took ZERO avoidable damage — only meaningful when the run HAD avoidable damage to eat.
  let cleanAvoiders = $derived.by(() => {
    if (!avoidable || avoidable.totalAvoidable <= 0) return [] as string[];
    const hit = new Set((avoidable.byUnit ?? []).filter((u) => u.value > 0).map((u) => u.name));
    const participants = runParticipants(report);
    return roster.filter((r) => participants.has(r.name) && !hit.has(r.name)).map((r) => r.name);
  });
  // Players who kicked at least one dangerous cast and never let one they could have stopped go off.
  let perfectKickers = $derived((acct?.players ?? []).filter((p) => p.interrupted > 0 && p.missed === 0));
  let hasPraise = $derived(cleanAvoiders.length > 0 || perfectKickers.length > 0);

  // name → class color (analytics key rows by real name; anon only masks at render).
  let colorByName = $derived.by(() => {
    const m = new Map<string, string>();
    for (const r of roster) { const c = classColorOf(r.specId); if (c) m.set(r.name, c); }
    return m;
  });

  type Bar = { name: string; value: number; label: string; color?: string };
  let players = $derived(new Set(roster.map((r) => r.name)));
  function toBars<T extends { name: string }>(rows: T[] | undefined, getVal: (r: T) => number, fmt: (v: number) => string): Bar[] {
    return (rows ?? [])
      .filter((r) => players.has(r.name))
      .map((r) => ({ name: r.name, value: getVal(r), label: fmt(getVal(r)), color: colorByName.get(r.name) }))
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  const pct1 = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}%`;
  const sec = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
  const rate = (s: number, total: number) => (total > 0 ? s / total : null);

  // ---- Interrupts ----
  let intBars = $derived(toBars(interrupts?.bySource, (r) => r.value, (v) => `${v}`));
  let dangerInt = $derived.by(() => {
    const d = interrupts?.byPriority.dangerous;
    return d && d.success + d.missed > 0 ? d : null;
  });
  let regularInt = $derived.by(() => {
    const d = interrupts?.byPriority.regular;
    return d && d.success + d.missed > 0 ? d : null;
  });
  let hasInterrupts = $derived(!!interrupts && ((interrupts.total ?? 0) > 0 || !!dangerInt || !!regularInt));

  // ---- Dispels ----
  let dangerDispel = $derived.by(() => {
    const d = dispels?.byPriority.dangerous;
    return d && d.success + d.miss > 0 ? d : null;
  });
  let regularDispel = $derived.by(() => {
    const d = dispels?.byPriority.regular;
    return d && d.success + d.miss > 0 ? d : null;
  });
  let hasDispels = $derived(!!dangerDispel || !!regularDispel);

  // ---- Cleanse / Removal ----
  let topDebuffs = $derived((removal?.byDebuff ?? []).slice(0, 8));
  let topRemovers = $derived((removal?.byRemover ?? []).slice(0, 6));
  let unusedRemovers = $derived((removal?.unusedRemovers ?? []).slice(0, 6));
  let healThrough = $derived((removal?.healThrough ?? []).filter((h) => h.applied > 0));
  let hasRemoval = $derived(!!removal && (removal.overall.applied > 0 || removal.overall.healThrough > 0));
  // Compact duration: "1m 20s" / "45s".
  const dur = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);
</script>

{#snippet bars(rows: Bar[])}
  {@const max = Math.max(1, ...rows.map((r) => r.value))}
  <div class="bars">
    {#each rows as r (r.name)}
      <div class="barrow">
        <div class="bhead">
          <span class="bn" style={r.color ? `color:${r.color}` : ''}>{anon.name(r.name)}</span>
          <span class="bv">{r.label}</span>
        </div>
        <div class="track"><div class="fill" style="width:{(r.value / max) * 100}%;{r.color ? `background:${r.color}` : ''}"></div></div>
      </div>
    {/each}
  </div>
{/snippet}

{#snippet rateStat(success: number, total: number, label: string, help: string)}
  {@const r = rate(success, total)}
  <div class="stat">
    <span class="snum {r != null ? (r >= 0.8 ? 'ok' : r >= 0.5 ? 'warn' : 'bad') : ''}">{success}/{total}</span>
    <span class="slabel muted">{label}{#if r != null}<span class="pctchip">{pct1(r * 100)}</span>{/if}<span class="qmark" use:tip={help}>?</span></span>
  </div>
{/snippet}

{#snippet stat(num: string, label: string, help: string, tone: 'ok' | 'warn' | 'bad' | '' = '')}
  <div class="stat">
    <span class="snum {tone}">{num}</span>
    <span class="slabel muted">{label}<span class="qmark" use:tip={help}>?</span></span>
  </div>
{/snippet}

<div class="lensbar">
  <label class="lenslabel" for="mechlens">Lens</label>
  <select id="mechlens" class="lenssel" bind:value={lens} onchange={persistLens}>
    {#each LENSES as l (l.id)}<option value={l.id}>{l.label}</option>{/each}
  </select>
  <span class="lenshint muted">{lensHint}</span>
</div>

<AvoidableDamage result={avoidable} {lens} />

{#if hasPraise}
  <section class="rcard praise">
    <div class="rhead"><h3>🏅 Clean execution</h3></div>
    {#if cleanAvoiders.length}
      <div class="subh muted">No avoidable damage taken<span class="qmark" use:tip={'Players who ate ZERO avoidable mechanics this run, while avoidable damage WAS happening to others. They dodged everything the table knows about. Bounded by avoidable-list coverage.'}>?</span></div>
      <div class="chips">
        {#each cleanAvoiders as name (name)}
          <span class="pchip" style={colorByName.get(name) ? `border-color:${colorByName.get(name)}` : ''}>
            <span style={colorByName.get(name) ? `color:${colorByName.get(name)}` : ''}>{anon.name(name)}</span>
          </span>
        {/each}
      </div>
    {/if}
    {#if perfectKickers.length}
      <div class="subh muted">Perfect interrupts<span class="qmark" use:tip={'Players who interrupted at least one DANGEROUS cast and never let one go off that they could have stopped (zero missed while their interrupt was available). Clean kick record on the casts that matter.'}>?</span></div>
      <div class="chips">
        {#each perfectKickers as p (p.id)}
          <span class="pchip" style={colorByName.get(p.name) ? `border-color:${colorByName.get(p.name)}` : ''}>
            <span style={colorByName.get(p.name) ? `color:${colorByName.get(p.name)}` : ''}>{anon.name(p.name)}</span>
            <span class="cn">⚔ {p.interrupted}</span>
          </span>
        {/each}
      </div>
    {/if}
  </section>
{/if}

{#if hasInterrupts}
  <section class="rcard">
    <div class="rhead"><h3>Interrupts</h3>
      {#if interrupts}<div class="big"><span class="bignum">{interrupts.total}</span><span class="bigunit">total kicks</span></div>{/if}
    </div>
    <div class="strip">
      {#if dangerInt}{@render rateStat(dangerInt.success, dangerInt.success + dangerInt.missed, 'dangerous casts kicked', `Of the DANGEROUS interruptible enemy casts in this run (curated high-priority casts), how many were interrupted before they completed. A completed dangerous cast = a missed kick. This is the one that matters most — the casts that hurt.`)}{/if}
      {#if regularInt}{@render rateStat(regularInt.success, regularInt.success + regularInt.missed, 'regular casts kicked', `Of the regular (non-priority) interruptible enemy casts, how many were interrupted. Lower priority — kicking these is good but not as critical as the dangerous ones.`)}{/if}
    </div>
    {#if intBars.length}
      <div class="subh muted">Kicks by player</div>
      {@render bars(intBars)}
    {/if}
    <p class="foot muted small">Priority split is bounded by curated spell-table coverage; uncurated casts fall into the untracked pool.</p>
  </section>
{/if}

{#if hasDispels}
  <section class="rcard">
    <div class="rhead"><h3>Dispels</h3></div>
    <div class="strip">
      {#if dangerDispel}
        {@render rateStat(dangerDispel.success, dangerDispel.success + dangerDispel.miss, 'dangerous debuffs dispelled', `Of the DANGEROUS dispellable debuffs applied to players, how many were removed before they expired. The high-value dispels — leaving these up is what gets people killed.`)}
        {#if dangerDispel.latency.count > 0}{@render stat(sec(dangerDispel.latency.percentiles.p50), 'median latency', `Median time from a dangerous debuff landing to it being dispelled, over ${dangerDispel.latency.count} successful dispel(s). Lower = faster reaction.`)}{/if}
      {/if}
      {#if regularDispel}{@render rateStat(regularDispel.success, regularDispel.success + regularDispel.miss, 'regular debuffs dispelled', `Of the regular (lower-priority) dispellable debuffs applied to players, how many were removed before expiry.`)}{/if}
    </div>
  </section>
{/if}

{#if hasRemoval && removal}
  <section class="rcard">
    <div class="rhead"><h3>Cleanse / Removal</h3>
      <div class="big"><span class="bignum">{removal.overall.removed}/{removal.overall.applied}</span><span class="bigunit">debuffs removed</span></div>
    </div>
    <div class="strip">
      {#if removal.overall.activeSeconds > 0}{@render stat(dur(removal.overall.activeSeconds), 'debuffs active', `Total time dangerous, removable debuffs were on the party across ${removal.overall.applied} application${removal.overall.applied === 1 ? '' : 's'} — the pressure a healer/dispeller had to manage.`)}{/if}
      {#if removal.overall.missedFixable > 0}{@render stat(`${removal.overall.missedFixable}`, 'could’ve removed', `Dangerous debuffs that expired un-removed even though a remover the party brought was OFF COOLDOWN during the debuff — removable if played differently. See "available but unused" below for which spell(s).`, 'warn')}{/if}
      {#if removal.overall.removableSeconds > 0}{@render stat(dur(removal.overall.removableSeconds), 'removable uptime', `Debuff time that could've been trimmed if a remover had been cast the moment it came available — the improvement opportunity, summed across the ${removal.overall.missedFixable} miss${removal.overall.missedFixable === 1 ? '' : 'es'} a remover could've cleared.`, 'warn')}{/if}
      {#if removal.overall.missedCooldownBlocked > 0}{@render stat(`${removal.overall.missedCooldownBlocked}`, 'on cooldown', `Dangerous debuffs that could NOT be removed because every party remover that clears them was on cooldown the whole time (${dur(removal.overall.missedCooldownBlockedSeconds)} of debuff time) — a forced heal-through, not a mistake. Often the 2nd/3rd copy of a debuff applied while the 8s dispel was spent on the first.`)}{/if}
      {#if removal.overall.healThrough > 0}{@render stat(`${removal.overall.healThrough}`, 'heal-through', `Healing-absorb debuffs — cleared by healing through them rather than dispelling. Tracked separately because there's no dispel to score; see the breakdown below.`)}{/if}
    </div>

    <!-- Plain-language summary of the removal picture. -->
    {#if removal.overall.applied > 0}
      <p class="removal-summary">
        Dangerous debuffs were active for <b>{dur(removal.overall.activeSeconds)}</b> over <b>{removal.overall.applied}</b> application{removal.overall.applied === 1 ? '' : 's'};
        <b>{removal.overall.removed}</b> removed.
        {#if removal.overall.missedFixable > 0}
          <span class="warn-t"><b>{removal.overall.missedFixable}</b> could’ve been removed{#if unusedRemovers.length} by {#each unusedRemovers as u, i (u.spellId)}{i > 0 ? ', ' : ''}<WowheadLink id={u.spellId} name={u.name} />{/each}{/if} but weren’t{#if removal.overall.removableSeconds > 0}, leaving <b>{dur(removal.overall.removableSeconds)}</b> of debuff uptime that could’ve been trimmed{/if}.</span>
        {/if}
        {#if removal.overall.missedCooldownBlocked > 0}
          <span class="muted-t"><b>{removal.overall.missedCooldownBlocked}</b> ({dur(removal.overall.missedCooldownBlockedSeconds)}) could <b>not</b> be removed — the only removers were on cooldown.</span>
        {/if}
      </p>
    {/if}

    {#if topDebuffs.length}
      <div class="subh muted">By debuff — removed vs. left up</div>
      <div class="bars">
        {#each topDebuffs as d (d.spellId)}
          {@const rem = d.applied > 0 ? d.removed / d.applied : 0}
          <div class="barrow">
            <div class="bhead">
              <span class="bn dbn"><WowheadLink id={d.spellId} name={d.name} /></span>
              <span class="bv">
                {d.removed}/{d.applied}
                {#if d.missedFixable > 0}<span class="warnchip" title="{d.missedFixable} expired while a remover was available — removable if played differently">⚠ {d.missedFixable}</span>{/if}
                {#if d.missedCooldownBlocked > 0}<span class="cdchip" title="{d.missedCooldownBlocked} could not be removed — every remover was on cooldown (forced heal-through)">🔒 {d.missedCooldownBlocked}</span>{/if}
              </span>
            </div>
            <div class="track split">
              <div class="fill ok" style="width:{rem * 100}%"></div>
              <div class="fill miss" style="width:{(1 - rem) * 100}%"></div>
            </div>
            {#if d.removerCandidates.length}
              <div class="removable-by muted">removable by {#each d.removerCandidates as c, i (c.spellId)}{i > 0 ? ', ' : ''}<WowheadLink id={c.spellId} name={c.name} />{/each}{#if d.removableSeconds > 0}<span class="trim">· ~{dur(d.removableSeconds)} trimmable</span>{/if}</div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if topRemovers.length}
      <div class="subh muted">By remover</div>
      <div class="chips">
        {#each topRemovers as r (r.spellId)}
          <span class="chip"><WowheadLink id={r.spellId} name={r.name} /><span class="cn">{r.count}</span></span>
        {/each}
      </div>
    {/if}

    {#if healThrough.length}
      <div class="subh muted">Healing-absorbs (healed through)</div>
      <div class="chips">
        {#each healThrough as h (h.spellId)}
          <span class="chip"><WowheadLink id={h.spellId} name={h.name} /><span class="cn">{h.clearedEarly}/{h.applied}</span></span>
        {/each}
      </div>
    {/if}

    <p class="foot muted small">{removal.coverageNote}</p>
  </section>
{/if}

{#if !hasInterrupts && !hasDispels && !hasRemoval && (!avoidable || avoidable.totalAvoidable === 0)}
  <p class="muted">No mechanics analytics available for this run.</p>
{/if}

<style>
  .small { font-size: 12px; }
  /* Lens selector — tank/healer/dps/all perspective for the curated mechanic advice. */
  .lensbar { display: flex; align-items: center; gap: 10px; margin: 0 0 12px; flex-wrap: wrap; }
  .lenslabel { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .lenssel {
    background: var(--surface-2, rgba(255,255,255,0.04)); color: var(--text); cursor: pointer;
    border: 1px solid var(--border); border-radius: 8px; padding: 5px 10px; font-size: 13px; font-weight: 600;
  }
  .lenshint { font-size: 12px; }
  .rcard {
    background: var(--surface-2, rgba(255,255,255,0.02)); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px 14px; margin: 0 0 12px;
  }
  .rhead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .rhead h3 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text); }
  .big { display: flex; align-items: baseline; gap: 6px; }
  .bignum { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .bigunit { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }

  .bars { display: flex; flex-direction: column; gap: 6px; }
  .barrow { display: flex; flex-direction: column; gap: 2px; }
  .bhead { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; align-items: baseline; }
  .bn { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dbn :global(a) { color: var(--text); text-decoration: none; }
  .dbn :global(a:hover) { text-decoration: underline; color: var(--accent); }
  .bv { font-variant-numeric: tabular-nums; color: var(--muted); flex-shrink: 0; display: flex; align-items: baseline; gap: 6px; }
  .track { height: 6px; background: var(--track, rgba(255,255,255,0.06)); border-radius: 3px; overflow: hidden; }
  .track.split { display: flex; }
  .fill { height: 100%; background: var(--accent); }
  .fill.ok { background: var(--good, #5fd08a); }
  .fill.miss { background: var(--bad, crimson); opacity: 0.55; }

  .subh { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin: 12px 0 6px; }

  .strip { display: flex; flex-wrap: wrap; gap: 18px; margin: 4px 0 2px; }
  .stat { display: flex; flex-direction: column; gap: 1px; }
  .snum { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .snum.ok { color: var(--good, #5fd08a); }
  .snum.warn { color: var(--warn, #e0a82e); }
  .snum.bad { color: var(--bad, crimson); }
  .slabel { font-size: 11px; display: inline-flex; align-items: center; gap: 4px; }
  .pctchip { font-variant-numeric: tabular-nums; color: var(--text); font-weight: 600; }
  .warnchip { color: var(--warn, #e0a82e); font-size: 11px; font-weight: 600; }
  .cdchip { color: var(--muted); font-size: 11px; font-weight: 600; }
  /* Plain-language removal summary. */
  .removal-summary { margin: 4px 0 2px; font-size: 13px; line-height: 1.55; color: var(--text); }
  .removal-summary b { font-weight: 700; }
  .removal-summary .warn-t b { color: var(--warn, #e0a82e); }
  .removal-summary .muted-t { color: var(--muted); }
  .removal-summary :global(a) { color: var(--warn, #e0a82e); text-decoration: none; }
  .removal-summary :global(a:hover) { text-decoration: underline; }
  /* "removable by …" line under each debuff bar. */
  .removable-by { font-size: 11px; margin-top: 3px; display: flex; flex-wrap: wrap; gap: 4px; align-items: baseline; }
  .removable-by :global(a) { color: inherit; text-decoration: none; }
  .removable-by :global(a:hover) { text-decoration: underline; }
  .removable-by .trim { color: var(--warn, #e0a82e); }
  .qmark {
    position: relative;
    display: inline-flex; align-items: center; justify-content: center;
    width: 13px; height: 13px; border-radius: 50%;
    border: 1px solid var(--border); color: var(--muted); font-size: 9px; font-weight: 700;
    cursor: help;
  }
  .qmark:hover { color: var(--text); border-color: var(--hover-accent, #8a5cff); }
  /* Tooltip is now body-portaled via `use:tip` (mvp/tip.ts) so it isn't clipped by the sidebar. */

  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex; align-items: baseline; gap: 6px; padding: 3px 8px;
    background: var(--track, rgba(255,255,255,0.06)); border-radius: 12px; font-size: 12px;
  }
  .chip :global(a) { color: var(--text); text-decoration: none; }
  .chip :global(a:hover) { text-decoration: underline; color: var(--accent); }
  .chip .cn { font-variant-numeric: tabular-nums; color: var(--muted); font-weight: 600; }

  .praise { border-color: color-mix(in srgb, var(--good, #5fd08a) 35%, var(--border)); }
  .pchip {
    display: inline-flex; align-items: baseline; gap: 6px; padding: 3px 9px;
    background: var(--track, rgba(255,255,255,0.06)); border: 1px solid var(--border);
    border-radius: 12px; font-size: 12px; font-weight: 600;
  }
  .pchip .cn { font-variant-numeric: tabular-nums; color: var(--muted); font-weight: 600; }

  .foot { margin: 12px 0 0; }
</style>
