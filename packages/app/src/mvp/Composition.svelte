<!-- Party composition from COMBATANT_INFO: each player's spec, average item level, and secondary
     stats (crit/haste/mastery/vers). Foundation surface for the new talent/gear data — gear detail
     and talents are carried in the report but not rendered here yet. -->
<script lang="ts">
  import type { CombatantInfo, RosterEntry } from '@wow/engine';
  import SpecIcon from './SpecIcon.svelte';
  import { classColorOf, classNameOf, specNameOf } from './specVisuals.js';
  import { anon } from './anon.svelte.js';

  let {
    combatants = [],
    roster = [],
  }: { combatants?: CombatantInfo[]; roster?: RosterEntry[] } = $props();

  // guid → roster entry (display name + role) so we can label + order players.
  let byGuid = $derived(new Map(roster.map((r) => [r.guid, r])));
  const roleRank = (role: RosterEntry['role']): number =>
    role === 'tank' ? 0 : role === 'healer' ? 1 : role === 'dps' ? 2 : 3;

  type Row = CombatantInfo & { name: string; role: RosterEntry['role'] };
  let rows = $derived.by((): Row[] => {
    return combatants
      .map((c): Row => {
        const r = byGuid.get(c.guid);
        return {
          ...c,
          name: r?.name ?? specNameOf(c.specId) ?? 'Unknown',
          role: r?.role,
        };
      })
      .sort((a, b) => roleRank(a.role) - roleRank(b.role) || b.itemLevel - a.itemLevel || a.name.localeCompare(b.name));
  });

  const STATS: { key: keyof CombatantInfo['stats']; label: string }[] = [
    { key: 'crit', label: 'Crit' },
    { key: 'haste', label: 'Haste' },
    { key: 'mastery', label: 'Mast' },
    { key: 'versatility', label: 'Vers' },
  ];
</script>

{#if rows.length}
  <section class="card">
    <h2>Composition <span class="muted">· {rows.length} player{rows.length === 1 ? '' : 's'}</span></h2>
    <div class="grid">
      {#each rows as p (p.guid)}
        {@const color = classColorOf(p.specId) ?? 'var(--text)'}
        <div class="player" style="--cc:{color}">
          <span class="who">
            <SpecIcon specId={p.specId} />
            <span class="identity">
              <span class="spec" style="color:{color}">{[specNameOf(p.specId), classNameOf(p.specId)].filter(Boolean).join(' ') || 'Unknown spec'}</span>
              <span class="nm muted">{anon.name(p.name)}</span>
            </span>
          </span>
          <span class="stat ilvl" title="average equipped item level">
            {#if p.itemLevel > 0}
              <span class="sk">ILVL</span><span class="sv">{p.itemLevel}</span>
            {/if}
          </span>
          <span class="stats">
            {#each STATS as s (s.key)}
              <span class="stat"><span class="sk">{s.label}</span><span class="sv">{p.stats[s.key].toLocaleString()}</span></span>
            {/each}
          </span>
        </div>
      {/each}
    </div>
    <p class="foot muted">Stats are rating values from the log's COMBATANT_INFO (raw ratings, not %).</p>
  </section>
{/if}

<style>
  .grid { display: flex; flex-direction: column; gap: 6px; }
  .player {
    display: grid; grid-template-columns: minmax(180px, 1fr) 50px minmax(168px, 184px); align-items: center; gap: 8px;
    background: var(--surface-2); border: 1px solid var(--border); border-left: 3px solid var(--cc);
    border-radius: 7px; padding: 8px 12px;
  }
  .who { display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; }
  .identity { display: flex; flex: 1 1 auto; min-width: 0; flex-direction: column; gap: 1px; line-height: 1.15; }
  .spec { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .nm { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ilvl { min-height: 1em; }
  .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 5px; }
  .stat { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.15; }
  .sk { font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .sv { font-size: 11.5px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .foot { margin: 10px 0 0; font-size: 11.5px; }
  @media (max-width: 640px) {
    .player { grid-template-columns: 1fr auto; }
    .stats { grid-column: 1 / -1; justify-content: space-between; }
  }
</style>
