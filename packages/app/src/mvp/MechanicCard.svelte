<!-- Reusable "mechanic card" — the learning-system view of one enemy mechanic. Renders the consolidated
     card from @wow/data/mechanics (bundle.cards via cardFor): identity, classification badges, what-it-does
     summary, role-lensed advice, tags, and video links. Used inline (Avoidable Damage details) and in the
     standalone Mechanics library. Degrades gracefully — shows whatever the card has curated. -->
<script lang="ts">
  import type { MechanicCard } from '@wow/engine';
  import WowheadLink from './WowheadLink.svelte';
  import { cardFor } from './avoidableAdvice.js';
  import mBookIcon from '../../../assets/img/m-book.svg';

  let {
    spellId,
    card: cardProp,
    compact = false,
  }: { spellId?: number; card?: MechanicCard; compact?: boolean } = $props();
  let card = $derived(cardProp ?? (spellId != null ? cardFor(spellId) : undefined));
  let id = $derived(card?.spellId ?? spellId);

  const ROLES = [
    { key: 'tank', label: 'Tank' },
    { key: 'healer', label: 'Healer' },
    { key: 'dps', label: 'DPS' },
  ] as const;
  let roleLines = $derived(
    ROLES.map((r) => ({ ...r, text: card?.advice?.[r.key]?.trim() })).filter((r) => r.text),
  );

  // Deep-link a YouTube video to its atSeconds offset; otherwise return the url untouched.
  function videoUrl(url: string, atSeconds?: number): string {
    if (!atSeconds || atSeconds <= 0) return url;
    if (/youtu\.?be/.test(url)) return url + (url.includes('?') ? '&' : '?') + `t=${Math.floor(atSeconds)}`;
    return url;
  }

  function contributorName(source?: string): string | undefined {
    const s = source?.trim();
    if (!s) return undefined;
    if (['guide_or_curated', 'inferred_from_interrupt_list', 'method+wowhead'].includes(s)) return 'MythicIQ';
    return s;
  }

  let contributor = $derived(contributorName(card?.source));
  // Only surface an http(s) link (the backend validates on submit; guard again for older bundles).
  let contributorUrl = $derived(
    /^https?:\/\//i.test(card?.sourceUrl?.trim() ?? '') ? card!.sourceUrl!.trim() : undefined,
  );
</script>

