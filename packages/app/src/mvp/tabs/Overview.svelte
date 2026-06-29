<!-- Overview tab: a quick win/celebration on load, the run's POSITIVE highlights up top, then a
     time-ordered "moments of interest" list (encounter starts + deaths) wired to the replay drawer. -->
<script lang="ts">
  import type {
    RunReport, RosterEntry,
    DeathRecapResult, AvoidableDamageResult, ClutchResult, InterruptAccountabilityResult, DamageResult, HealingResult,
  } from '@wow/engine';
  import RunSummary from '../RunSummary.svelte';
  import Composition from '../Composition.svelte';
  import WowheadLink from '../WowheadLink.svelte';
  import { analytic, mmss, abbrev, runResult, runParticipants } from '../report.js';
  import { adviceFor } from '../avoidableAdvice.js';
  import { anon } from '../anon.svelte.js';
  import { runStatus } from '../runStatus.svelte.js';
  import { runHash } from '../runHash.js';
  import { settings } from '../settings.svelte.js';
  import { playCelebration } from '../celebrationSound.js';
  import type { RunComparison, MetricCompare } from '../runStats.js';
  import type { SeekOptions } from '../replayController.svelte.js';

  let {
    report,
    onSeek,
    roster = [],
    comparison,
    onNavigate,
    onCelebrate,
  }: {
    report: RunReport;
    onSeek: (ms: number, opts?: SeekOptions) => void;
    roster?: RosterEntry[];
    comparison?: RunComparison;
    /** Switch the analysis panel to another tab (e.g. jump to the Mechanics deep-dive). */
    onNavigate?: (tab: 'mechanics') => void;
    /** Display the timed/PB/kill celebration at the app shell level so it cannot be clipped by this panel. */
    onCelebrate?: (celebration: { kind: 'timed' | 'pb' | 'kill'; stars: number; label: string }) => void;
  } = $props();

  let recap = $derived(analytic<DeathRecapResult>(report, 'deaths.recap'));
  let avoidable = $derived(analytic<AvoidableDamageResult>(report, 'avoidableDamage'));
  let clutch = $derived(analytic<ClutchResult>(report, 'utility.clutch'));
  let acct = $derived(analytic<InterruptAccountabilityResult>(report, 'interrupts.accountability'));
  let dmg = $derived(analytic<DamageResult>(report, 'dps.overall'));
  let heal = $derived(analytic<HealingResult>(report, 'hps.overall'));
  let deaths = $derived(recap?.deaths ?? []);

  let rosterNames = $derived(new Set(roster.map((r) => r.name)));
  const nameList = (names: string[], cap = 4): string => {
    const shown = names.slice(0, cap).map((n) => anon.name(n));
    return shown.join(', ') + (names.length > cap ? ` +${names.length - cap}` : '');
  };

  // ---- positive highlights ----
  type Highlight = { icon: string; title: string; detail: string; seekMs?: number };
  let highlights = $derived.by((): Highlight[] => {
    const out: Highlight[] = [];

    const livesSaved = (clutch?.byCaster ?? []).reduce((a, c) => a + c.lifeSaved, 0);
    const topPlay = clutch?.plays[0];
    if (livesSaved > 0 && topPlay) {
      out.push({
        icon: '💗',
        title: `${livesSaved} ${livesSaved === 1 ? 'life' : 'lives'} saved`,
        detail: `${anon.name(topPlay.casterName)} — ${topPlay.spellName} on ${anon.name(topPlay.targetName)}${topPlay.targetHpFraction != null ? ` @ ${Math.round(topPlay.targetHpFraction * 100)}%` : ''}`,
        seekMs: topPlay.ms,
      });
    } else if ((clutch?.plays.length ?? 0) > 0 && topPlay) {
      out.push({ icon: '🛡', title: `${clutch!.plays.length} clutch play${clutch!.plays.length === 1 ? '' : 's'}`, detail: `${anon.name(topPlay.casterName)} — ${topPlay.spellName} on ${anon.name(topPlay.targetName)}`, seekMs: topPlay.ms });
    }

    const perfect = (acct?.players ?? []).filter((p) => p.interrupted > 0 && p.missed === 0);
    if (perfect.length) {
      const kicks = perfect.reduce((a, p) => a + p.interrupted, 0);
      out.push({ icon: '⚔', title: `Perfect interrupts`, detail: `${nameList(perfect.map((p) => p.name))} — ${kicks} dangerous cast${kicks === 1 ? '' : 's'} kicked, none missed` });
    }

    if (avoidable && avoidable.totalAvoidable > 0) {
      const hit = new Set((avoidable.byUnit ?? []).filter((u) => u.value > 0).map((u) => u.name));
      const participants = runParticipants(report);
      const clean = roster.filter((r) => participants.has(r.name) && !hit.has(r.name)).map((r) => r.name);
      if (clean.length) out.push({ icon: '✨', title: `Avoided all mechanics`, detail: `${nameList(clean)} — took zero avoidable damage` });
    }

    if (deaths.length === 0) out.push({ icon: '🟢', title: `Deathless run`, detail: `nobody hit the floor` });

    const topDps = (dmg?.bySource ?? []).filter((r) => rosterNames.has(r.name) && r.dps > 0)[0];
    if (topDps) out.push({ icon: '🔥', title: `${abbrev(topDps.dps)} DPS`, detail: `${anon.name(topDps.name)} — top damage` });
    const topHps = (heal?.bySource ?? []).filter((r) => rosterNames.has(r.name) && r.hps > 0)[0];
    if (topHps) out.push({ icon: '➕', title: `${abbrev(topHps.hps)} HPS`, detail: `${anon.name(topHps.name)} — top healing` });

    return out;
  });

  // ---- rough patches: avoidable damage eaten (a difficult/failed-run indicator) ----
  // Top mechanics by avoidable damage taken, each with a "how to avoid" tip; links to the Mechanics
  // tab for the full breakdown. Only shown when there WAS avoidable damage.
  let roughMechanics = $derived.by(() => {
    if (!avoidable || avoidable.totalAvoidable <= 0) return [];
    return (avoidable.bySpell ?? []).slice(0, 4).map((s) => ({ ...s, advice: adviceFor(s.id, s.name) }));
  });
  let hardestHit = $derived((avoidable?.byUnit ?? []).filter((u) => u.value > 0)[0]);

  // ---- moments of interest: encounter starts + deaths, time-ordered ----
  type Moment = { ms: number; kind: 'boss' | 'death'; label: string; detail?: string; outcome?: 'kill' | 'wipe' };
  let moments = $derived.by((): Moment[] => {
    const out: Moment[] = [];
    for (const { segment: s } of report.segments ?? []) {
      if (s.kind !== 'encounter') continue;
      out.push({ ms: s.startMs, kind: 'boss', label: s.name ?? 'Boss', outcome: s.success === true ? 'kill' : s.success === false ? 'wipe' : undefined });
    }
    for (const d of deaths) out.push({ ms: d.tsMs, kind: 'death', label: anon.name(d.name), detail: d.killingBlowName ?? 'unknown' });
    return out.sort((a, b) => a.ms - b.ms);
  });

  // Show the compare pane only when at least one comparison row will actually render (peers exist or a
  // spec comparison is available) — otherwise hide it entirely rather than showing an empty-state.
  let hasCompareData = $derived(
    !!comparison &&
      (!!comparison.duration || !!comparison.raidDps || !!comparison.raidHps || !!comparison.spec || !!comparison.deaths),
  );

  // ---- celebration bling (timed runs only, once EVER per run) ----
  // Tracked in persisted settings (not a session Set) so the bling doesn't re-fire every time the user
  // re-opens the app or reloads a run from history — only the first time a given timed run is seen. A
  // timed run that beats the dungeon's stored best escalates to a longer "Personal Best!" flourish.
  let hash = $derived(runHash(report));
  let rr = $derived(runResult(report.run, runStatus.isAbandoned(hash)));
  // Stable per-dungeon key for the personal-best record: prefer the numeric challengeModeId, then mapId,
  // then the name — so the best is tracked per dungeon, not per key level / per log.
  let dungeonKey = $derived(
    report.run.challengeModeId != null
      ? `cm:${report.run.challengeModeId}`
      : report.run.mapId != null
        ? `map:${report.run.mapId}`
        : `name:${report.run.dungeonName ?? 'unknown'}`,
  );
  // Raid: celebrate a boss kill in the session (the raid counterpart of a timed M+ key).
  let raidKills = $derived(report.run.contentType === 'raid' ? (report.bosses ?? []).filter((b) => b.killed) : []);
  $effect(() => {
    if (settings.hasCelebrated(hash)) return;
    if (rr.result === 'timed') {
      settings.markCelebrated(hash);
      const isPb = settings.recordPersonalBest(dungeonKey, {
        keyLevel: report.run.keystoneLevel ?? 0,
        stars: rr.stars,
        timeMs: report.run.completionTimeMs ?? 0,
      });
      const label =
        isPb && report.run.keystoneLevel
          ? `${report.run.dungeonName ?? 'Dungeon'} +${report.run.keystoneLevel}`
          : '';
      onCelebrate?.({ kind: isPb ? 'pb' : 'timed', stars: rr.stars, label });
      if (settings.celebrationSound) playCelebration();
    } else if (raidKills.length > 0) {
      settings.markCelebrated(hash);
      const label = raidKills.length === 1 ? raidKills[0]!.name : `${raidKills.length} bosses down`;
      onCelebrate?.({ kind: 'kill', stars: 0, label });
      if (settings.celebrationSound) playCelebration();
    }
  });
