<!-- Role Review tab: a scannable, role-grouped read of the run instead of a raw analytic dump.
     Each role gets a headline number, class-colored magnitude bars (who did what), and a strip of the
     few derived stats that actually tell you something (heal reaction, recovery, cleanse efficiency,
     tank mitigation). Empty/absent analytics simply don't render their section. -->
<script lang="ts">
  import type {
    RunReport, OwnerInfo, RosterEntry,
    DamageResult, HealingResult, DamageTakenResult, InterruptsResult,
    HealResponseResult, RecoveryResult, RemovalResult, TankMeleeResult, InterruptPriorityResult, DispelPriorityResult,
    InterruptAccountabilityResult, ClutchResult, ClutchPlay,
  } from '@wow/engine';
  import { analytic, abbrev, mmss } from '../report.js';
  import { anon } from '../anon.svelte.js';
  import { classColorOf } from '../specVisuals.js';
  import { tip } from '../tip.js';

  let { report, owner, roster }: { report: RunReport; owner: OwnerInfo | null; roster: RosterEntry[] } = $props();

  type Bar = { name: string; value: number; label: string; color?: string };

  // Player set + name→class-color (analytics key rows by real name; anon only masks at render time).
  let players = $derived(new Set(roster.map((r) => r.name)));
  let colorByName = $derived.by(() => {
    const m = new Map<string, string>();
    for (const r of roster) { const c = classColorOf(r.specId); if (c) m.set(r.name, c); }
    return m;
  });

  // ---- analytic pulls ----
  let dmg = $derived(analytic<DamageResult>(report, 'dps.overall'));
  let heal = $derived(analytic<HealingResult>(report, 'hps.overall'));
  let healResp = $derived(analytic<HealResponseResult>(report, 'healer.healResponse'));
  let recov = $derived(analytic<RecoveryResult>(report, 'healer.recovery'));
  let removal = $derived(analytic<RemovalResult>(report, 'removal.cleanse'));
  let dispels = $derived(analytic<{ total: number; bySource: { id: number; name: string; value: number }[] }>(report, 'dispels'));
  let tank = $derived(analytic<TankMeleeResult>(report, 'tank.unmitigatedMelee'));
  let taken = $derived(analytic<DamageTakenResult>(report, 'damageTaken'));
  let interrupts = $derived(analytic<InterruptsResult>(report, 'interrupts'));
  let interruptsPrio = $derived(analytic<InterruptPriorityResult>(report, 'interrupts.priority'));
  let dispelsPrio = $derived(analytic<DispelPriorityResult>(report, 'dispels.priority'));
  let acct = $derived(analytic<InterruptAccountabilityResult>(report, 'interrupts.accountability'));
  let acctById = $derived(new Map((acct?.players ?? []).map((p) => [p.id, p])));
  let clutch = $derived(analytic<ClutchResult>(report, 'utility.clutch'));
  let clutchList = $derived((clutch?.plays ?? []).slice(0, 8));
  let livesSaved = $derived((clutch?.byCaster ?? []).reduce((a, c) => a + c.lifeSaved, 0));

  const CLUTCH_ICON: Record<ClutchPlay['kind'], string> = {
    'damage-reduction': '🛡', immunity: '🛡', 'death-prevent': '💗', pull: '🪢',
  };
  function clutchContext(p: ClutchPlay): string {
    const parts: string[] = [];
    if (p.targetHpFraction != null) parts.push(`@ ${Math.round(p.targetHpFraction * 100)}% HP`);
    if (p.kind === 'pull') parts.push('repositioned');
    else if (p.damageWeathered > 0) parts.push(`weathered ${abbrev(p.damageWeathered)}`);
    return parts.join(' · ');
  }

  // Keep only player rows, sort high→low, build class-colored bars with a custom value label.
  function toBars<T extends { name: string }>(
    rows: T[] | undefined, getVal: (r: T) => number, fmt: (v: number) => string,
  ): Bar[] {
    return (rows ?? [])
      .filter((r) => players.has(r.name))
      .map((r) => ({ name: r.name, value: getVal(r), label: fmt(getVal(r)), color: colorByName.get(r.name) }))
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value);
  }

  let dmgBars = $derived(toBars(dmg?.bySource, (r) => r.dps, (v) => `${abbrev(v)} dps`));

  // Per-player damage rows with interrupt accountability joined in (DPS only have acct entries;
  // any damage-dealing tank/healer rows still show their DPS bar, just no kick line).
  type DpsRow = {
    id: number; name: string; dps: number; color?: string;
    tracked: boolean; hasInterrupt: boolean; interrupted: number; missed: number; damageAllowed: number;
  };
  let dpsRows = $derived.by((): DpsRow[] =>
    (dmg?.bySource ?? [])
      .filter((r) => players.has(r.name) && r.dps > 0)
      .map((r) => {
        const a = acctById.get(r.id);
        return {
          id: r.id, name: r.name, dps: r.dps, color: colorByName.get(r.name),
          tracked: !!a,
          hasInterrupt: a ? a.interruptSpellId !== null : false,
          interrupted: a?.interrupted ?? 0,
          missed: a?.missed ?? 0,
          damageAllowed: a?.damageAllowed ?? 0,
        };
      })
      .sort((a, b) => b.dps - a.dps),
  );
  let hpsBars = $derived(toBars(heal?.bySource, (r) => r.hps, (v) => `${abbrev(v)} hps`));
  let takenBars = $derived(toBars(taken?.byActor, (r) => r.value, (v) => abbrev(v)));
  let intBars = $derived(toBars(interrupts?.bySource, (r) => r.value, (v) => `${v}`));
  let dispelBars = $derived(toBars(dispels?.bySource, (r) => r.value, (v) => `${v}`));
  // High-priority (dangerous) subsets, per player — shown above the all-priority lists.
  let intPrioBars = $derived(toBars(interruptsPrio?.bySourceDangerous, (r) => r.value, (v) => `${v}`));
  let dispelPrioBars = $derived(toBars(dispelsPrio?.bySourceDangerous, (r) => r.value, (v) => `${v}`));

  // The tank's own mitigation line (the tank unit per the analytic).
  let tankUnit = $derived(tank?.perUnit.find((u) => u.unitId === tank?.tankUnitId) ?? tank?.perUnit.find((u) => u.isTank) ?? null);

  const sec = (ms: number | null | undefined) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`);
  const pct1 = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)}%`;

  // Dangerous-action rates: shown only when at least one dangerous instance occurred (no "0/0").
  let dangerInt = $derived.by(() => {
    const d = interruptsPrio?.byPriority.dangerous;
    return d && d.success + d.missed > 0 ? d : null;
  });
  let dangerDispel = $derived.by(() => {
    const d = dispelsPrio?.byPriority.dangerous;
    return d && d.success + d.miss > 0 ? d : null;
  });
  let durSec = $derived(dmg?.durationSeconds ?? heal?.durationSeconds ?? 0);

  let hasDamage = $derived(dmgBars.length > 0);
  let hasHealing = $derived(hpsBars.length > 0 || (healResp?.stats.count ?? 0) > 0 || !!removal);
  let hasTank = $derived(!!tankUnit || takenBars.length > 0);
  let hasUtility = $derived(intBars.length > 0 || dispelBars.length > 0 || !!dangerInt || !!dangerDispel || clutchList.length > 0);
