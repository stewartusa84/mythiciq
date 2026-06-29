<!-- Pulls tab. M+: the detected segments (boss pulls + trash), each seekable in the replay, with MDT
     enemy-forces enrichment. Raid: the run's bosses bucketed (wipes + kill = attempts), each attempt
     seekable. Trash bucketing for raids is a deferred follow-up. -->
<script lang="ts">
  import type { RunReport, Segment, BossBucket } from '@wow/engine';
  import { mmss } from '../report.js';
  import type { SeekOptions } from '../replayController.svelte.js';

  let { report, onSeek }: { report: RunReport; onSeek: (ms: number, opts?: SeekOptions) => void } = $props();

  let bosses = $derived(report.bosses);

  // --- M+ rows (segments + running enemy-forces %); unused for raids. ---
  type Row = { s: Segment; cumPct: number };
  let rows = $derived.by<Row[]>(() => {
    const segs = report.segments.map((r) => r.segment);
    const total = segs.find((s) => s.mdt?.forcesTotal)?.mdt?.forcesTotal ?? 0;
    let cum = 0;
    return segs.map((s) => {
      cum += s.mdt?.forces ?? 0;
      return { s, cumPct: total ? (cum / total) * 100 : 0 };
    });
  });
  let total = $derived(rows.find((r) => r.s.mdt?.forcesTotal)?.s.mdt?.forcesTotal ?? 0);
  let finalPct = $derived(rows.length ? rows[rows.length - 1]!.cumPct : 0);

  const label = (s: Segment): string =>
    s.kind === 'encounter' ? (s.name ?? 'Boss') : (s.mdt?.title ?? 'trash');

  // --- Raid: which boss buckets are expanded to show their attempts. ---
  let expanded = $state<Set<number>>(new Set());
  const toggle = (id: number) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    expanded = next;
  };
  const seekBucket = (b: BossBucket) => {
    // Seek to the killing pull if there is one, else the first attempt.
    const a = b.attempts.find((x) => x.success) ?? b.attempts[0];
    if (a) onSeek(a.startMs, { label: `boss: ${b.name}`, window: { startMs: a.startMs, endMs: a.endMs } });
  };
</script>

