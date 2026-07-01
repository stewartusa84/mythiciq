<!-- Mechanics library — a run-independent browser of ALL curated mechanic cards (from the served
     bundle), the "Learn" main window. Hierarchical scope: All → All Dungeons → each dungeon → All Raids
     → each raid → each encounter (data-driven from the cards' kind/instance). Tiles are compact + click
     to pop the full card in the root detail overlay. `scope` (from the rail Dungeon/Raid sub-items)
     pre-selects dungeons vs raids. -->
<script lang="ts">
  import type { MechanicCard } from '@wow/engine';
  import MechanicCardView from './MechanicCard.svelte';
  import { allCards } from './avoidableAdvice.js';
  import { mechanicDetail } from './mechanicDetail.svelte.js';
  import mBookIcon from '../../../assets/img/m-book.svg';

  let { scope = 'all' }: { scope?: 'all' | 'dungeon' | 'raid' } = $props();

  let cards: MechanicCard[] = $derived(allCards());
  const isRaid = (c: MechanicCard) => c.kind === 'encounter';
  let dungeonNames = $derived([...new Set(cards.filter((c) => !isRaid(c)).map((c) => c.dungeon).filter(Boolean) as string[])].sort());
  // Raids: instance → sorted encounter names.
  let raids = $derived.by(() => {
    const by = new Map<string, Set<string>>();
    for (const c of cards) {
      if (!isRaid(c) || !c.instance) continue;
      (by.get(c.instance) ?? by.set(c.instance, new Set()).get(c.instance)!).add(c.dungeon ?? '');
    }
    return [...by.entries()]
      .map(([inst, encs]) => ({ inst, encounters: [...encs].filter(Boolean).sort() }))
      .sort((a, b) => a.inst.localeCompare(b.inst));
  });
  let hasRaids = $derived(raids.length > 0);

  // The hierarchical scope selector value. Encodes the level: all | all-dungeons | d:<name> |
  // all-raids | r:<inst> | e:<inst>::<enc>.
  const scopeDefault = (s: typeof scope) => (s === 'dungeon' ? 'all-dungeons' : s === 'raid' ? 'all-raids' : 'all');
  let sel = $state('all');
  // Follow the rail sub-item (Dungeon/Raid): set the scope BEFORE first paint and on every change.
  $effect.pre(() => {
    sel = scopeDefault(scope);
  });

  let query = $state('');
  type Kind = 'all' | 'avoidable' | 'interruptible' | 'debuff';
  let kind = $state<Kind>('all');
  type GroupBy = 'caster' | 'dungeon' | 'name';
  let groupBy = $state<GroupBy>('dungeon');
  const KIND_OPTIONS: { value: Kind; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'avoidable', label: 'Avoidable' },
    { value: 'interruptible', label: 'Interruptible' },
    { value: 'debuff', label: 'Debuffs' },
  ];
  const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
    { value: 'caster', label: 'Caster' },
    { value: 'dungeon', label: 'Dungeon' },
    { value: 'name', label: 'A-Z' },
  ];

  function inScope(c: MechanicCard): boolean {
    if (sel === 'all') return true;
    if (sel === 'all-dungeons') return !isRaid(c);
    if (sel === 'all-raids') return isRaid(c);
    if (sel.startsWith('d:')) return !isRaid(c) && c.dungeon === sel.slice(2);
    if (sel.startsWith('r:')) return isRaid(c) && c.instance === sel.slice(2);
    if (sel.startsWith('e:')) {
      const [inst, enc] = sel.slice(2).split('::');
      return isRaid(c) && c.instance === inst && c.dungeon === enc;
    }
    return true;
  }

  let filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((c) => {
      if (!inScope(c)) return false;
      if (kind === 'avoidable' && !c.avoidable) return false;
      if (kind === 'interruptible' && !c.interruptPriority) return false;
      if (kind === 'debuff' && !c.danger) return false;
      if (!q) return true;
      const hay = [c.name, c.caster, c.dungeon, c.instance, c.summary, ...(c.tags ?? []), ...(c.removableCategories ?? [])].join(' ').toLowerCase();
      return hay.includes(q);
    });
  });

  function contextLabel(c: MechanicCard): string {
    return isRaid(c) && c.instance ? `${c.instance} / ${c.dungeon ?? 'Encounter'}` : c.dungeon ?? 'Other';
  }

  function casterLabel(c: MechanicCard): string {
    const caster = c.caster?.trim();
    if (caster) return c.boss ? `Boss / ${caster}` : caster;
    return c.boss ? 'Boss mechanics' : 'Unknown caster';
  }

  function alphaLabel(c: MechanicCard): string {
    const first = (c.name ?? '').trim().charAt(0).toUpperCase();
    return /^[A-Z]$/.test(first) ? first : '#';
  }

  function singleContextSelected(): boolean {
    return sel.startsWith('d:') || sel.startsWith('e:');
  }

  function groupLabel(c: MechanicCard): string {
    if (groupBy === 'dungeon') return contextLabel(c);
    if (groupBy === 'name') return alphaLabel(c);
    const caster = casterLabel(c);
    return singleContextSelected() ? caster : `${contextLabel(c)} / ${caster}`;
  }

  function priority(c: MechanicCard): number {
    if (c.danger === 'dangerous') return 0;
    if (c.interruptPriority === 'dangerous') return 1;
    if (c.avoidable) return 2;
    if (c.interruptPriority) return 3;
    return 4;
  }

  function cardName(c: MechanicCard): string {
    return c.name ?? String(c.spellId ?? 'Mechanic');
  }

  function compareCards(a: MechanicCard, b: MechanicCard): number {
    if (groupBy === 'dungeon') {
      const boss = Number(!a.boss) - Number(!b.boss);
      if (boss) return boss;
      const caster = (a.caster ?? '').localeCompare(b.caster ?? '');
      if (caster) return caster;
      const prio = priority(a) - priority(b);
      if (prio) return prio;
      return cardName(a).localeCompare(cardName(b));
    }
    if (groupBy === 'caster') {
      const prio = priority(a) - priority(b);
      if (prio) return prio;
      return cardName(a).localeCompare(cardName(b));
    }
    return cardName(a).localeCompare(cardName(b));
  }

  // Group filtered cards by a user-facing axis, then sort cards predictably inside each group.
  let groups = $derived.by(() => {
    const by = new Map<string, MechanicCard[]>();
    for (const c of filtered) {
      const label = groupLabel(c);
      (by.get(label) ?? by.set(label, []).get(label)!).push(c);
    }
    return [...by.entries()]
      .map(([label, list]) => [label, [...list].sort(compareCards)] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
  });

  let showRaidEmpty = $derived((sel === 'all-raids' || sel.startsWith('r:') || sel.startsWith('e:')) && filtered.length === 0);
</script>

<div class="libpane" style="--mbook: url({mBookIcon})">
  <header class="lhead">
    <div class="title-row">
      <h2 class="ltitle">Mechanics Library</h2>
      <span class="count">{filtered.length} {filtered.length === 1 ? 'card' : 'cards'}</span>
    </div>
    <div class="controls">
      <input class="search" type="search" placeholder="Search name, mob, tag…" bind:value={query} />
      <select class="sel" bind:value={sel} aria-label="Scope">
        <option value="all">All</option>
        <optgroup label="Dungeons">
          <option value="all-dungeons">All Dungeons</option>
          {#each dungeonNames as d (d)}<option value={'d:' + d}>{d}</option>{/each}
        </optgroup>
        <optgroup label="Raids">
          <option value="all-raids">All Raids{hasRaids ? '' : ' (none yet)'}</option>
          {#each raids as r (r.inst)}
            <option value={'r:' + r.inst}>{r.inst}</option>
            {#each r.encounters as enc (enc)}<option value={'e:' + r.inst + '::' + enc}>&nbsp;&nbsp;— {enc}</option>{/each}
          {/each}
        </optgroup>
      </select>
      <div class="segblock" aria-label="Group mechanics">
        <span class="seglabel">Group</span>
        <div class="kinds">
          {#each GROUP_OPTIONS as opt (opt.value)}
            <button class="kbtn" class:on={groupBy === opt.value} onclick={() => (groupBy = opt.value)}>{opt.label}</button>
          {/each}
        </div>
      </div>
      <div class="kinds" aria-label="Filter mechanics">
        {#each KIND_OPTIONS as opt (opt.value)}
          <button class="kbtn" class:on={kind === opt.value} onclick={() => (kind = opt.value)}>{opt.label}</button>
        {/each}
      </div>
    </div>
  </header>

  <div class="body">
    {#if showRaidEmpty}
      <p class="empty">No raid mechanics curated yet.<br /><span class="hint">Add cards under <code>curation/mechanics/&lt;raid&gt;/&lt;encounter&gt;.json</code> and run <code>build:mechanics</code>.</span></p>
    {:else if filtered.length === 0}
      <p class="empty">No mechanics match.</p>
    {:else}
      {#each groups as [label, list] (label)}
        <section class="grp">
          <h3 class="grph">{label} <span class="gn">{list.length}</span></h3>
          <div class="grid">
            {#each list as c (c.spellId)}
              <button class="tile" onclick={() => mechanicDetail.open(c.spellId)} title="Open details">
                <MechanicCardView card={c} compact />
              </button>
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</div>

<style>
  .libpane {
    position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden;
    background:
      linear-gradient(180deg, rgba(12, 22, 43, 0.42), rgba(3, 8, 18, 0.1)),
      var(--bg, #12151c);
  }
  .libpane::before {
    content: '';
    position: absolute;
    right: max(22px, 4vw);
    bottom: max(18px, 4vh);
    width: min(70vw, 832px);
    aspect-ratio: 1197 / 767;
    pointer-events: none;
    background: linear-gradient(135deg, #8a5cff, #2788ff 58%, #54dfe0);
    opacity: 0.055;
    -webkit-mask: var(--mbook) center / contain no-repeat;
    mask: var(--mbook) center / contain no-repeat;
  }
  .lhead { position: relative; z-index: 1; padding: 16px 20px 12px; border-bottom: 1px solid var(--border, #2a2f3a); }
  .title-row { display: flex; align-items: baseline; gap: 9px; margin-bottom: 12px; }
  .ltitle { font-size: 17px; font-weight: 750; color: var(--text); margin: 0; letter-spacing: 0; }
  .count { font-size: 12px; color: var(--muted); font-weight: 550; }
  .controls { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  .search {
    flex: 1 1 220px; min-width: 160px; padding: 7px 10px; border-radius: 8px; font-size: 13px;
    background: var(--surface-2, #1b1f29); border: 1px solid var(--border, #2a2f3a); color: var(--text);
  }
  .sel {
    padding: 7px 10px; border-radius: 8px; font-size: 13px; color: var(--text); max-width: 280px;
    background: var(--surface-2, #1b1f29); border: 1px solid var(--border, #2a2f3a); color-scheme: dark; cursor: pointer;
  }
  .segblock { display: flex; align-items: center; gap: 7px; }
  .seglabel { font-size: 10.5px; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); }
  .kinds { display: flex; gap: 4px; flex-wrap: wrap; }
  .kbtn { padding: 6px 10px; border-radius: 8px; font-size: 12px; cursor: pointer; color: var(--muted); background: var(--surface-2, #1b1f29); border: 1px solid var(--border, #2a2f3a); }
  .kbtn.on { color: var(--accent, #9bb6ff); border-color: var(--accent, #5b8cff); }
  .body { position: relative; z-index: 1; flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px; }
  .grp { margin-bottom: 18px; }
  .grph { font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 10px; }
  .gn { color: var(--muted); opacity: 0.7; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
  .tile { text-align: left; padding: 0; background: transparent; border: 0; cursor: pointer; display: block; border-radius: 8px; }
  .tile :global(.mcard) { transition: border-color 0.12s, transform 0.12s, background 0.12s; height: 100%; }
  .tile:hover :global(.mcard),
  .tile:focus-visible :global(.mcard) {
    border-color: var(--accent, #5b8cff);
    transform: translateY(-1px);
  }
  .tile:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent, #5b8cff) 70%, transparent); outline-offset: 3px; }
  .empty { color: var(--muted); text-align: center; padding: 48px 0; line-height: 1.7; }
  .empty .hint { font-size: 12px; }
  .empty code { background: var(--surface-2, #1b1f29); padding: 1px 5px; border-radius: 5px; }
  @media (max-width: 860px) {
    .segblock { flex-basis: 100%; }
    .grid { grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
  }
</style>