</script>

{#if owner}
  <p class="owner muted">Log owner: <b>{anon.name(owner.name)}</b></p>
{/if}

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

{#snippet stat(num: string, label: string, help: string = '', tone: 'ok' | 'warn' | 'bad' | '' = '')}
  <div class="stat">
    <span class="snum {tone}">{num}</span>
    <span class="slabel muted">{label}{#if help}<span class="qmark" use:tip={help}>?</span>{/if}</span>
  </div>
{/snippet}

{#if !hasDamage && !hasHealing && !hasTank && !hasUtility}
  <p class="muted">No role analytics available for this run.</p>
{/if}

{#if hasDamage && dmg}
  {@const dmgMax = Math.max(1, ...dpsRows.map((r) => r.dps))}
  <section class="rcard">
    <div class="rhead"><h3>Damage</h3><div class="big"><span class="bignum">{abbrev(dmg.raidDps)}</span><span class="bigunit">overall DPS</span><span class="muted small">· {abbrev(dmg.totalDamage)} over {mmss(durSec * 1000)}</span></div></div>
    <div class="bars">
      {#each dpsRows as r, i (r.id)}
        <div class="dpsrow">
          <div class="bhead">
            <span class="bname">
              <span class="brank">{i + 1}</span>
              <span class="bn" style={r.color ? `color:${r.color}` : ''}>{anon.name(r.name)}</span>
            </span>
            <span class="bv">{abbrev(r.dps)} dps</span>
          </div>
          <div class="track"><div class="fill" style="width:{(r.dps / dmgMax) * 100}%;{r.color ? `background:${r.color}` : ''}"></div></div>
          {#if r.tracked}
            <div class="kickline">
              {#if r.hasInterrupt}
                <span class="kstat" use:tip={'Dangerous (high-priority) enemy casts this player interrupted.'}>⚔ {r.interrupted} <span class="kl">kicked</span></span>
                <span class="kstat {r.missed > 0 ? 'warn' : 'ok'}" use:tip={'Dangerous enemy casts that WENT OFF while this player could have interrupted — alive, and their interrupt was available (or on cooldown only because they spent it on a non-dangerous cast; wasting it on trash doesn\'t excuse missing an important cast). Only interrupting another DANGEROUS cast counts as legitimately busy. The same cast can count against everyone who had an interrupt available.'}>✖ {r.missed} <span class="kl">missed</span></span>
                {#if r.damageAllowed > 0}
                  <span class="kstat warn" use:tip={"Party damage taken from those missed dangerous casts (the cast's own spell landing on players within 8s). The avoidable damage allowed by not interrupting. Approximate — bounded by spell-table coverage; casts whose damage uses a different spell id under-count."}>{abbrev(r.damageAllowed)} <span class="kl">dmg allowed</span></span>
                {/if}
              {:else}
                <span class="kstat muted" use:tip={"No interrupt is mapped for this player's spec, so kick accountability isn't tracked for them."}>no interrupt</span>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if hasHealing}
  <section class="rcard">
    <div class="rhead"><h3>Healing</h3>
      {#if heal}<div class="big"><span class="bignum">{abbrev(heal.raidHps)}</span><span class="bigunit">overall HPS</span><span class="muted small">· {abbrev(heal.totalHealing)} total</span></div>{/if}
    </div>
    <div class="strip">
      {#if healResp && healResp.stats.count > 0}
        {@render stat(sec(healResp.stats.percentiles.p50), 'reaction time', `Median time from a player's HP crossing below the low-HP threshold to the next effective heal (raw − overheal) landing on them — over ${healResp.stats.count} low-HP episode(s). Lower means the healer responds faster. Players who died before any heal landed are excluded here and counted under "died while low".`)}
        {#if healResp.diedWhileLow > 0}{@render stat(`${healResp.diedWhileLow}`, 'died while low', `Times a player dropped below the low-HP threshold and DIED before any effective heal reached them. Bucketed separately so they don't flatter the reaction-time median by quietly dropping the hardest cases.`, 'bad')}{/if}
      {/if}
      {#if recov && recov.stats.completed.count > 0}
        {@render stat(sec(recov.stats.completed.percentiles.p50), 'recovery time', `Median time a player stayed hurt before climbing back to healthy, over ${recov.stats.completed.count} episode(s). Hysteresis: an episode opens when HP falls below the "damaged" threshold and closes when it reaches the higher "healthy" threshold. Lower = players get topped back up faster.`)}
        {#if recov.stats.censoredByDeath > 0}{@render stat(`${recov.stats.censoredByDeath}`, 'never recovered', `Damaged episodes that ended in death before the player returned to healthy. They have no recovery time, so they can't enter the median above — that median reflects survivors only. Surfaced here separately so the survivor-only median isn't mistaken for the whole picture (survivorship bias).`, 'warn')}{/if}
      {/if}
      {#if removal && removal.overall.applied > 0}
        {@render stat(`${removal.overall.removed}/${removal.overall.applied}`, 'debuffs cleansed', `Of ${removal.overall.applied} dangerous-debuff application(s) with a KNOWN removal (a dispel school, or a mechanic the log shows can be cleared), ${removal.overall.removed} were removed before they expired. Bounded by spell-table coverage — uncurated debuffs aren't scored.`, removal.overall.removed > 0 ? 'ok' : '')}
        {#if removal.overall.missedRemovable > 0}{@render stat(`${removal.overall.missedRemovable}`, 'missed · removable', `Dangerous debuffs that expired WITHOUT being removed even though the group had a remover capable of clearing them — a dispel/cleanse tool existed and went unused (not "nobody could remove it").`, 'warn')}{/if}
      {/if}
    </div>

    {#if hpsBars.length}{@render bars(hpsBars)}{/if}
  </section>
{/if}

{#if hasTank}
  <section class="rcard">
    <div class="rhead"><h3>Tank</h3>{#if tankUnit}<div class="big"><span class="bigname" style={colorByName.get(tankUnit.name) ? `color:${colorByName.get(tankUnit.name)}` : ''}>{anon.name(tankUnit.name)}</span><span class="muted small">· {tankUnit.swings} melee swings taken</span></div>{/if}</div>

    {#if tankUnit}
      <div class="strip">
        {@render stat(`${tankUnit.bigHits.count}`, `big hits · ${pct1(tankUnit.bigHits.pctOfSwings)} of swings`, `Melee swings that landed for at least 30% of the tank's MAX HP at the moment of impact (max HP read from the HP timeline). A high count or % means the tank is eating large unmitigated chunks — usually a mitigation-timing or external-cooldown issue.`, tankUnit.bigHits.count > 0 ? 'warn' : 'ok')}
        {@render stat(abbrev(tankUnit.bigHits.damage), 'big-hit damage', `Total damage from those big hits (the ≥30%-max-HP melee swings). Pairs with the big-hit count to show how much of the tank's intake came from dangerous spikes vs. steady chip damage.`)}
        {#if tank?.activeMitigationConfigured && tankUnit.amDownUnmitigated}
          {@render stat(`${tankUnit.amDownUnmitigated.count}`, `no mitigation · ${pct1(tankUnit.amDownUnmitigated.pctOfSwings)} of swings`, `Melee swings that landed while the tank had NO no-cooldown active-mitigation buff up (Ironfur / Shield of the Righteous / Ignore Pain / Bone Shield, by class). Lower is better — it measures active-mitigation uptime against melee. Bounded by which mitigation buffs are curated.`, tankUnit.amDownUnmitigated.count > 0 ? 'warn' : 'ok')}
        {/if}
      </div>
    {/if}

    {#if takenBars.length}
      <div class="subh muted">Damage taken</div>
      {@render bars(takenBars)}
    {/if}
  </section>
{/if}

{#if hasUtility}
  <section class="rcard">
    <div class="rhead"><h3>Utility</h3>
      <div class="bigs">
        {#if dangerInt}<div class="big"><span class="bignum">{dangerInt.success}/{dangerInt.success + dangerInt.missed}</span><span class="bigunit">dangerous casts kicked</span></div>{/if}
        {#if dangerDispel}<div class="big"><span class="bignum">{dangerDispel.success}/{dangerDispel.success + dangerDispel.miss}</span><span class="bigunit">dangerous debuffs dispelled</span></div>{/if}
        {#if clutchList.length}<div class="big"><span class="bignum good">{livesSaved || clutchList.length}</span><span class="bigunit">{livesSaved ? 'lives saved' : 'clutch plays'}</span></div>{/if}
      </div>
    </div>

    {#if intPrioBars.length}
      <div class="subh muted">High-priority interrupts<span class="qmark" use:tip={'Interrupts landed on DANGEROUS (high-priority) enemy casts only — the kicks that actually mattered. Bounded by curated spell-table coverage.'}>?</span></div>
      {@render bars(intPrioBars)}
    {/if}
    {#if intBars.length}
      <div class="subh muted">Interrupts</div>
      {@render bars(intBars)}
    {/if}
    {#if dispelPrioBars.length}
      <div class="subh muted">High-priority dispels<span class="qmark" use:tip={'Dispels of DANGEROUS (high-priority) debuffs only — the cleanses that actually mattered. Bounded by curated spell-table coverage.'}>?</span></div>
      {@render bars(dispelPrioBars)}
    {/if}
    {#if dispelBars.length}
      <div class="subh muted">Dispels</div>
      {@render bars(dispelBars)}
    {/if}

    {#if clutchList.length}
      <div class="subh muted">Clutch plays<span class="qmark" use:tip={"High-value external/utility casts that helped an ally in real danger survive — credited regardless of role. A cast only counts when the ally was at/below 45% HP or weathered ≥50% of their max HP within 6s of it; 'saved' means they were ≤20% HP and lived. Pulls (Leap of Faith / Rescue) are credited on the HP signal only — their positional value isn't in the log. Bounded by the curated ability list."}>?</span></div>
      <div class="plays">
        {#each clutchList as p (`${p.ms}:${p.spellId}:${p.targetId}`)}
          <div class="play">
            <span class="pk">{CLUTCH_ICON[p.kind]}</span>
            <span class="pc" style={colorByName.get(p.casterName) ? `color:${colorByName.get(p.casterName)}` : ''}>{anon.name(p.casterName)}</span>
            <span class="ps">{p.spellName}</span>
            <span class="pt muted">→ {anon.name(p.targetName)}</span>
            <span class="pctx muted">{clutchContext(p)}</span>
            {#if p.lifeSaved}<span class="savedchip">saved</span>{/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .owner { margin: 0 0 8px; font-size: 13px; }
  .small { font-size: 12px; }
  .rcard {
    background: var(--surface-2, rgba(255,255,255,0.02)); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px 14px; margin: 0 0 12px;
  }
  .rhead { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
  .rhead h3 { margin: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text); }
  .bigs { display: flex; align-items: baseline; gap: 18px; flex-wrap: wrap; }
  .big { display: flex; align-items: baseline; gap: 6px; }
  .bignum { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .bignum.good { color: var(--good, #5fd08a); }
  .bigname { font-size: 16px; font-weight: 700; }

  .plays { display: flex; flex-direction: column; gap: 4px; }
  .play { display: flex; align-items: baseline; gap: 6px; font-size: 13px; flex-wrap: wrap; }
  .pk { font-size: 12px; }
  .pc { font-weight: 600; }
  .ps { font-weight: 600; }
  .pt { flex-shrink: 0; }
  .pctx { font-size: 12px; font-variant-numeric: tabular-nums; }
  .savedchip {
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
    color: var(--good, #5fd08a); border: 1px solid var(--good, #5fd08a); border-radius: 10px; padding: 0 6px;
  }
  .bigunit { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }

  .bars { display: flex; flex-direction: column; gap: 6px; }
  .barrow { display: flex; flex-direction: column; gap: 2px; }
  .bhead { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
  .bname { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
  .brank { min-width: 2ch; text-align: right; color: var(--muted); font-weight: 700; font-variant-numeric: tabular-nums; }
  .bn { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bv { font-variant-numeric: tabular-nums; color: var(--muted); flex-shrink: 0; }
  .track { height: 6px; background: var(--track, rgba(255,255,255,0.06)); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; background: var(--accent); border-radius: 3px; }

  .dpsrow { display: flex; flex-direction: column; gap: 2px; }
  .kickline { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 1px; font-size: 11px; font-variant-numeric: tabular-nums; }
  .kstat { position: relative; color: var(--muted); cursor: help; }
  .kstat.ok { color: var(--good, #5fd08a); }
  .kstat.warn { color: var(--warn, #e0a82e); }
  .kstat .kl { color: var(--muted); font-weight: 400; }
  /* Tooltip is now body-portaled via `use:tip` (mvp/tip.ts) so it isn't clipped by the sidebar. */

  .subh { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin: 12px 0 6px; }

  .strip { display: flex; flex-wrap: wrap; gap: 18px; margin: 4px 0 2px; }
  .stat { display: flex; flex-direction: column; gap: 1px; }
  .snum { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .snum.ok { color: var(--good, #5fd08a); }
  .snum.warn { color: var(--warn, #e0a82e); }
  .snum.bad { color: var(--bad, crimson); }
  .slabel { font-size: 11px; }
  .qmark {
    position: relative;
    display: inline-flex; align-items: center; justify-content: center;
    width: 13px; height: 13px; margin-left: 4px; border-radius: 50%;
    border: 1px solid var(--border); color: var(--muted); font-size: 9px; font-weight: 700;
    cursor: help; vertical-align: middle;
  }
  .qmark:hover { color: var(--text); border-color: var(--hover-accent, #8a5cff); }
</style>