{#if card}
  <div class="mcard" class:compact style="--mbook: url({mBookIcon})">
    <div class="mhead">
      <span class="mname">
        {#if id != null}<WowheadLink {id} name={card.name} />{:else}{card.name ?? 'Mechanic'}{/if}
      </span>
      <span class="badges">
        {#if card.avoidable}<span class="badge avoid" title="Telegraphed, personally avoidable">Avoidable</span>{/if}
        {#if card.interruptPriority}<span class="badge intr" class:hot={card.interruptPriority === 'dangerous'} title="Interruptible cast">Interruptible</span>{/if}
        {#if card.danger}<span class="badge deb" title="Dangerous debuff applied to players">Dangerous debuff</span>{/if}
      </span>
    </div>

    {#if card.caster || card.dungeon}
      <div class="mmeta">
        {#if card.caster}<span>{card.caster}</span>{/if}
        {#if card.caster && card.dungeon}<span class="dot">·</span>{/if}
        {#if card.dungeon}<span class="dim">{card.dungeon}</span>{/if}
        {#if card.boss}<span class="bosschip" title="Boss ability">boss</span>{/if}
      </div>
    {/if}

    {#if card.removableCategories?.length}
      <div class="removable">
        <span class="rlabel">Removable by</span>
        {#each card.removableCategories as cat (cat)}<span class="rcat">{cat}</span>{/each}
      </div>
    {/if}

    {#if card.summary}<p class="msummary" class:clamp={compact}>{card.summary}</p>{/if}

    {#if compact}
      {#if !card.summary && card.advice?.generic}<p class="msummary clamp dim">{card.advice.generic}</p>{/if}
      <span class="more"><span class="moreico"></span>Open details</span>
    {:else}
    {#if card.advice?.generic}
      <p class="advice generic">{card.advice.generic}</p>
    {/if}
    {#each roleLines as r (r.key)}
      <div class="advice role">
        <span class="rolechip {r.key}">{r.label}</span>
        <span class="rtext">{r.text}</span>
      </div>
    {/each}

    {#if card.videos?.length}
      <div class="videos">
        {#each card.videos as v (v.url)}
          <a class="vlink" href={videoUrl(v.url, v.atSeconds)} target="_blank" rel="noopener noreferrer">
            <span class="vicon">▶</span>{v.title ?? 'Watch'}{#if v.atSeconds}<span class="vat">@{Math.floor(v.atSeconds / 60)}:{String(Math.floor(v.atSeconds % 60)).padStart(2, '0')}</span>{/if}
          </a>
        {/each}
      </div>
    {/if}

    {#if card.tags?.length}
      <div class="tags">{#each card.tags as t (t)}<span class="tag">{t}</span>{/each}</div>
    {/if}

    {#if contributor}
      <div class="prov">
        <span class="src">Contributed by
          {#if contributorUrl}<a class="srclink" href={contributorUrl} target="_blank" rel="noopener noreferrer nofollow">{contributor}</a>{:else}{contributor}{/if}
        </span>
      </div>
    {/if}
    {/if}
  </div>
{:else}
  <div class="mcard empty"><span class="dim">No curated details for this mechanic yet.</span></div>
{/if}

<style>
  .mcard {
    position: relative; overflow: hidden;
    border: 1px solid var(--border, #2a2f3a); border-radius: 8px; padding: 12px 14px;
    background: var(--surface-2, #1b1f29); color: var(--text); font-size: 13px; line-height: 1.5;
  }
  .mcard > * { position: relative; z-index: 1; }
  .mcard.compact {
    min-height: 146px;
    display: flex;
    flex-direction: column;
  }
  .mcard.empty { color: var(--muted); }
  .mhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .mname { font-weight: 700; font-size: 14px; }
  .mname :global(a) { color: var(--text); text-decoration: none; }
  .mname :global(a:hover) { color: var(--accent); text-decoration: underline; }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; }
  .badge {
    padding: 1px 7px; border-radius: 8px; font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.04em; border: 1px solid currentColor; white-space: nowrap;
  }
  .badge.avoid { color: var(--warn, #e0a82e); }
  .badge.intr { color: #6fb3ff; }
  .badge.intr.hot { color: #ff8f6f; }
  .badge.deb { color: var(--bad, #e06666); }
  .mmeta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 6px; margin-top: 4px; font-size: 12px; color: var(--text); opacity: 0.9; }
  .mmeta > span:not(.dot) { flex: none; }
  .mmeta .dim, .dim { color: var(--muted); }
  .mmeta .dot { color: var(--muted); }
  .bosschip { padding: 0 5px; border-radius: 6px; font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: var(--bad, #e06666); border: 1px solid currentColor; }
  .removable { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 7px; }
  .rlabel { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .rcat { padding: 0 7px; border-radius: 8px; font-size: 11px; background: color-mix(in srgb, var(--accent, #5b8cff) 22%, transparent); color: var(--accent, #9bb6ff); }
  .msummary { margin: 9px 0 2px; font-size: 13.5px; color: var(--text); }
  .msummary.dim { color: var(--muted); }
  .msummary.clamp { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .more { display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; font-size: 11px; font-weight: 650; color: var(--accent, #9bb6ff); }
  .compact .more { margin-top: auto; padding-top: 8px; }
  /* The "m-book" mark next to the details hint, painted with the MythicIQ gradient via mask. */
  .moreico {
    width: 16px; height: 12px; display: block; flex: none;
    background: linear-gradient(135deg, #b86cff 0%, #7b55ff 45%, #238cff 100%);
    -webkit-mask: var(--mbook) center / contain no-repeat;
    mask: var(--mbook) center / contain no-repeat;
  }
  .advice { margin: 6px 0 0; }
  .advice.generic { color: var(--text); opacity: 0.9; }
  .advice.role { display: flex; gap: 7px; align-items: baseline; }
  .rolechip {
    flex-shrink: 0; padding: 0 6px; border-radius: 8px; font-size: 9.5px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em; border: 1px solid currentColor; vertical-align: 1px;
  }
  .rolechip.tank { color: #6fb3ff; }
  .rolechip.healer { color: #5fd08a; }
  .rolechip.dps { color: #e0a82e; }
  .rtext { color: var(--text); opacity: 0.85; }
  .videos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .vlink {
    display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 8px;
    font-size: 12px; text-decoration: none; color: var(--text);
    background: var(--surface, #232834); border: 1px solid var(--border, #2a2f3a);
  }
  .vlink:hover { border-color: var(--accent, #5b8cff); color: var(--accent, #9bb6ff); }
  .vicon { color: var(--bad, #e06666); font-size: 10px; }
  .vat { color: var(--muted); font-variant-numeric: tabular-nums; }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
  .tag { padding: 0 7px; border-radius: 8px; font-size: 10.5px; color: var(--muted); background: var(--surface, #232834); }
  .prov { margin-top: 9px; font-size: 10.5px; color: var(--muted); display: flex; gap: 5px; align-items: baseline; }
  .src { color: color-mix(in srgb, var(--accent, #9bb6ff) 82%, var(--muted)); }
  .srclink { color: var(--accent, #9bb6ff); text-decoration: none; }
  .srclink:hover { text-decoration: underline; }
  @media (max-width: 520px) {
    .mmeta .dot { display: none; }
  }
</style>
