<!-- (6) Log replay — a live, time-synced view of the run. Scrub to any moment + play at variable
     speed; each frame is a pure query of the transferred ReplayView at the clock time T:
     per-player HP / buffs / debuffs / cast bar, an enemy dangerous-cast lane (interrupt outcome
     obvious), and an FPS-style kill feed. The whole log stays in the worker; only the compact
     replay model crosses once. -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { ReplayView, type ParserClient, type ReplayModelData, type ActiveAura, type ReplayUnit, type CooldownStatus, type MeterRow } from '@wow/engine';
  import WowheadLink from '../mvp/WowheadLink.svelte';
  import SpecIcon from '../mvp/SpecIcon.svelte';
  import RunTimeline from './RunTimeline.svelte';
  import { roleRank } from '../mvp/roleIcons.js';
  import { classColorOf } from '../mvp/specVisuals.js';
  import { anon } from '../mvp/anon.svelte.js';
  import { settings } from '../mvp/settings.svelte.js';
  import { mmss, abbrev } from '../mvp/report.js';
  import type { ReplayController, SeekHighlight } from '../mvp/replayController.svelte.js';

  // Custom-metric windows lifted from the CustomMetrics panel — drawn as stacked, color-coded bands.
  type MetricWindowLite = { label: string; startMs: number; endMs: number; unitName?: string; detail?: string; color?: string; spellId?: number; id?: string };
  // `embedded` recolors the viewer for the dark MVP shell (light defaults keep /diag unchanged);
  // `title` overrides the panel heading; `controller` lets analysis panels drive seek/highlight.
  // All optional so the diagnostic inspector is unaffected.
  let {
    client,
    runIndex,
    windows = [],
    embedded = false,
    title = '6 · Replay',
    controller = null,
    enabled = true,
    onCommentAtMoment = null,
  }: {
    client: ParserClient | null;
    runIndex: number;
    windows?: MetricWindowLite[];
    embedded?: boolean;
    title?: string;
    controller?: ReplayController | null;
    /** When false, hold off building the model (e.g. a history run whose side panes show instantly
     *  while its log re-parses in the background). The current model is dropped until re-enabled. */
    enabled?: boolean;
    /** When set, shows a "comment on this moment" button that calls back with the current clock (epoch
     *  ms). Used by the shared-replay discussion thread to pin a comment to the playhead. */
    onCommentAtMoment?: ((clockMs: number) => void) | null;
  } = $props();

  // The spotlight window from the most recent panel-driven seek (cleared on run change).
  let focus = $state<SeekHighlight | null>(null);

  // React to seek requests from the analysis panels. Track only `controller.seq`; everything the
  // handler reads/writes (view, t, load) is untracked so this fires once per seek, not on every frame.
  $effect(() => {
    const c = controller;
    if (!c) return;
    const seq = c.seq;
    if (seq === 0) return;
    void untrack(() => applySeek(c));
  });

  async function applySeek(c: ReplayController): Promise<void> {
    focus = c.highlight;
    if (!view) await load();
    const v = view;
    if (v && c.seekMs != null) {
      t = Math.max(v.firstMs, Math.min(v.lastMs, c.seekMs));
      playing = false;
    }
  }

  // Lead-in for the viewer's OWN jumps (bookmarks, ⏮/⏭) — from the drawer field, 0 when standalone
  // (/diag) so its behavior is unchanged. Land a bit BEFORE a moment so it plays into view.
  let leadInMs = $derived((controller?.leadInSeconds ?? 0) * 1000);
  function goTo(eventMs: number) {
    if (!view) return;
    t = Math.max(view.firstMs, Math.min(view.lastMs, eventMs - leadInMs));
  }

  let view = $state.raw<ReplayView | null>(null);
  // Players ordered tank → healer → dps, dps (and ties) alphabetical by name.
  let players = $derived(
    view ? [...view.players()].sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name)) : [],
  );
  // Per-player low-HP (<25%) danger windows — computed once per loaded model (not per frame).
  let lowHp = $derived(view ? view.criticalWindows(0.25) : []);
  // unitId → player (for the interrupter's class color on an interrupted enemy cast).
  let unitById = $derived<Map<number, ReplayUnit>>(view ? new Map(view.players().map((u) => [u.unitId, u] as const)) : new Map());
  let loading = $state(false);
  let error = $state<string | null>(null);
  let t = $state(0); // clock, epoch ms
  let playing = $state(false);
  let speed = $state(1);
  // Enemy casts around the clock (shared by the enemy lane + the "is a kick needed now?" signal).
  let ecastsAround = $derived(view ? view.enemyCastsAround(t) : []);
  // True while an interruptible enemy cast is in progress — only then do ready interrupts glow green.
  // Counts table-interruptible casts AND ones proven interruptible by being kicked in the log (matches
  // the enemy-casts pane), so the glow fires even on dungeons with thin spell-table coverage.
  let interruptWindow = $derived(ecastsAround.some((e) => e.cast.startMs <= t && t < e.cast.endMs && (e.cast.interruptible === true || e.cast.result === 'interrupted')));
  // Removal categories of dispellable debuffs currently up on the team — a ready dispel whose
  // categories intersect this glows green (the healer analog of interruptWindow).
  let dispelWindowCats = $derived(view ? view.dispellableCategoriesAt(t) : new Set<string>());
  // Healer capacity stoplight thresholds (rolling cast-time utilization): green = comfortable,
  // amber = working hard, red = maxed out. An approximate pressure read (no movement/LoS/mana).
  const CAP_AMBER = 0.55;
  const CAP_RED = 0.8;
  const capTone = (c: number): 'green' | 'amber' | 'red' => (c >= CAP_RED ? 'red' : c >= CAP_AMBER ? 'amber' : 'green');

  // Misc-buff visibility persists across runs/sessions (settings singleton), so it's not wiped on reload.
  let showMisc = $state(settings.replayShowMisc);
  // Combat-journal spell filter: the set of spellIds HIDDEN from every player's journal. The UI is
  // inverted for intuition — every spell shows by default (checkbox checked) and the user UNCHECKS one
  // to hide it, which ADDS it here; so an empty set = show everything. Reassigned (not mutated) on
  // toggle so the derived journals recompute. Passed straight to `playerJournal(..., exclude)`.
  // Seeded from + written back to the settings singleton so the selection persists across runs/restarts.
  let journalFilter = $state<Set<number>>(new Set(settings.journalHiddenSpells));
  let showJournalFilter = $state(false);
  let journalFilterSearch = $state('');
  // Reassign (so derived journals recompute) AND persist the selection.
  function setJournalFilter(next: Set<number>) {
    journalFilter = next;
    settings.setJournalHiddenSpells(next);
  }
  // Toggle a whole journal ROW (same-named rank/talent variants share a row) — add/remove all its ids
  // together so the representative-id membership reflects the whole group.
  function toggleJournalSpell(s: { id: number; ids: number[] }) {
    const next = new Set(journalFilter);
    const on = next.has(s.id);
    for (const id of s.ids) {
      if (on) next.delete(id);
      else next.add(id);
    }
    setJournalFilter(next);
  }
  // The universe of spells that can appear in any journal (for the filter popup), name-sorted; spells
  // that share a display name are collapsed to one row (see ReplayView.journalSpellIds).
  let journalSpells = $derived(view ? view.journalSpellIds() : []);
  // Count of ROWS (groups) currently filtered — for the button badge (not the raw id-set size, which
  // would over-count collapsed multi-id rows).
  let journalFilterCount = $derived(journalSpells.filter((s) => journalFilter.has(s.id)).length);
  // Hidden (unchecked) spells float to the TOP so they're easy to restore one at a time without
  // scrolling; each group stays name-sorted (the source list already is).
  let journalSpellsShown = $derived.by(() => {
    const q = journalFilterSearch.trim().toLowerCase();
    const base = q ? journalSpells.filter((s) => s.name.toLowerCase().includes(q)) : journalSpells;
    const hidden = base.filter((s) => journalFilter.has(s.id));
    const rest = base.filter((s) => !journalFilter.has(s.id));
    return [...hidden, ...rest];
  });

  const SPEEDS = [0.25, 0.5, 1, 2, 4, 8];
  // Mirrors the engine's recentCombat fade window — normalizes a pop's `age` to opacity/drift.
  const POP_FADE_MS = 1400;
  // "Just used" cooldown flash: gold highlight for this long after a cast, then fades to on-CD look.
  const CD_FLASH_MS = 1500;

  // Jump the clock to the previous / next timeline bookmark relative to now.
  function jump(dir: 1 | -1) {
    if (!view) return;
    const bms = view.bookmarks();
    // Navigate relative to the EVENT position (undo the lead-in offset) so the next/prev bookmark
    // is found correctly even though the clock sits `leadInMs` before the last jumped bookmark.
    const cur = t + leadInMs;
    if (dir > 0) {
      const n = bms.find((b) => b.ms > cur + 1);
      if (n) goTo(n.ms);
    } else {
      for (let i = bms.length - 1; i >= 0; i--) {
        if (bms[i]!.ms < cur - 1) {
          goTo(bms[i]!.ms);
          break;
        }
      }
    }
  }
  // Switching runs invalidates the loaded model — drop it so the user re-loads the new dungeon.
  $effect(() => {
    runIndex;
    view = null;
    playing = false;
    error = null;
    focus = null;
    showJournalFilter = false;
    // NOTE: journalFilter is intentionally NOT reset here — it's a persisted user preference that
    // should carry across runs and sessions (settings.journalHiddenSpells).
  });

  // Auto-load: as soon as a client is available (log dropped), the viewer is enabled, and no model is
  // loaded, fetch it. Skips if already loading or if a previous attempt errored (so bad loads don't loop).
  $effect(() => {
    if (client && enabled && !view && !loading && !error) void untrack(load);
  });
  // While disabled (a history run re-parsing in the background), drop any current model so the stage
  // doesn't keep showing the PREVIOUS run; re-enabling re-triggers the auto-load above for the new store.
  $effect(() => {
    if (!enabled) {
      view = null;
      playing = false;
      error = null;
    }
  });

  async function load() {
    if (!client || loading) return;
    const idx = runIndex; // capture: the run this load is for
    loading = true;
    error = null;
    try {
      const data: ReplayModelData = await client.getReplayModel(idx);
      if (idx !== runIndex) return; // run switched mid-load — discard; the effect reloads the new run
      const v = new ReplayView(data);
      view = v;
      t = v.firstMs;
    } catch (e) {
      if (idx !== runIndex) return; // stale error for a run we no longer want
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // Playback clock: only `playing`/`view` are tracked here; `speed` and `t` are read inside the async
  // tick (live values, no effect restart), so changing speed or scrubbing doesn't interrupt playback.
  $effect(() => {
    if (!playing || !view) return;
    const v = view;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      let nt = t + dt * speed;
      if (nt >= v.lastMs) {
        nt = v.lastMs;
        playing = false;
      }
      t = nt;
      if (playing) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const rel = (ms: number, first: number) => mmss(ms - first);
  const pctOf = (f: number) => `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`;

  // WoW power type IDs → display name + bar color.
  const POWER_TYPES: Record<number, { name: string; color: string; textColor?: string }> = {
    0:  { name: 'Mana',        color: '#4da6ff' },
    1:  { name: 'Rage',        color: '#ff4444' },
    2:  { name: 'Focus',       color: '#e07840' },
    3:  { name: 'Energy',      color: '#f0e030', textColor: 'rgba(0,0,0,0.75)' },
    5:  { name: 'Runes',       color: '#c04040' },
    6:  { name: 'Runic Power', color: '#00c8ff', textColor: 'rgba(0,0,0,0.75)' },
    7:  { name: 'Soul Shards', color: '#9966cc' },
    8:  { name: 'Astral Power',color: '#7b6cdb' },
    // 9 = Holy Power: advanced block always reports Mana for Paladin; SPELL_ENERGIZE suffix only
    // gives delta (no current total) and spend events aren't logged — untrackable, so not shown.
    11: { name: 'Maelstrom',   color: '#0080ff' },
    12: { name: 'Chi',         color: '#a0e880', textColor: 'rgba(0,0,0,0.75)' },
    13: { name: 'Insanity',    color: '#8833cc' },
    17: { name: 'Fury',        color: '#cc3300' },
    18: { name: 'Pain',        color: '#660066' },
  };
  const powerInfo = (t: number) => POWER_TYPES[t] ?? { name: `Power(${t})`, color: '#aaa' };

  // Live DPS / HPS meters at the clock (cumulative output ÷ elapsed, ranked) — drawn next to enemy casts.
  let meters = $derived(view ? view.metersAt(t) : { dps: [], hps: [] });

  // Enemy cast feed — script-level derived so we can autoscroll on new entries.
  let eFeed = $derived(view ? view.enemyCastFeed(t) : []);
  let eFeedLen = $derived(eFeed.length);
  let efSectionEl = $state<HTMLElement | null>(null);
  $effect(() => {
    eFeedLen; // only fires when a new cast appears (primitive comparison)
    untrack(() => { if (efSectionEl) efSectionEl.scrollTop = efSectionEl.scrollHeight; });
  });
  // Kill feed — script-level so we can scroll to bottom on new entries.
  let feedKills = $derived(view ? view.deathsBetween(view.firstMs, t).slice(-8) : []);
  let feedKillsLen = $derived(feedKills.length);
  let kfSectionEl = $state<HTMLElement | null>(null);
  $effect(() => {
    feedKillsLen;
    untrack(() => { if (kfSectionEl) kfSectionEl.scrollTop = kfSectionEl.scrollHeight; });
  });
  // Max visible power bars across all players at the current frame — used to pad shorter cards so
  // all row sections (name/HP/resource/cast/auras) line up horizontally across player cards.
  let maxPowerBars = $derived.by(() => {
    if (!view) return 0;
    let max = 0;
    for (const p of players) {
      const pows = view.powerAt(p.unitId, t);
      const count = pows ? pows.filter((pw) => POWER_TYPES[pw.powerType] !== undefined).length : 0;
      if (count > max) max = count;
    }
    return max;
  });
  // Resources with max ≤ 10 are discrete "charge" bars (Runes, Holy Power, Chi, Soul Shards) — show
  // current/max count. Others (Mana, Rage, Energy, Runic Power which the log stores ×10, …) show %.
  // Note: the combat log stores Runic Power at 10× the in-game value (e.g. 75 RP = 750, max 1000),
  // so using fraction rather than raw current avoids confusingly large numbers.
  const pwLabel = (pi: { name: string }, current: number, max: number, frac: number) =>
    max <= 10 ? `${pi.name} · ${current}/${max}` : `${pi.name} · ${Math.round(frac * 100)}%`;
</script>

<!-- Hover popover for an aura lane: the FULL list of auras in the group (name + Wowhead icon/link),
     escaping the lane's overflow:hidden so clipped chips (and the collapsed misc count) are readable. -->
{#snippet auraPop(label: string, list: ActiveAura[], v: ReplayView)}
  {#if list.length}
    <div class="aura-pop" role="tooltip">
      <div class="aura-pop-hdr">{label} · {list.length}</div>
      <div class="aura-pop-body">
        {#each list as a (a.spellId)}
          {@const dang = v.isDangerousDebuff(a.spellId)}
          <span class="aura-pop-row" class:danger={dang} class:removable={dang && v.dispelCategoriesOf(a.spellId).length > 0}><WowheadLink id={a.spellId} name={v.spellName(a.spellId)} />{a.stacks > 1 ? ` ×${a.stacks}` : ''}</span>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet meterCard(title: string, rows: MeterRow[])}
  <div class="meter-card">
    <div class="lanehdr">{title}</div>
    <div class="meter-rows">
      {#if rows.length}
        {@const max = rows[0]!.value}
        {#each rows as r (r.unitId)}
          {@const u = unitById.get(r.unitId)}
          {@const c = classColorOf(u?.specId)}
          <div class="meter-row">
            <span class="meter-bar" style="width:{max > 0 ? (r.value / max) * 100 : 0}%; background:{c ?? 'var(--rp-accent, #4ea1ff)'}"></span>
            <span class="meter-name" style={c ? `color:${c}` : ''}>{anon.name(r.name)}</span>
            <span class="meter-val">{abbrev(r.value)}</span>
          </div>
        {/each}
      {:else}
        <span class="ecast-empty">—</span>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet cdPop(list: CooldownStatus[])}
  {#if list.length}
    <div class="aura-pop" role="tooltip">
      <div class="aura-pop-hdr">COOLDOWNS · {list.length}</div>
      <div class="aura-pop-body">
        {#each list as cd (cd.spellId)}
          <span class="aura-pop-row"><WowheadLink id={cd.spellId} name={cd.name} /> {cd.ready ? 'ready' : Math.ceil(cd.readyInMs / 1000) + 's'}</span>
        {/each}
      </div>
    </div>
  {/if}
{/snippet}

<section class="section" class:embedded>
  <!-- In the MVP drawer the handle already labels this "Replay"; only the standalone /diag panel
       needs its own heading. -->
  {#if !embedded}<h2>{title}</h2>{/if}

  {#if !view}
    {#if error}
      <!-- The load failed. Offer a clean retry (the model auto-loads, so there's no manual affordance). -->
      <div class="rp-error" role="alert">
        <span class="err">Replay unavailable: {error}</span>
        <button class="rp-btn" onclick={() => { error = null; void load(); }}>↻ Retry</button>
      </div>
    {:else}
      <!-- Building the model — fetching now, auto-load imminent, or waiting on a background re-parse
           (history run, side panes already showing). The analysis is usable; only the replay is pending. -->
      <div class="rp-building" role="status" aria-live="polite">
        <span class="rp-spin" aria-hidden="true"></span>
        <span>building replay…</span>
      </div>
    {/if}
  {:else}
    {@const v = view}
    {@const first = v.firstMs}

    <div class="controls">
      <button class="rp-btn" title="jump to previous moment (death / boss start-end), with lead-in" onclick={() => jump(-1)}>⏮</button>
      <button class="rp-btn" class:active={playing} onclick={() => (playing = !playing)}>{playing ? '⏸ pause' : '▶ play'}</button>
      <button class="rp-btn" title="jump to next moment (death / boss start-end), with lead-in" onclick={() => jump(1)}>⏭</button>
      <span class="ctl-sep"></span>
      <span class="muted">speed</span>
      {#each SPEEDS as s}
        <button class="rp-btn" class:active={speed === s} onclick={() => (speed = s)}>{s}×</button>
      {/each}
      {#if controller}
        <span class="ctl-sep"></span>
        <label class="leadin" title="Seconds before a clicked moment to start playback, so you play INTO it">
          lead-in
          <input type="number" min="0" max="60" step="1" bind:value={controller.leadInSeconds} />s
        </label>
      {/if}
      {#if onCommentAtMoment}
        <span class="ctl-sep"></span>
        <button class="rp-btn" title="Comment on this moment in the discussion" onclick={() => onCommentAtMoment?.(t)}>💬 comment on this moment</button>
      {/if}
    </div>

    <RunTimeline
      view={v}
      {t}
      {lowHp}
      {windows}
      {focus}
      onScrub={(ms) => (t = ms)}
      onJump={(ms) => goTo(ms)}
    />

    {@const ecasts = ecastsAround}

    <div class="journals-bar">
      <button
        class="rp-btn icon-only"
        class:active={showMisc}
        title={showMisc ? 'Hide misc / minor buffs' : 'Show misc / minor buffs'}
        aria-label={showMisc ? 'Hide misc / minor buffs' : 'Show misc / minor buffs'}
        onclick={() => { showMisc = !showMisc; settings.setReplayShowMisc(showMisc); }}
      ><svg class="btn-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg></button>
      <button
        class="rp-btn icon-only"
        class:active={settings.compactReplay}
        title={settings.compactReplay ? 'Expand player cards' : 'Compact player cards'}
        aria-label={settings.compactReplay ? 'Expand player cards' : 'Compact player cards'}
        onclick={() => settings.setCompactReplay(!settings.compactReplay)}
      >{#if settings.compactReplay}<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>{:else}<svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/></svg>{/if}</button>
      <div class="jfilter">
        <button
          class="rp-btn icon-only"
          class:active={journalFilter.size > 0}
          title={showJournalFilter ? 'Close combat journal filter' : 'Combat journal filter'}
          aria-label={showJournalFilter ? 'Close combat journal filter' : 'Combat journal filter'}
          onclick={() => (showJournalFilter = !showJournalFilter)}
        ><svg class="btn-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/></svg>{#if journalFilterCount > 0}<span class="jf-count">{journalFilterCount}</span>{/if}</button>
        {#if showJournalFilter}
          <div class="jfilter-pop">
            <div class="jfilter-head">
              <input class="jfilter-search" type="text" placeholder="search spells…" bind:value={journalFilterSearch} />
              <button class="jfilter-clear" disabled={journalFilter.size === 0} onclick={() => setJournalFilter(new Set())}>show all</button>
              <button class="jfilter-x" title="close" onclick={() => (showJournalFilter = false)}>✕</button>
            </div>
            <div class="jfilter-hint">checked spells show in every player's journal — uncheck to hide</div>
            <div class="jfilter-list">
              {#each journalSpellsShown as s (s.id)}
                <label class="jfilter-row" class:jf-off={journalFilter.has(s.id)}>
                  <input type="checkbox" checked={!journalFilter.has(s.id)} onchange={() => toggleJournalSpell(s)} />
                  <WowheadLink id={s.id} name={s.name} />
                </label>
              {/each}
              {#if !journalSpellsShown.length}<div class="jfilter-empty">no matching spells</div>{/if}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Player panes, with a left column of enemy casts + live DPS/HPS meters (stacked vertically) and
         the kill/cast feed on the right. The left column reclaims the vertical band these three used to
         occupy as their own row; `.cards` flexes to absorb the middle so nothing overflows on a narrow
         stage (the player cards just wrap into more rows instead). -->
    <div class="cards-row">
    <div class="replay-left">
      <div class="ecasts-lane">
        <div class="lanehdr">enemy casts</div>
        <div class="ecasts">
          {#if ecasts.length}
            {#each ecasts as e, ei (e.unit.unitId + ':' + e.cast.startMs + ':' + ei)}
              {@const inProg = t < e.cast.endMs}
              {@const etgt = v.nameOf(e.cast.targetUnit)}
              <div class="ecard" class:danger={e.cast.dangerous}>
                <div class="ec-enemy">{e.unit.name}</div>
                <div class="ec-spell"><WowheadLink id={e.cast.spellId} name={v.spellName(e.cast.spellId)} />{#if etgt}<span class="ec-tgt"> → {anon.name(etgt)}</span>{/if}</div>
                {#if inProg}
                  <div class="ec-bar"><span class="ec-fill" style="width:{pctOf((t - e.cast.startMs) / Math.max(e.cast.endMs - e.cast.startMs, 1))}"></span></div>
                {:else if e.cast.result === 'interrupted'}
                  {@const ib = e.cast.interruptedBy !== undefined ? unitById.get(e.cast.interruptedBy) : undefined}
                  {@const ibName = e.cast.interruptedBy !== undefined ? v.nameOf(e.cast.interruptedBy) : undefined}
                  {@const ibColor = classColorOf(ib?.specId)}
                  <div class="ec-status ok">✔ {#if ibName}<span class="ec-kicker" style={ibColor ? `color:${ibColor}` : ''}>{anon.name(ibName)}</span>{:else}interrupted{/if}</div>
                {:else if e.cast.result === 'success'}
                  <div class="ec-status bad">✖ went off</div>
                {:else}
                  <div class="ec-status muted">{e.cast.result}</div>
                {/if}
              </div>
            {/each}
          {:else}
            <span class="ecast-empty">no active enemy casts</span>
          {/if}
        </div>
      </div>
      {@render meterCard('DPS', meters.dps)}
      {@render meterCard('HPS', meters.hps)}
    </div>
    <div class="cards" class:compact={settings.compactReplay}>
      {#each players as p (p.unitId)}
        {@const hp = v.hpAt(p.unitId, t)}
        {@const hpPct = hp ? pctOf(hp.currentHp / Math.max(hp.maxHp, 1)) : '100%'}
        {@const powers = v.powerAt(p.unitId, t)}
        {@const filteredPowers = (powers ?? []).filter(pw => POWER_TYPES[pw.powerType] !== undefined)}
        {@const pc = v.playerCastAt(p.unitId, t)}
        {@const auras = v.aurasAt(p.unitId, t)}
        {@const gcd = v.gcdRemaining(p.unitId, t)}
        {@const debuffs = auras.filter((a) => a.auraType === 'DEBUFF')}
        {@const buffs = auras.filter((a) => a.auraType !== 'DEBUFF' && v.isImportantBuff(a.spellId))}
        {@const misc = auras.filter((a) => a.auraType !== 'DEBUFF' && !v.isImportantBuff(a.spellId))}
        {@const journal = v.playerJournal(p.unitId, t, 40, journalFilter)}
        {@const agg = v.combatAggregate(p.unitId, t)}
        {@const pops = v.recentCombat(p.unitId, t)}
        {@const cds = v.cooldownsAt(p.unitId, t)}
        {@const cc = classColorOf(p.specId)}
        <div
          class="card"
          style={cc ? `border-left:3px solid ${cc}; background:color-mix(in srgb, ${cc} 15%, var(--surface-2));` : ''}
        >
          <div class="name">
            <SpecIcon specId={p.specId} />
            <span class="pname" style={cc ? `color:${cc}` : ''} title={anon.name(p.name)}>{anon.name(p.name)}</span>
            <span class="gcd" title="approx GCD ~{(v.gcdMsFor(p.unitId) / 1000).toFixed(1)}s (from haste)" style="opacity:{gcd > 0 ? 1 : 0.15}"></span>
            {#if p.role === 'healer'}
              {@const cap = v.capacityAt(p.unitId, t)}
              {#if cap !== undefined}
                <span class="cap cap-{capTone(cap)}" title="Healer capacity ~{Math.round(cap * 100)}% — share of AVAILABLE cast time spent on healing casts over the last few seconds (≈ how busy they are, not a healing-vs-damage ratio). Approx; ignores movement/LoS/mana.">{Math.round(cap * 100)}%</span>
              {/if}
            {/if}
          </div>
          <!-- Incoming activity aggregate (above the bar): running totals of the current burst,
               aligned with the floating pops — healing LEFT, damage RIGHT, absorb toward the middle
               (damage-absorb left of damage; heal-absorb would sit right of heal). Fixed-height row
               so the card doesn't jump as it appears. -->
          <div class="cagg-row">
            <span class="cagg-side">
              {#if agg?.hasHeal && agg.heal > 0}<span class="cagg heal" class:on={agg.healActive}>+{abbrev(agg.heal)}</span>{/if}
            </span>
            <span class="cagg-side">
              {#if agg && agg.absorb > 0}<span class="cagg abs" title="incoming damage absorbed by shields">◈{abbrev(agg.absorb)}</span>{/if}
              {#if agg?.hasDmg && agg.dmg > 0}<span class="cagg dmg" class:on={agg.dmgActive}>−{abbrev(agg.dmg)}</span>{/if}
            </span>
          </div>
          <!-- HP defaults to full: M+ runs start at 100%, so show a full bar until the first HP
               sample lands (hold-last thereafter) rather than an empty "—" bar. The wrap lets the
               floating combat numbers escape the bar's overflow:hidden. -->
          <div class="hp-wrap">
            <span class="bar hp"><span class="barfill hpfill" style="width:{hpPct}"></span>
              <span class="barlbl">{hpPct}</span></span>
            {#each pops as pop, pi (pi)}
              <span class="cpop {pop.kind}" style="--age:{(pop.age / POP_FADE_MS).toFixed(3)}">{pop.kind === 'dmg' ? '−' : '+'}{abbrev(pop.amount)}</span>
            {/each}
          </div>
          {#each filteredPowers as pw (pw.powerType)}
            {@const pi = powerInfo(pw.powerType)}
            {@const frac = pw.max > 0 ? pw.current / pw.max : 0}
            <span class="bar pwbar" title="{pi.name}: {pw.current} / {pw.max}">
              <span class="barfill" style="width:{pctOf(frac)};background:{pi.color}"></span>
              <span class="barlbl pwlbl" style={pi.textColor ? `color:${pi.textColor}` : ''}>{pwLabel(pi, pw.current, pw.max, frac)}</span>
            </span>
          {/each}
          {#each Array.from({length: Math.max(0, maxPowerBars - filteredPowers.length)}) as _, i (i)}
            <span class="bar pwbar" style="visibility:hidden" aria-hidden="true"></span>
          {/each}
          <span class="bar" class:gcdbar={pc?.gcd} style={!pc ? 'visibility:hidden' : ''}>
            {#if pc}
              {@const cast = pc.cast}
              {@const progress = (t - cast.startMs) / Math.max(cast.endMs - cast.startMs, 1)}
              <span
                class="barfill"
                class:cast={!pc.gcd}
                class:gcdfill={pc.gcd}
                style="width:{pc.gcd ? pctOf(1 - progress) : pctOf(progress)}"
              ></span>
              {@const tgtName = cast.targetUnit && cast.targetUnit !== p.unitId ? v.nameOf(cast.targetUnit) : undefined}
              <span class="barlbl" title={pc.gcd ? 'estimated GCD (instant cast)' : undefined}><WowheadLink id={cast.spellId} name={v.spellName(cast.spellId)} />{#if tgtName} → {anon.name(tgtName)}{/if}</span>
            {/if}
          </span>
          <!-- Aura lanes: the group name is a faint watermark BEHIND the row (no label column), legible
               when the lane is empty and progressively covered as auras appear. Lanes always render.
               Each lane is wrapped so a hover popover (full list w/ icons + Wowhead links) can escape
               the lane's overflow:hidden — see the `auraPop` snippet. -->
          <!-- Lane order: COOLDOWNS → debuffs → buffs → misc. Always rendered (even empty — e.g. a
               healer with no interrupt yet) so every card's lanes line up. Cooldown chips are bright
               when ready, dim+countdown on CD; a ready INTERRUPT glows green ONLY while an
               interruptible enemy cast is in progress, a ready DISPEL glows green ONLY while a
               matching dispellable debuff is up on the team, and any CD just used flashes gold. -->
          <div class="lane-wrap">
            <div class="cdgrp">
              <!-- Centered faint icon indicating the lane's contents (cooldowns = clock), behind chips. -->
              <svg class="lane-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 1.8" /></svg>
              {#each cds as cd (cd.spellId)}
                <span
                  class="cd {cd.kind}"
                  class:cd-ready={cd.ready}
                  class:cd-kick={cd.ready && ((cd.kind === 'interrupt' && interruptWindow) || (cd.kind === 'dispel' && cd.provides !== undefined && cd.provides.some((c) => dispelWindowCats.has(c))))}
                  class:cd-used={cd.sinceCastMs !== undefined && cd.sinceCastMs < CD_FLASH_MS}
                  style={cd.sinceCastMs !== undefined && cd.sinceCastMs < CD_FLASH_MS ? `--flash:${(1 - cd.sinceCastMs / CD_FLASH_MS).toFixed(3)}` : ''}
                  title="{cd.name} — {cd.ready ? 'ready' : Math.ceil(cd.readyInMs / 1000) + 's'}"
                >
                  <WowheadLink id={cd.spellId} name={cd.name} />
                  {#if !cd.ready}<span class="cd-timer">{Math.ceil(cd.readyInMs / 1000)}s</span>{/if}
                </span>
              {/each}
            </div>
            {@render cdPop(cds)}
          </div>
          <div class="lane-wrap">
            <div class="auragrp deb">
              <!-- Debuffs = downward arrow (harmful effects on the player). -->
              <svg class="lane-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v13" /><path d="M6 12l6 6 6-6" /></svg>
              {#each debuffs as a (a.spellId)}
                {@const dang = v.isDangerousDebuff(a.spellId)}
                {@const cats = dang ? v.dispelCategoriesOf(a.spellId) : []}
                <span
                  class="aura deb"
                  class:danger={dang}
                  class:removable={cats.length > 0}
                  title={dang ? (cats.length ? `Dangerous debuff — dispellable (${cats.join(', ')})` : 'Dangerous debuff — heal through (no remover)') : undefined}
                ><WowheadLink id={a.spellId} name={v.spellName(a.spellId)} />{#if a.stacks > 1}<span class="stk">{a.stacks}</span>{/if}</span>
              {/each}
            </div>
            {@render auraPop('DEBUFFS', debuffs, v)}
          </div>
          <div class="lane-wrap">
            <div class="auragrp buff">
              <!-- Buffs = upward arrow (beneficial effects). -->
              <svg class="lane-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V6" /><path d="M6 12l6-6 6 6" /></svg>
              {#each buffs as a (a.spellId)}
                <span class="aura buff"><WowheadLink id={a.spellId} name={v.spellName(a.spellId)} />{#if a.stacks > 1}<span class="stk">{a.stacks}</span>{/if}</span>
              {/each}
            </div>
            {@render auraPop('BUFFS', buffs, v)}
          </div>
          <div class="lane-wrap">
            <div class="auragrp misc">
              <!-- Misc = three dots (the catch-all lane). -->
              <svg class="lane-ico" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" /></svg>
              {#if showMisc}
                {#each misc as a (a.spellId)}
                  <span class="aura"><WowheadLink id={a.spellId} name={v.spellName(a.spellId)} />{#if a.stacks > 1}<span class="stk">{a.stacks}</span>{/if}</span>
                {/each}
              {:else if misc.length}
                <span class="aura muted">⋯ {misc.length}</span>
              {/if}
            </div>
            {@render auraPop('MISC', misc, v)}
          </div>
          <div class="pjournal">
            <!-- Key MUST include the index: two journal events can share kind:spellId:ms (e.g. a
                 double-cast logged in the same millisecond). A duplicate {#each} key throws in
                 Svelte 5 and aborts the frame's flush — which froze every player card after the
                 first (the tank) while leaving the tank updating. -->
            {#each journal as e, ji (e.kind + ':' + e.spellId + ':' + e.ms + ':' + ji)}
              <div class="pje"
                   class:pje-cast={e.kind === 'cast'}
                   class:pje-applied={e.kind === 'aura-applied'}
                   class:pje-removed={e.kind === 'aura-removed'}
                   class:pje-taken={e.kind === 'damage-taken'}
                   class:pje-deb={e.auraType === 'DEBUFF'}
                   class:pje-danger={e.auraType === 'DEBUFF' && v.isDangerousDebuff(e.spellId)}>
                <span class="pje-time">{rel(e.ms, first)}</span>
                <span class="pje-spell"><WowheadLink id={e.spellId} name={v.spellName(e.spellId)} /></span>
                {#if e.amount}<span class="pje-amount">{e.kind === 'damage-taken' ? '−' : ''}{abbrev(e.amount)}</span>{/if}
                {#if e.kind === 'damage-taken' && e.absorbed}<span class="pje-absorb">◈{abbrev(e.absorbed)}</span>{/if}
                {#if e.kind === 'cast' && e.result && e.result !== 'success'}
                  <span class="pje-result" class:ok={e.result === 'interrupted'} class:bad={e.result === 'failed' || e.result === 'cancelled'}>{e.result === 'interrupted' ? 'INT' : e.result}</span>
                {/if}
                {#if e.kind === 'damage-taken'}
                  {#if e.sourceUnit}{@const sn = v.nameOf(e.sourceUnit)}{#if sn}<span class="pje-target">← {anon.name(sn)}</span>{/if}{/if}
                {:else if e.targetUnit}{@const tn = v.nameOf(e.targetUnit)}{#if tn}<span class="pje-target">→ {anon.name(tn)}</span>{/if}{/if}
              </div>
            {/each}
            {#if !journal.length}<div class="pje-empty">no events yet</div>{/if}
          </div>
        </div>
      {/each}
    </div>

    <div class="side-panel">
      <div class="sp-inner">
      <div class="kf-section" bind:this={kfSectionEl}>
        <div class="kfhdr">kill feed</div>
        {#each feedKills as k, i (k.unitId + ':' + k.ms + ':' + i)}
          <span class="kill {k.isPlayer ? 'kplayer' : 'kenemy'}"
                style="opacity:{0.35 + 0.65 * ((i + 1) / feedKills.length)}">
            ☠ {anon.name(k.name)}<span class="ktime">{rel(k.ms, first)}</span>
          </span>
        {/each}
      </div>
      <div class="ef-section" bind:this={efSectionEl}>
        <div class="efhdr">cast feed</div>
        {#each eFeed as e, efi (e.unit.unitId + ':' + e.cast.startMs + ':' + efi)}
          {@const inProg = t < e.cast.endMs}
          <div class="ef-entry" class:ef-danger={e.cast.dangerous} class:ef-inprog={inProg}>
            <div class="ef-meta">
              <span class="ef-name">{e.unit.name}</span>
              <span class="ef-time">{rel(e.cast.startMs, first)}</span>
            </div>
            <div class="ef-main">
              <span class="ef-spell"><WowheadLink id={e.cast.spellId} name={v.spellName(e.cast.spellId)} /></span>
              {#if e.cast.targetUnit}{@const etn = v.nameOf(e.cast.targetUnit)}{#if etn}<span class="ef-target">→ {anon.name(etn)}</span>{/if}{/if}
            </div>
            {#if inProg}
              <div class="ef-bar"><span class="ef-fill" style="width:{pctOf((t - e.cast.startMs) / Math.max(e.cast.endMs - e.cast.startMs, 1))}"></span></div>
              {#if e.cast.interruptible}<span class="ef-tag ef-int">INT</span>{/if}
            {:else if e.cast.result === 'interrupted'}
              <span class="ef-tag ef-ok">✔ interrupted</span>
            {:else if e.cast.result === 'success' && e.cast.interruptible}
              <span class="ef-tag ef-bad">✖ went off</span>
            {:else if e.cast.result === 'success'}
              <span class="ef-tag ef-done">completed</span>
            {/if}
          </div>
        {/each}
        {#if !eFeed.length}
          <span class="ef-empty">no casts yet</span>
        {/if}
      </div>
      </div><!-- /sp-inner -->
    </div>
    </div><!-- /cards-row -->
  {/if}
</section>

<style>
  /* Palette is driven by CSS variables with LIGHT fallbacks → /diag is unchanged. The `.embedded`
     class (set by the MVP shell) remaps them to the dark theme. Pure colors only; layout unchanged. */
  .section.embedded {
    --rp-text: var(--text, #111);
    --rp-muted: var(--muted, #888);
    --rp-border: var(--border, #2b333f);
    --rp-track: #11161d;
    --rp-surface: #1f2630;
    --rp-surface-2: #161b22;
    --rp-active: #29405a;
    --rp-accent: var(--accent, #4ea1ff);
    --rp-control-accent: var(--hover-accent, #8a5cff);
    --rp-good-bg: #16301f;
    --rp-bad-bg: #3a1620;
    --rp-aura-bg: #1b2430;
    --rp-aura-border: #313d4c;
    --rp-deb-bg: #371a20;
    --rp-deb-border: #6a2f3a;
    --rp-deb-text: #f0a5b0;
    --rp-buff-bg: #14301f;
    --rp-buff-border: #2c6a40;
    --rp-buff-text: #8fe0a8;
    --rp-lane-bg: #2a1616;
    --rp-lane-border: #5a2c2c;
    --rp-lane-hdr: #f0908a;
    --rp-danger: #ff6b6b;
    --rp-good: #5fd08a;
    --rp-bad: #ff6b6b;
    --rp-focus: #ffc23d;
    color: var(--rp-text);
    border: none; padding: 0; margin: 0; background: transparent;
  }
  .section.embedded > h2 { color: var(--rp-text); border-bottom: none; font-size: 15px; margin: 0 0 10px; }

  .controls { display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  .controls .muted { font-size: 12px; }
  .ctl-sep { width: 1px; align-self: stretch; margin: 2px 5px; background: var(--rp-border, #ccc); opacity: 0.6; }
  .leadin { display: inline-flex; align-items: center; gap: 4px; color: var(--rp-muted, var(--muted, #888)); font-size: 12px; }
  .leadin input {
    width: 42px; background: var(--rp-surface, #fff); color: var(--rp-text, inherit);
    border: 1px solid var(--rp-border, #ccc); border-radius: 5px; padding: 1px 4px; font-size: 12px; text-align: right;
  }
  /* Shared pill button for replay controls + player-pane toggles — matches the MVP's accent design.
     `.active` reads as a pressed/depressed toggle (accent tint + inset shadow). */
  /* "Building replay…" placeholder shown while the model is fetched or a background re-parse runs. */
  .rp-building { display: inline-flex; align-items: center; gap: 10px; padding: 14px 4px; font-size: 14px; color: var(--rp-muted, #888); }
  .rp-spin {
    width: 18px; height: 18px; border-radius: 50%; flex: none;
    border: 3px solid var(--rp-surface-2, rgba(255,255,255,0.12)); border-top-color: var(--rp-accent, #4ea1ff);
    animation: rp-spin 0.8s linear infinite;
  }
  @keyframes rp-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .rp-spin { animation-duration: 2.4s; } }

  /* Replay-load failure: a friendly inline message + retry (replaces the leaked /diag affordance). */
  .rp-error { display: inline-flex; align-items: center; gap: 12px; padding: 14px 4px; font-size: 14px; flex-wrap: wrap; }
  .rp-error .err { color: var(--rp-danger, #e06a6a); }

  .rp-btn {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--rp-surface, #fff); color: var(--rp-text, inherit);
    border: 1px solid var(--rp-border, #ccc); border-radius: 6px;
    padding: 4px 11px; font-size: 12px; font-weight: 500; line-height: 1.4; cursor: pointer;
    transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
  }
  .rp-btn:hover { background: var(--rp-surface-2, #f0f0f0); border-color: var(--rp-control-accent, #8a5cff); }
  .btn-ico { width: 14px; height: 14px; flex: none; display: block; }
  /* Icon-only toggles (misc buffs / compact / journal filter) — square, like the replay-band toggles. */
  .rp-btn.icon-only { padding: 5px 7px; gap: 3px; }
  .jf-count {
    font-size: 10px; font-weight: 700; line-height: 1;
    padding: 1px 4px; border-radius: 7px;
    background: var(--rp-control-accent, #8a5cff); color: #fff;
  }
  .rp-btn.active {
    background: color-mix(in srgb, var(--rp-control-accent, #8a5cff) 20%, var(--rp-surface, #fff));
    border-color: var(--rp-control-accent, #8a5cff); color: var(--rp-control-accent, #8a5cff); font-weight: 600;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.28);
  }
  /* Player-pane controls bar: misc-buffs toggle + the journal spell filter, centered above the cards.
     They share the exact `.rp-btn` style as the playback controls (no overrides) so they look identical. */
  .journals-bar { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 8px 0 4px; }
  /* `stretch` makes the side panel match the (taller) player-card column's height, so the cast feed
     (which flex-fills below the kill feed) lines its bottom up with the bottom of the player panels. */
  .cards-row { display: flex; gap: 8px; align-items: stretch; margin-top: 6px; }
  /* Left column beside the player panes: enemy-casts box + live DPS/HPS meters, stacked vertically.
     align-self:flex-start so it hugs the top rather than stretching when the cards wrap to 2 rows. */
  .replay-left { flex: none; width: 224px; align-self: flex-start; display: flex; flex-direction: column; gap: 8px; }
  /* Right-hand side panel: kill feed (top) + enemy cast feed (bottom, scrollable). It STRETCHES to the
     player-cards' height (align-items:stretch on the row), and its content is absolutely positioned
     (.sp-inner) so the growing feeds NEVER add intrinsic height — otherwise the accumulating cast feed
     drove the row, and thus the stretched cards, taller every frame during playback. */
  .side-panel {
    flex: none; width: 190px; position: relative; overflow: hidden;
    background: var(--rp-surface-2, #f5f5f5);
    border: 1px solid var(--rp-border, #ccc);
    border-radius: 6px;
  }
  .sp-inner { position: absolute; inset: 0; display: flex; flex-direction: column; }
  .kf-section {
    flex: 0 0 auto; max-height: 200px; display: flex; flex-direction: column; overflow-y: auto;
    padding: 6px 8px; gap: 3px; min-height: 44px;
  }
  .kfhdr { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--rp-muted, #888); padding-bottom: 4px; border-bottom: 1px solid var(--rp-border, #ddd); white-space: nowrap; }
  .kill { font-size: 12px; display: flex; align-items: baseline; gap: 5px; white-space: nowrap; }
  .kill.kplayer { color: var(--rp-danger, crimson); }
  .kill.kenemy { color: var(--rp-muted, #666); }
  .ktime { font-size: 10px; color: var(--rp-muted, #888); margin-left: auto; }
  /* Enemy cast feed — grows to fill the panel below the kill feed (so its bottom aligns with the
     player cards), scrolling internally when the casts exceed the space. */
  .ef-section {
    flex: 1 1 auto; min-height: 0; overflow-y: auto; /* min-height:0 ⇒ shrink & scroll, never grow the panel */
    border-top: 1px solid var(--rp-border, #ddd);
    padding: 6px 8px; display: flex; flex-direction: column; gap: 4px;
  }
  .efhdr { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--rp-muted, #888); padding-bottom: 4px; border-bottom: 1px solid var(--rp-border, #ddd); white-space: nowrap; margin-bottom: 2px; }
  .ef-entry { display: flex; flex-direction: column; gap: 1px; font-size: 11px; padding: 3px 4px; border-radius: 3px; background: var(--rp-surface, #fff); border: 1px solid var(--rp-border, #eee); }
  .ef-entry.ef-danger { border-color: var(--rp-danger, crimson); }
  .ef-entry.ef-inprog { border-color: #79c; background: var(--rp-active, #e8f0ff); }
  .ef-meta { display: flex; align-items: baseline; gap: 4px; }
  .ef-main { display: flex; align-items: baseline; gap: 4px; }
  .ef-name { font-size: 10px; color: var(--rp-muted, #666); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ef-time { font-size: 10px; color: var(--rp-muted, #888); flex-shrink: 0; }
  .ef-spell { font-weight: 600; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ef-target { font-size: 10px; color: var(--rp-muted, #888); flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 72px; }
  .ef-bar { height: 4px; background: var(--rp-track, #ddd); border-radius: 2px; overflow: hidden; margin-top: 2px; }
  .ef-fill { display: block; height: 100%; background: #79c; border-radius: 2px; }
  .ef-tag { font-size: 10px; font-weight: 700; margin-top: 1px; }
  .ef-int { color: #79c; }
  .ef-ok { color: var(--rp-good, green); }
  .ef-bad { color: var(--rp-bad, crimson); }
  .ef-done { color: var(--rp-muted, #aaa); }
  .ef-empty { font-size: 11px; color: var(--rp-muted, #aaa); font-style: italic; }
  /* Per-player combat journal (always visible) */
  .pjournal {
    margin-top: 4px; border-top: 1px solid var(--rp-border, #ddd);
    display: flex; flex-direction: column; justify-content: flex-end;
    overflow: hidden; max-height: 180px; min-height: 46px;
    padding-top: 3px; gap: 1px;
  }
  .pje-empty { font-size: 11px; color: var(--rp-muted, #aaa); font-style: italic; }
  .pje { display: flex; align-items: center; gap: 4px; font-size: 11px; padding: 1px 0; white-space: nowrap; }
  .pje-time { font-size: 10px; color: var(--rp-muted, #888); min-width: 34px; flex-shrink: 0; }
  /* Spell shows as its icon (see icon-only rules above); aura-removed dims the whole row to read as
     "faded", and a dangerous debuff gets a red ring around the icon. */
  .pje-spell { flex-shrink: 0; display: inline-flex; align-items: center; line-height: 0; }
  .pje-removed { opacity: 0.5; }
  .pje-danger .pje-spell :global(a) { box-shadow: inset 0 0 0 1px var(--rp-danger, #e0483a); border-radius: 3px; }
  .pje-amount { font-size: 10px; font-weight: 700; color: var(--rp-text, #222); flex-shrink: 0; font-variant-numeric: tabular-nums; }
  /* Incoming-damage rows: the spell hit the player → red value + "← source". */
  .pje-taken .pje-amount { color: var(--rp-danger, #d9534f); }
  .pje-absorb { font-size: 10px; font-weight: 700; color: #6cc6e0; flex-shrink: 0; font-variant-numeric: tabular-nums; }
  .pje-result { font-size: 10px; font-weight: 700; flex-shrink: 0; }
  .pje-result.ok { color: var(--rp-good, green); }
  .pje-result.bad { color: var(--rp-danger, crimson); }
  .pje-target { font-size: 10px; color: var(--rp-muted, #888); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  /* Enemy-casts lane + meter cards now fill the left column (`.replay-left`) — full width, stacked. The
     box stays STATIC-height (fixed 2-row grid, overflow clipped) so it never grows/shrinks as casts
     come and go. */
  .ecasts-lane { width: auto; }
  /* DPS / HPS meter cards — same header + same fixed body height as the enemy-casts box so they line up. */
  .meter-card { width: auto; }
  /* Floor at 90px so a 5-man lines up with the enemy-casts box; rows keep their natural height
     (never compress — `flex:0 0 auto`) and the list SCROLLS past a readable cap, so a 10–30 player
     raid stays legible instead of being crushed into a fixed band. */
  .meter-rows { min-height: 90px; max-height: 168px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .meter-row {
    position: relative; flex: 0 0 auto; display: flex; align-items: center; gap: 4px;
    font-size: 11px; padding: 1px 5px; border-radius: 3px; overflow: hidden;
    background: var(--rp-surface, #fff); border: 1px solid var(--rp-border, #eee);
  }
  .meter-bar { position: absolute; inset: 0 auto 0 0; opacity: 0.22; z-index: 0; }
  .meter-name { position: relative; z-index: 1; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meter-val { position: relative; z-index: 1; font-variant-numeric: tabular-nums; font-weight: 700; }
  .lanehdr { font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--rp-muted, #888); padding-bottom: 3px; border-bottom: 1px solid var(--rp-border, #ddd); margin-bottom: 4px; white-space: nowrap; }
  .ecast-empty { grid-column: 1 / -1; font-size: 11px; font-style: italic; color: var(--rp-muted, #888); padding: 2px 0; }
  /* 2-column grid (always exactly 2 wide, no flex/scrollbar width math) + overflow:hidden (no
     scrollbars, ever). 2 rows fit; >4 simultaneous casts just clip off the bottom — who cares. */
  .ecasts {
    display: grid; grid-template-columns: 1fr 1fr; align-content: start; gap: 4px;
    height: 90px; overflow: hidden;
  }
  .ecard {
    min-width: 0; height: 42px; /* uniform (trimmed) height */
    display: flex; flex-direction: column; gap: 0; overflow: hidden;
    border: 1px solid var(--rp-border, #ccc); border-radius: 5px;
    background: var(--rp-surface, #fff); padding: 1px 6px;
  }
  .ecard.danger { border-color: var(--rp-danger, crimson); }
  .ec-enemy { font-size: 9px; color: var(--rp-muted, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25; }
  .ec-spell { font-size: 10.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.25; }
  .ecard.danger .ec-spell { color: var(--rp-danger, crimson); }
  .ec-tgt { font-weight: 400; color: var(--rp-muted, #888); }
  .ec-bar { height: 4px; margin-top: 1px; background: var(--rp-track, #ddd); border: 1px solid var(--rp-border, #ccc); border-radius: 2px; overflow: hidden; }
  .ec-fill { display: block; height: 100%; background: #79c; }
  .ec-status { font-size: 10px; font-weight: 700; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ec-status.ok { color: var(--rp-good, green); }
  .ec-status.bad { color: var(--rp-bad, crimson); }
  .ec-status.muted { color: var(--rp-muted, #aaa); font-weight: 500; }
  .ec-kicker { font-weight: 800; }
  .cards { flex: 1 1 0; min-width: 0; display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; align-content: flex-start; }
  .card { border: 1px solid var(--rp-border, #ccc); border-radius: 6px; padding: 6px 8px; background: var(--rp-surface, transparent); width: 240px; }
  /* Player-card aura/cooldown chips are ICON-ONLY in BOTH normal and compact mode — the spell name +
     ready state live in the hover popover. Wowhead decorates the chip link with an <ins> ICON element +
     the renamed name in a sibling: we hide the name (keeping <ins>) and size the link to a fixed square.
     The combat-journal spell (.pje-spell) gets the same treatment at a smaller size. Compact mode ALSO
     narrows the card. */
  .cards.compact .card { width: 145px; padding: 5px 6px; }
  .cards .aura, .cards .cd { padding: 1px; gap: 0; position: relative; }
  .cards .cd-timer { display: none; }
  /* Stack count as a small badge in the chip's upper-right corner. */
  .cards .stk {
    position: absolute; top: 0; right: 0; z-index: 3;
    min-width: 11px; height: 11px; padding: 0 1.5px; box-sizing: border-box;
    font-size: 8.5px; font-weight: 800; line-height: 11px; text-align: center;
    font-variant-numeric: tabular-nums; color: #fff;
    background: rgba(10, 12, 18, 0.92); border-radius: 6px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.45); pointer-events: none;
  }
  /* The "removable" green dot moves to the TOP-LEFT corner so it doesn't sit under the stack badge
     (top-right) — both stay visible on a stacking dangerous debuff. */
  .cards .aura.deb.danger.removable::after {
    position: absolute; top: 0; left: 0; margin: 0; z-index: 3;
  }
  .cards .aura :global(a), .cards .cd :global(a), .pje-spell :global(a) {
    display: inline-block !important; padding: 0 !important; overflow: hidden; vertical-align: middle;
    background-size: contain !important; background-repeat: no-repeat !important; background-position: center !important;
  }
  .cards .aura :global(a), .cards .cd :global(a) { width: 18px; height: 18px; }
  .pje-spell :global(a) { width: 14px; height: 14px; }
  /* Hide the NAME (a non-<ins> child element or bare text), keep Wowhead's <ins> icon element. */
  .cards .aura :global(a > *:not(ins)), .cards .cd :global(a > *:not(ins)), .pje-spell :global(a > *:not(ins)) { display: none !important; }
  .cards .aura :global(a > ins), .cards .cd :global(a > ins) {
    position: static !important; margin: 0 !important; width: 18px !important; height: 18px !important;
    background-size: contain !important; background-position: center !important;
  }
  .pje-spell :global(a > ins) {
    position: static !important; margin: 0 !important; width: 14px !important; height: 14px !important;
    background-size: contain !important; background-position: center !important;
  }
  .card .name { font-weight: 600; display: flex; align-items: center; gap: 5px; }
  .pname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .gcd { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #e8a000; margin-left: 6px; vertical-align: middle; }
  /* Healer capacity stoplight: a small pill with the rolling utilization %, colored by pressure. */
  .cap {
    flex: none; font-size: 10px; font-weight: 800; font-variant-numeric: tabular-nums;
    padding: 1px 5px; border-radius: 999px; line-height: 1.4;
    border: 1px solid currentColor; background: color-mix(in srgb, currentColor 16%, transparent);
  }
  .cap-green { color: var(--rp-good, #5fd08a); }
  .cap-amber { color: var(--rp-focus, #e8b84b); }
  .cap-red { color: var(--rp-danger, #ff6b6b); }
  /* Incoming-activity aggregate row above the HP bar (damage / absorb / heal of the current burst).
     Fixed height so the card layout doesn't shift as it appears/clears. */
  .cagg-row { height: 13px; display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1; }
  .cagg-side { display: flex; align-items: center; gap: 6px; } /* heal (left) | absorb+damage (right) */
  .cagg { opacity: 0.55; } /* lingering total */
  .cagg.on { opacity: 1; }  /* still actively taking damage / being healed */
  .cagg.dmg { color: var(--rp-danger, #d9534f); }
  .cagg.abs { color: #6cc6e0; }
  .cagg.heal { color: var(--rp-good, #5fd08a); }
  /* Floating combat numbers: rise + fade over the HP bar (age normalized to --age in [0,1]). */
  .hp-wrap { position: relative; }
  .cpop {
    position: absolute; top: 0; pointer-events: none; z-index: 2;
    font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; white-space: nowrap;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
    opacity: calc(1 - var(--age)); transform: translateY(calc(var(--age) * -15px));
  }
  .cpop.dmg { right: 6px; color: #ff8080; }
  .cpop.heal { left: 6px; color: #74e0a0; }
  .bar { position: relative; display: block; height: 19px; background: var(--rp-track, #eee); border: 1px solid var(--rp-border, #ccc); border-radius: 3px; margin: 2px 0; overflow: hidden; }
  .barfill { position: absolute; left: 0; top: 0; bottom: 0; }
  .hpfill { background: #5b5; }
  .cast { background: #79c; }
  .pwbar { height: 19px; margin-top: 1px; }
  .pwlbl { font-size: 10px; line-height: 19px; color: rgba(255,255,255,0.75); }
  /* Estimated-GCD bar: muted track, fill drains right→left (full at cast, empty at GCD end). */
  .gcdbar { border-style: dashed; background: var(--rp-gcd-track, #2a3140); }
  .gcdfill { background: #3d4f68; } /* left:auto;right:0 applied inline to win specificity over .barfill */
  .barlbl { position: relative; padding: 0 4px; white-space: nowrap; font-size: 11px; line-height: 19px; }
  /* Aura groups: debuffs / important buffs / misc. A faint CENTERED icon (.lane-ico) sits behind the
     row — not a label column — legible when empty, covered as auras fill in. */
  .auragrp {
    position: relative; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 3px;
    margin-top: 3px; height: 48px; overflow: hidden; /* fits 2 rows of icon chips */
  }
  .auragrp > :global(*) { position: relative; z-index: 1; } /* chips cover the watermark icon */
  /* Centered faint lane icon (shared by the cooldown + aura lanes). The compound selectors below win
     over the generic `> *` chip rule (which would otherwise force position:relative / z-index:1). */
  .cdgrp > .lane-ico, .auragrp > .lane-ico {
    position: absolute; inset: 0; margin: auto; width: 22px; height: 22px;
    z-index: 0; opacity: 0.16; pointer-events: none;
  }
  .auragrp.deb > .lane-ico { color: var(--rp-deb-text, #b55); }
  .auragrp.buff > .lane-ico { color: var(--rp-buff-text, #4a7); }
  .auragrp.misc > .lane-ico { color: var(--rp-muted, #999); }
  .aura {
    display: inline-flex; align-items: center; gap: 3px;
    background: var(--rp-aura-bg, #eef); border: 1px solid var(--rp-aura-border, #bbd);
    border-radius: 4px; padding: 1px 5px; font-size: 11px;
  }
  .aura.deb { background: var(--rp-deb-bg, #fdd); border-color: var(--rp-deb-border, #d99); }
  /* Dangerous debuff (curated): a healer should spot these instantly. Red glow + gentle pulse.
     A `removable` (dispellable) one gets a small green dot meaning "a remover can clear this" — vs a
     heal-through one (no dot), where dispelling won't help and the team must heal it off. The green
     DISPEL cooldown chip glowing tells the healer they can act NOW; dim/countdown = heal through. */
  .aura.deb.danger {
    border-color: var(--rp-danger, #e0483a);
    background: color-mix(in srgb, var(--rp-danger, #e0483a) 26%, var(--rp-deb-bg, #fdd));
    font-weight: 700;
    box-shadow: 0 0 6px color-mix(in srgb, var(--rp-danger, #e0483a) 55%, transparent);
    animation: debpulse 1.7s ease-in-out infinite;
  }
  .aura.deb.danger.removable::after {
    content: ''; flex: none; width: 6px; height: 6px; border-radius: 50%; margin-left: 1px;
    background: var(--rp-good, #5fd08a); box-shadow: 0 0 4px var(--rp-good, #5fd08a);
  }
  @keyframes debpulse {
    0%, 100% { box-shadow: 0 0 4px color-mix(in srgb, var(--rp-danger, #e0483a) 40%, transparent); }
    50% { box-shadow: 0 0 10px color-mix(in srgb, var(--rp-danger, #e0483a) 80%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) { .aura.deb.danger { animation: none; } }
  .aura.buff { background: var(--rp-buff-bg, #e6f6ec); border-color: var(--rp-buff-border, #9c9); font-weight: 600; }
  .aura.muted { background: var(--rp-surface-2, #f4f4f4); border-color: var(--rp-border, #ddd); color: var(--rp-muted, #888); cursor: default; }
  /* Spell links inside chips/labels keep the chip's color over Wowhead's inline link color. */
  .aura :global(a), .barlbl :global(a), .ec-spell :global(a) { color: inherit !important; text-decoration: none; }
  .aura :global(a:hover), .ec-spell :global(a:hover) { text-decoration: underline; }
  .ok { color: var(--rp-good, green); }
  .bad { color: var(--rp-bad, crimson); }

  /* Important-cooldown lane: same faint centered icon as the aura lanes; chips bright when ready,
     dimmed + grayscaled with a countdown when on cooldown. A ready INTERRUPT gets a green highlight
     (the "can kick now" signal you scan for during an enemy cast). */
  .cdgrp {
    position: relative; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 3px;
    margin-top: 3px; height: 48px; overflow: hidden; /* fixed 2-row height (icon chips), matches .auragrp so cards line up */
  }
  .cdgrp > .lane-ico { color: var(--rp-accent, #4ea1ff); }
  .cdgrp > :global(*) { position: relative; z-index: 1; }
  .cd {
    display: inline-flex; align-items: center; gap: 3px;
    border: 1px solid var(--rp-border, #ccc); border-radius: 4px; padding: 1px 5px; font-size: 11px;
    background: var(--rp-surface-2, #f4f4f4); opacity: 0.42; filter: grayscale(0.6); /* on cooldown */
  }
  .cd.cd-ready { opacity: 1; filter: none; }
  /* Ready interrupt/dispel, highlighted green ONLY while a matching enemy cast/debuff is up (act now!).
     Green pulse mirrors the dangerous-debuff glow so "kick now" reads as strongly as "danger". */
  .cd.cd-kick {
    border-color: var(--rp-good, #5fd08a);
    background: color-mix(in srgb, var(--rp-good, #5fd08a) 26%, var(--rp-good-bg, #e6f6ec));
    font-weight: 700;
    box-shadow: 0 0 6px color-mix(in srgb, var(--rp-good, #5fd08a) 55%, transparent);
    animation: kickpulse 1.6s ease-in-out infinite;
  }
  @keyframes kickpulse {
    0%, 100% { box-shadow: 0 0 4px color-mix(in srgb, var(--rp-good, #5fd08a) 45%, transparent); }
    50% { box-shadow: 0 0 11px color-mix(in srgb, var(--rp-good, #5fd08a) 88%, transparent); }
  }
  @media (prefers-reduced-motion: reduce) { .cd.cd-kick { animation: none; } }
  /* Just used: gold flash that fades back to the on-CD look as --flash (1→0). Defined last to win. */
  .cd.cd-used {
    border-color: #e8b84b; filter: none; opacity: calc(0.45 + 0.55 * var(--flash, 0));
    box-shadow: 0 0 6px rgba(232, 184, 75, calc(0.85 * var(--flash, 0)));
  }
  .cd-timer { font-weight: 700; color: var(--rp-muted, #888); font-variant-numeric: tabular-nums; }
  .cd :global(a) { color: inherit !important; text-decoration: none; }

  /* Aura-lane hover popover: full list (name + Wowhead icon/link), escapes the lane overflow. */
  .lane-wrap { position: relative; }
  .aura-pop {
    position: absolute; left: 0; top: 100%; z-index: 20; display: none;
    min-width: 100%; max-width: 300px; max-height: 230px; overflow-y: auto;
    background: var(--rp-surface, #fff); border: 1px solid var(--rp-border, #ccc);
    border-radius: 6px; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35); padding: 5px 6px;
  }
  .lane-wrap:hover .aura-pop { display: block; }
  .aura-pop-hdr {
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--rp-muted, #888); margin-bottom: 3px;
  }
  .aura-pop-body { display: flex; flex-direction: column; gap: 2px; }
  .aura-pop-row { font-size: 11px; white-space: nowrap; display: flex; align-items: center; gap: 3px; }
  .aura-pop-row.danger :global(a) { color: var(--rp-danger, #e0483a) !important; font-weight: 700; }
  .aura-pop-row.danger.removable::after {
    content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--rp-good, #5fd08a);
  }
  .aura-pop-row :global(a) { color: var(--rp-text, inherit) !important; text-decoration: none; }
  .aura-pop-row :global(a:hover) { text-decoration: underline; }

  /* Journal-filter popup: pick spells to hide from every player's combat journal. */
  .jfilter { position: relative; display: inline-block; }
  .jfilter-pop {
    position: absolute; right: 0; top: calc(100% + 4px); z-index: 30; width: 250px;
    background: var(--rp-surface, #fff); border: 1px solid var(--rp-border, #ccc);
    border-radius: 6px; box-shadow: 0 8px 22px rgba(0, 0, 0, 0.4); padding: 6px;
  }
  .jfilter-head { display: flex; gap: 4px; align-items: center; }
  .jfilter-search {
    flex: 1; min-width: 0; background: var(--rp-surface-2, #f5f5f5); color: var(--rp-text, inherit);
    border: 1px solid var(--rp-border, #ccc); border-radius: 4px; padding: 2px 5px; font-size: 12px;
  }
  .jfilter-clear, .jfilter-x {
    background: transparent; border: 1px solid var(--rp-border, #ccc); border-radius: 4px;
    color: var(--rp-muted, #888); cursor: pointer; font-size: 11px; padding: 2px 5px; flex: none;
  }
  .jfilter-clear:disabled { opacity: 0.4; cursor: default; }
  .jfilter-hint { font-size: 10px; color: var(--rp-muted, #888); margin: 4px 0 3px; }
  .jfilter-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 1px; }
  .jfilter-row {
    display: flex; align-items: center; gap: 5px; font-size: 12px; padding: 2px 3px;
    border-radius: 3px; cursor: pointer; white-space: nowrap;
  }
  .jfilter-row:hover { background: var(--rp-surface-2, #f0f0f0); }
  /* Active (currently-applied) filters sit at the top, tinted so they're easy to spot + remove. */
  /* Hidden (unchecked) rows read as "off": dimmed, floated to the top so they're easy to restore. */
  .jfilter-row.jf-off { opacity: 0.5; }
  .jfilter-row :global(a) { color: var(--rp-text, inherit) !important; text-decoration: none; }
  .jfilter-empty { font-size: 11px; color: var(--rp-muted, #aaa); font-style: italic; padding: 4px; }
</style>