</script>

{#snippet cmpRow(label: string, m: MetricCompare | null, fmt: (v: number) => string, dir: 'faster' | 'higher')}
  {#if m}
    <div class="cmprow">
      <span class="cl">{label}</span>
      <span class="cv">{fmt(m.you)}</span>
      <span class="cmed muted">median {fmt(m.median)}</span>
      <span class="cbar"><span class="cfill" style="width:{m.betterThanPct}%"></span></span>
      <span class="cpct {m.betterThanPct >= 50 ? 'good' : ''}">{dir} than {m.betterThanPct}%</span>
    </div>
  {/if}
{/snippet}

{#snippet hinner(h: Highlight)}
  <span class="hicon">{h.icon}</span>
  <span class="htext">
    <span class="htitle">{h.title}</span>
    <span class="hdetail muted">{h.detail}</span>
  </span>
{/snippet}

<RunSummary {report} deathCount={deaths.length} />

<Composition combatants={report.combatants} {roster} />

{#if highlights.length}
  <section class="card">
    <h2>Highlights</h2>
    <div class="hl">
      {#each highlights as h (h.icon + h.title)}
        {#if h.seekMs != null}
          <button class="hcard seekable" onclick={() => onSeek(h.seekMs!, { label: h.title })}>
            {@render hinner(h)}<span class="go">▶</span>
          </button>
        {:else}
          <div class="hcard">{@render hinner(h)}</div>
        {/if}
      {/each}
    </div>
  </section>
{/if}

{#if roughMechanics.length}
  <section class="card rough">
    <h2>Rough patches <span class="muted">· {abbrev(avoidable!.totalAvoidable)} avoidable damage taken</span></h2>
    <p class="rsub muted">
      Damage the group ate from mechanics that could’ve been dodged — a common cause of a rough or
      blown run.{#if hardestHit}{' '}Hardest hit: <b>{anon.name(hardestHit.name)}</b> ({abbrev(hardestHit.value)}).{/if}
    </p>
    <div class="rlist">
      {#each roughMechanics as m (m.id)}
        <div class="rrow">
          <div class="rtop">
            <span class="rname"><WowheadLink id={m.id} name={m.name} /></span>
            <span class="rarch" class:inferred={!m.advice.curated} title={m.advice.curated ? 'curated guidance' : 'general guidance by mechanic type'}>{m.advice.label}</span>
            <span class="rval">{abbrev(m.value)}</span>
          </div>
          <div class="rtip muted">{m.advice.tip}</div>
        </div>
      {/each}
    </div>
    {#if onNavigate}
      <button class="rmore" onclick={() => onNavigate?.('mechanics')}>See more details about handling mechanics →</button>
    {/if}
  </section>
{/if}

{#if comparison && hasCompareData}
  <section class="card">
    <h2>How this run compares <span class="muted">· {comparison.dungeon} +{comparison.keyLevel}{#if comparison.sampleSize > 0} · vs {comparison.sampleSize} other run{comparison.sampleSize === 1 ? '' : 's'}{/if}</span></h2>
    <div class="cmp">
      {@render cmpRow('Time', comparison.duration, (v) => mmss(v), 'faster')}
      {@render cmpRow('Raid DPS', comparison.raidDps, (v) => abbrev(v), 'higher')}
      {@render cmpRow('Raid HPS', comparison.raidHps, (v) => abbrev(v), 'higher')}
      {#if comparison.spec}{@render cmpRow('Your spec DPS', comparison.spec, (v) => abbrev(v), 'higher')}{/if}
      {#if comparison.deaths}
        <div class="cmprow">
          <span class="cl">Deaths</span>
          <span class="cv">{comparison.deaths.you}</span>
          <span class="cmed muted">median {comparison.deaths.median}</span>
          <span class="cpct {comparison.deaths.you <= comparison.deaths.median ? 'good' : 'bad'}">{comparison.deaths.you <= comparison.deaths.median ? 'at or below average' : 'above average'}</span>
        </div>
      {/if}
    </div>
  </section>
{/if}

{#if comparison?.encounters}
  {@const ec = comparison.encounters}
  <section class="card">
    <h2>Encounter timing vs others <span class="muted">· same route · {ec.sampleSize} run{ec.sampleSize === 1 ? '' : 's'}</span></h2>
    <div class="heat">
      {#each ec.rows as e (e.name)}
        <div class="hrow">
          <span class="hname">{e.name}</span>
          <div class="htrack">
            {#each e.heat as v, b (b)}
              <span class="hcell" style="background:rgba(78,161,255,{v})"></span>
            {/each}
            <span class="mtick" title="median start {mmss(e.medianStartMs)}" style="left:{(e.medianStartMs / ec.axisMs) * 100}%"></span>
            <span
              class="ybar"
              title="you: {mmss(e.youStartMs)}–{mmss(e.youEndMs)}"
              style="left:{(e.youStartMs / ec.axisMs) * 100}%; width:{Math.max(0.6, ((e.youEndMs - e.youStartMs) / ec.axisMs) * 100)}%"
            ></span>
          </div>
          <span class="htime">{mmss(e.youStartMs)}–{mmss(e.youEndMs)}</span>
        </div>
      {/each}
    </div>
    <div class="haxis"><span>0:00</span><span class="muted">run time →</span><span>{mmss(ec.axisMs)}</span></div>
    <p class="foot muted">Brighter = more runs engaged that boss then. The bar is <b>your</b> engagement; the tick is the others' median start. Compared only to runs of the same dungeon, key, and boss order.</p>
  </section>
{/if}

<section class="card">
  <h2>Moments of interest {#if moments.length}<span class="muted">· {moments.length}</span>{/if}</h2>
  {#if moments.length === 0}
    <p class="muted">No bosses or deaths logged. Open the Deep Dive drawer to scrub the replay.</p>
  {:else}
    <div class="moments">
      {#each moments as m (m.kind + ':' + m.ms + ':' + m.label)}
        <button class="moment" onclick={() => onSeek(m.ms, { label: `${m.kind === 'boss' ? 'pull' : 'death'}: ${m.label}` })}>
          <span class="t">{mmss(m.ms - report.firstMs)}</span>
          <span class="m-icon {m.kind}">{m.kind === 'boss' ? '⚔' : '☠'}</span>
          <span class="m-who">{m.label}</span>
          {#if m.kind === 'boss' && m.outcome}
            <span class="m-tag {m.outcome}">{m.outcome === 'kill' ? 'kill' : 'wipe'}</span>
          {:else if m.detail}
            <span class="m-kb muted">{m.detail}</span>
          {/if}
          <span class="go">▶</span>
        </button>
      {/each}
    </div>
  {/if}
</section>

<style>
  .hl { display: flex; flex-direction: column; gap: 6px; }
  .hcard {
    display: flex; align-items: center; gap: 12px; text-align: left; width: 100%; box-sizing: border-box;
    background: var(--surface-2); border: 1px solid var(--border); border-left: 3px solid var(--good, #5fd08a);
    border-radius: 7px; padding: 8px 12px; color: var(--text); font-size: 14px;
  }
  .hcard.seekable { cursor: pointer; }
  .hcard.seekable:hover { border-color: var(--hover-accent, #8a5cff); border-left-color: var(--hover-accent, #8a5cff); }
  .hicon { font-size: 18px; line-height: 1; flex: 0 0 22px; text-align: center; }
  .htext { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
  .htitle { font-weight: 700; }
  .hdetail { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Rough patches — failed/avoidable mechanics. The section card matches the others (no left border);
     the accent left border lives on the inner rows, like Highlights' cards. */
  .rsub { margin: 0 0 10px; font-size: 13px; line-height: 1.5; }
  .rsub b { color: var(--text); }
  .rlist { display: flex; flex-direction: column; gap: 7px; }
  .rrow { background: var(--surface-2); border: 1px solid var(--border); border-left: 3px solid var(--warn, #e0a82e); border-radius: 7px; padding: 7px 11px; }
  .rtop { display: flex; align-items: baseline; gap: 8px; }
  .rname { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rname :global(a) { color: var(--text); text-decoration: none; }
  .rname :global(a:hover) { text-decoration: underline; color: var(--accent); }
  .rarch {
    flex: 0 0 auto; padding: 0 6px; border-radius: 8px; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em; color: var(--warn, #e0a82e); border: 1px solid currentColor;
  }
  .rarch.inferred { color: var(--muted); }
  .rval { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 700; color: var(--bad, crimson); flex: 0 0 auto; }
  .rtip { margin-top: 3px; font-size: 12px; line-height: 1.45; }
  .rmore {
    margin-top: 10px; width: 100%; text-align: left; background: var(--surface-2); border: 1px solid var(--border);
    border-radius: 7px; padding: 8px 12px; color: var(--accent); font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .rmore:hover { border-color: var(--hover-accent, #8a5cff); }

  .cmp { display: flex; flex-direction: column; gap: 7px; }
  .cmprow { display: grid; grid-template-columns: 96px 70px 96px 1fr auto; align-items: center; gap: 10px; font-size: 13px; }
  .cl { font-weight: 600; }
  .cv { font-variant-numeric: tabular-nums; font-weight: 700; }
  .cmed { font-size: 12px; font-variant-numeric: tabular-nums; }
  .cbar { height: 6px; background: var(--track, rgba(255,255,255,0.06)); border-radius: 3px; overflow: hidden; min-width: 40px; }
  .cfill { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .cpct { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
  .cpct.good { color: var(--good, #5fd08a); }
  .cpct.bad { color: var(--bad, crimson); }
  @media (max-width: 640px) {
    .cmprow { grid-template-columns: 1fr auto; }
    .cbar { display: none; }
  }

  .heat { display: flex; flex-direction: column; gap: 6px; }
  .hrow { display: grid; grid-template-columns: 130px 1fr 92px; align-items: center; gap: 10px; }
  .hname { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .htrack {
    position: relative; display: flex; height: 18px; border-radius: 4px; overflow: hidden;
    background: var(--track, rgba(255,255,255,0.05)); border: 1px solid var(--border);
  }
  .hcell { flex: 1 1 0; min-width: 0; }
  .mtick { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--muted); opacity: 0.7; transform: translateX(-1px); }
  .ybar {
    position: absolute; top: 2px; bottom: 2px; border-radius: 3px;
    background: color-mix(in srgb, var(--good, #5fd08a) 55%, transparent);
    border: 1px solid var(--good, #5fd08a); box-shadow: 0 0 0 1px rgba(0,0,0,0.25);
  }
  .htime { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--muted); text-align: right; }
  .haxis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 5px; font-variant-numeric: tabular-nums; }
  .foot { margin: 10px 0 0; font-size: 12px; line-height: 1.5; }
  .foot b { color: var(--text); }
  @media (max-width: 640px) {
    .hrow { grid-template-columns: 96px 1fr; }
    .htime { display: none; }
  }

  .moments { display: flex; flex-direction: column; gap: 5px; }
  .moment {
    display: flex; align-items: center; gap: 12px; text-align: left;
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 7px;
    padding: 7px 11px; cursor: pointer; color: var(--text); font-size: 14px;
  }
  .moment:hover { border-color: var(--hover-accent, #8a5cff); }
  .t { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--accent); min-width: 48px; }
  .m-icon { font-size: 13px; width: 16px; text-align: center; }
  .m-icon.death { color: var(--bad, crimson); }
  .m-icon.boss { color: var(--warn, #e0a82e); }
  .m-who { font-weight: 600; }
  .m-kb { flex: 1; }
  .m-tag {
    flex: 1; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  }
  .m-tag.kill { color: var(--good, #5fd08a); }
  .m-tag.wipe { color: var(--bad, crimson); }
  .go { color: var(--muted); }
</style>