{#if bosses}
  <!-- Raid: bosses bucketed. -->
  <section class="card">
    <h2>Bosses <span class="muted">· {bosses.length}</span></h2>
    {#if bosses.length === 0}
      <p class="muted">No boss encounters detected in this session.</p>
    {:else}
      <div class="rows">
        {#each bosses as b (b.encounterId)}
          <div class="boss-group">
            <div class="boss">
              <button class="boss-main" onclick={() => seekBucket(b)}>
                <span class="kind kboss">boss</span>
                <span class="nm">{b.name}</span>
                <span class="badge {b.killed ? 'good' : 'bad'}">{b.killed ? '✓ kill' : '✗ wipe'}</span>
                <span class="pulls">{b.pulls} {b.pulls === 1 ? 'pull' : 'pulls'}</span>
                {#if b.killTimeMs !== undefined}<span class="dur muted">kill {mmss(b.killTimeMs)}</span>{/if}
              </button>
              {#if b.attempts.length > 1}
                <button class="expand" aria-label="Show attempts" onclick={() => toggle(b.encounterId)}>
                  {expanded.has(b.encounterId) ? '▾' : '▸'}
                </button>
              {/if}
            </div>
            {#if expanded.has(b.encounterId)}
              <div class="attempts">
                {#each b.attempts as a, i (a.segmentIndex)}
                  <button
                    class="attempt"
                    onclick={() =>
                      onSeek(a.startMs, {
                        label: `${b.name} · pull ${i + 1}`,
                        window: { startMs: a.startMs, endMs: a.endMs },
                      })}
                  >
                    <span class="t">{mmss(a.startMs - report.firstMs)}</span>
                    <span class="anm">Pull {i + 1}</span>
                    <span class="badge {a.success ? 'good' : 'bad'}">{a.success ? '✓ kill' : '✗ wipe'}</span>
                    <span class="dur muted">{mmss(a.durationMs)}</span>
                    <span class="go">▶</span>
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{:else}
  <!-- M+: segments + enemy-forces. -->
  <section class="card">
    <h2>
      Pulls <span class="muted">· {rows.length}</span>
      {#if total}<span class="forces" title="enemy forces pulled / required">{Math.round(finalPct)}% forces</span>{/if}
    </h2>
    {#if rows.length === 0}
      <p class="muted">No pulls detected in this run.</p>
    {:else}
      <div class="rows">
        {#each rows as { s, cumPct } (s.index)}
          <button
            class="pull"
            class:boss={s.kind === 'encounter'}
            onclick={() =>
              onSeek(s.startMs, {
                label: `${s.kind === 'encounter' ? 'boss' : 'pull'}: ${label(s)}`,
                window: { startMs: s.startMs, endMs: s.endMs },
              })}
          >
            <span class="t">{mmss(s.startMs - report.firstMs)}</span>
            <span class="kind" class:kboss={s.kind === 'encounter'}>{s.kind === 'encounter' ? 'boss' : 'trash'}</span>
            <span class="nm">{label(s)}</span>
            {#if s.kind === 'encounter'}
              {#if s.success !== undefined}
                <span class="badge {s.success ? 'good' : 'bad'}">{s.success ? '✓ kill' : '✗ wipe'}</span>
              {/if}
            {:else}
              {#if s.mobCount}<span class="mobs" title="enemies engaged">{s.mobCount} 💀</span>{/if}
              {#if s.mdt?.bossArea}<span class="badge area" title="boss-encounter adds fought outside the pull">boss adds</span>{/if}
              {#if total}
                <span class="force" title="this pull / cumulative enemy forces">+{s.mdt?.forces ?? 0} · {Math.round(cumPct)}%</span>
              {/if}
            {/if}
            <span class="dur muted">{mmss(s.durationMs)}</span>
            <span class="go">▶</span>
          </button>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .forces { font-size: 12px; color: var(--accent); font-weight: 700; margin-left: 6px; }
  .rows { display: flex; flex-direction: column; gap: 4px; }
  .pull {
    display: flex; align-items: center; gap: 10px; text-align: left;
    background: var(--surface-2); border: 1px solid var(--border); border-radius: 7px;
    padding: 6px 11px; cursor: pointer; color: var(--text); font-size: 14px;
  }
  .pull:hover { border-color: var(--hover-accent, #8a5cff); }
  .pull.boss { border-left: 3px solid var(--accent); }
  .t { font-variant-numeric: tabular-nums; font-weight: 700; color: var(--accent); min-width: 48px; }
  .kind {
    color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; min-width: 42px;
  }
  .kind.kboss { color: var(--accent); font-weight: 700; }
  .nm { flex: 1; font-weight: 600; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mobs { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; flex: none; }
  .force {
    font-size: 11px; color: var(--accent); font-variant-numeric: tabular-nums; flex: none;
    background: color-mix(in srgb, var(--accent) 14%, transparent); border-radius: 5px; padding: 1px 6px;
  }
  .badge { font-size: 11px; border-radius: 5px; padding: 1px 6px; flex: none; }
  .badge.good { color: #5fd08a; background: #16301f; }
  .badge.bad { color: #ff6b6b; background: #3a1620; }
  .badge.area { color: #e0b34a; background: color-mix(in srgb, #e0b34a 16%, transparent); }
  .dur { font-variant-numeric: tabular-nums; flex: none; }
  .go { color: var(--muted); flex: none; }

  /* Raid boss buckets */
  .boss-group { display: flex; flex-direction: column; gap: 4px; }
  .boss { display: flex; align-items: stretch; gap: 4px; }
  .boss-main {
    flex: 1; display: flex; align-items: center; gap: 10px; text-align: left;
    background: var(--surface-2); border: 1px solid var(--border); border-left: 3px solid var(--accent);
    border-radius: 7px; padding: 7px 11px; cursor: pointer; color: var(--text); font-size: 14px; min-width: 0;
  }
  .boss-main:hover { border-color: var(--hover-accent, #8a5cff); }
  .pulls { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; flex: none; }
  .expand {
    flex: none; width: 30px; border: 1px solid var(--border); border-radius: 7px;
    background: var(--surface-2); color: var(--muted); cursor: pointer; font-size: 12px;
  }
  .expand:hover { border-color: var(--hover-accent, #8a5cff); color: var(--text); }
  .attempts { display: flex; flex-direction: column; gap: 3px; margin-left: 22px; }
  .attempt {
    display: flex; align-items: center; gap: 10px; text-align: left;
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    padding: 5px 10px; cursor: pointer; color: var(--text); font-size: 13px;
  }
  .attempt:hover { border-color: var(--hover-accent, #8a5cff); }
  .anm { flex: 1; font-weight: 600; min-width: 0; }
</style>
