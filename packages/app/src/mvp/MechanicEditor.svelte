<!-- Structured editor for a mechanic card. A player edits the card's fields and PROPOSES the change;
     on submit we send only the CHANGED fields (a minimal diff) to the backend review queue via
     submitMechanicEdit — nothing is applied automatically. Identity/build-derived fields (spellId,
     dungeon, removable-by) are shown read-only. Degrades to a disabled state when no backend is set. -->
<script lang="ts">
  import type { MechanicCard, MechanicVideo } from '@wow/engine';
  import { submitMechanicEdit, mechanicEditsEnabled, type ProposedCard } from './mechanicEdit.js';

  let {
    card,
    onClose,
    onSubmitted,
  }: { card: MechanicCard; onClose?: () => void; onSubmitted?: () => void } = $props();

  type Level = 'off' | 'regular' | 'dangerous';

  // Seed the form from the card ONCE (editable fields only). The parent remounts this editor when the
  // focused mechanic changes, so a one-time snapshot is the intended semantics.
  // svelte-ignore state_referenced_locally
  const seed = card;
  let name = $state(seed.name ?? '');
  let caster = $state(seed.caster ?? '');
  let boss = $state(!!seed.boss);
  let summary = $state(seed.summary ?? '');
  let adGeneric = $state(seed.advice?.generic ?? '');
  let adTank = $state(seed.advice?.tank ?? '');
  let adHealer = $state(seed.advice?.healer ?? '');
  let adDps = $state(seed.advice?.dps ?? '');
  let avoidable = $state(!!seed.avoidable);
  let interrupt = $state<Level>(seed.interruptPriority ?? 'off');
  let danger = $state<Level>(seed.danger ?? 'off');
  let confidence = $state<'' | 'high' | 'medium' | 'low'>(seed.confidence ?? '');
  let notes = $state(seed.notes ?? '');
  let tags = $state<string[]>([...(seed.tags ?? [])]);
  let videos = $state<{ title: string; url: string; atSeconds: string }[]>(
    (seed.videos ?? []).map((v) => ({ title: v.title ?? '', url: v.url, atSeconds: v.atSeconds != null ? String(v.atSeconds) : '' })),
  );
  let source = $state(''); // contributor credit — your name / org (blank = leave existing credit)
  let sourceUrl = $state(''); // optional http(s) link for the contributor
  let reason = $state(''); // "why this change" — attached to the submission, not the card

  let newTag = $state('');
  function addTag() {
    const t = newTag.trim();
    if (t && !tags.includes(t)) tags = [...tags, t];
    newTag = '';
  }
  const removeTag = (t: string) => (tags = tags.filter((x) => x !== t));
  const addVideo = () => (videos = [...videos, { title: '', url: '', atSeconds: '' }]);
  const removeVideo = (i: number) => (videos = videos.filter((_, j) => j !== i));

  const trimmedStr = (v: string) => v.trim();
  function toVideo(v: { title: string; url: string; atSeconds: string }): MechanicVideo | null {
    const url = v.url.trim();
    if (!url) return null;
    const out: MechanicVideo = { url };
    const title = v.title.trim();
    if (title) out.title = title;
    const at = Number(v.atSeconds.trim());
    if (Number.isFinite(at) && at > 0) out.atSeconds = Math.floor(at);
    return out;
  }

  // Build the minimal diff — only fields whose value differs from the card. Clears of the three
  // classification fields are sent as `null`; clearing a text/array field isn't representable in v1.
  function buildDiff(): ProposedCard {
    const p: ProposedCard = {};

    if (trimmedStr(name) && trimmedStr(name) !== (card.name ?? '')) p.name = trimmedStr(name);
    if (trimmedStr(caster) && trimmedStr(caster) !== (card.caster ?? '')) p.caster = trimmedStr(caster);
    if (boss !== !!card.boss) p.boss = boss;
    if (trimmedStr(summary) && trimmedStr(summary) !== (card.summary ?? '')) p.summary = trimmedStr(summary);
    if (trimmedStr(notes) && trimmedStr(notes) !== (card.notes ?? '')) p.notes = trimmedStr(notes);

    const advice: NonNullable<ProposedCard['advice']> = {};
    if (adGeneric.trim()) advice.generic = adGeneric.trim();
    if (adTank.trim()) advice.tank = adTank.trim();
    if (adHealer.trim()) advice.healer = adHealer.trim();
    if (adDps.trim()) advice.dps = adDps.trim();
    const origAdvice = JSON.stringify({
      ...(card.advice?.generic ? { generic: card.advice.generic } : {}),
      ...(card.advice?.tank ? { tank: card.advice.tank } : {}),
      ...(card.advice?.healer ? { healer: card.advice.healer } : {}),
      ...(card.advice?.dps ? { dps: card.advice.dps } : {}),
    });
    if (Object.keys(advice).length && JSON.stringify(advice) !== origAdvice) p.advice = advice;

    if (avoidable !== !!card.avoidable) p.avoidable = avoidable;

    const origInterrupt: Level = card.interruptPriority ?? 'off';
    if (interrupt !== origInterrupt) p.interruptPriority = interrupt === 'off' ? null : interrupt;
    const origDanger: Level = card.danger ?? 'off';
    if (danger !== origDanger) p.danger = danger === 'off' ? null : danger;

    if (confidence && confidence !== (card.confidence ?? '')) p.confidence = confidence;

    const cleanTags = tags.map((t) => t.trim()).filter(Boolean);
    if (cleanTags.length && JSON.stringify(cleanTags) !== JSON.stringify(card.tags ?? [])) p.tags = cleanTags;

    const cleanVideos = videos.map(toVideo).filter((v): v is MechanicVideo => v !== null);
    const origVideos = JSON.stringify((card.videos ?? []).map((v) => toVideo({ title: v.title ?? '', url: v.url, atSeconds: v.atSeconds != null ? String(v.atSeconds) : '' })));
    if (cleanVideos.length && JSON.stringify(cleanVideos) !== origVideos) p.videos = cleanVideos;

    // Contributor credit: only sent when filled (blank leaves any existing credit untouched).
    if (trimmedStr(source) && trimmedStr(source) !== (card.source ?? '')) p.source = trimmedStr(source);
    if (trimmedStr(sourceUrl) && trimmedStr(sourceUrl) !== (card.sourceUrl ?? '')) p.sourceUrl = trimmedStr(sourceUrl);

    return p;
  }

  let diff = $derived(buildDiff());
  let changeCount = $derived(Object.keys(diff).length);
  let enabled = mechanicEditsEnabled();

  let busy = $state(false);
  let result = $state<{ ok: boolean; error?: string } | null>(null);

  async function submit() {
    if (!changeCount) {
      result = { ok: false, error: 'No changes to submit.' };
      return;
    }
    busy = true;
    result = null;
    const r = await submitMechanicEdit(card.spellId, diff, { dungeon: card.dungeon, note: reason });
    busy = false;
    result = { ok: r.ok, error: r.error };
    if (r.ok) onSubmitted?.();
  }
</script>

<div class="editor">
  <div class="ehead">
    <h3>Suggest an edit</h3>
    <p class="sub">
      {card.name ?? `Spell ${card.spellId}`}
      <span class="ro">#{card.spellId}{card.dungeon ? ` · ${card.dungeon}` : ''}</span>
    </p>
  </div>

  {#if result?.ok}
    <div class="done">
      <p class="ok">✓ Thanks — your suggestion was sent for review.</p>
      <p class="dim">Curators review proposed edits before they go live, so it won’t change instantly.</p>
      <button class="primary" onclick={() => onClose?.()}>Close</button>
    </div>
  {:else}
    <div class="grid">
      <label class="fld"><span>Name</span><input type="text" bind:value={name} placeholder="Ability name" /></label>
      <label class="fld"><span>Caster (NPC)</span><input type="text" bind:value={caster} placeholder="Mob / boss name" /></label>

      <label class="fld chk"><input type="checkbox" bind:checked={boss} /><span>Boss ability</span></label>
      <label class="fld chk"><input type="checkbox" bind:checked={avoidable} /><span>Avoidable (telegraphed, personally dodgeable)</span></label>

      <label class="fld">
        <span>Interruptible</span>
        <select bind:value={interrupt}>
          <option value="off">Not interruptible</option>
          <option value="regular">Interruptible</option>
          <option value="dangerous">Interruptible — high priority</option>
        </select>
      </label>
      <label class="fld">
        <span>Dangerous debuff</span>
        <select bind:value={danger}>
          <option value="off">Not a dangerous debuff</option>
          <option value="regular">Debuff — regular</option>
          <option value="dangerous">Debuff — dangerous</option>
        </select>
      </label>

      <label class="fld wide"><span>Summary (what it does)</span><textarea rows="2" bind:value={summary}></textarea></label>

      <label class="fld wide"><span>Advice — everyone</span><textarea rows="2" bind:value={adGeneric}></textarea></label>
      <label class="fld"><span>Advice — Tank</span><textarea rows="2" bind:value={adTank}></textarea></label>
      <label class="fld"><span>Advice — Healer</span><textarea rows="2" bind:value={adHealer}></textarea></label>
      <label class="fld"><span>Advice — DPS</span><textarea rows="2" bind:value={adDps}></textarea></label>

      <div class="fld wide">
        <span>Tags</span>
        <div class="chips">
          {#each tags as t (t)}
            <span class="chip">{t}<button type="button" class="x" onclick={() => removeTag(t)} aria-label={`Remove ${t}`}>✕</button></span>
          {/each}
          <input
            class="taginput"
            type="text"
            bind:value={newTag}
            placeholder="add tag…"
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
          />
        </div>
      </div>

      <div class="fld wide">
        <span>Videos</span>
        {#each videos as v, i (i)}
          <div class="vrow">
            <input type="text" class="vurl" bind:value={v.url} placeholder="https://…" />
            <input type="text" class="vtitle" bind:value={v.title} placeholder="title (optional)" />
            <input type="text" class="vat" bind:value={v.atSeconds} placeholder="@sec" inputmode="numeric" />
            <button type="button" class="x" onclick={() => removeVideo(i)} aria-label="Remove video">✕</button>
          </div>
        {/each}
        <button type="button" class="ghost tiny" onclick={addVideo}>+ Add video</button>
      </div>

      <label class="fld">
        <span>Confidence</span>
        <select bind:value={confidence}>
          <option value="">—</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label class="fld"><span>Notes (internal)</span><input type="text" bind:value={notes} placeholder="curation notes" /></label>

      {#if card.removableCategories?.length}
        <div class="fld wide ro-block">
          <span>Removable by (auto, read-only)</span>
          <div class="chips">{#each card.removableCategories as c (c)}<span class="chip ro">{c}</span>{/each}</div>
        </div>
      {/if}

      <div class="fld wide credit">
        <span>Credit (optional)</span>
        <div class="crow">
          <input type="text" bind:value={source} placeholder="Your name or org" maxlength="200" />
          <input type="text" bind:value={sourceUrl} placeholder="https://your-link (optional)" inputmode="url" maxlength="500" />
        </div>
        <span class="hint">Shown on the card as “Contributed by …”. Leave blank to keep the existing credit.</span>
      </div>

      <label class="fld wide"><span>Why this change? (optional, for the reviewer)</span><textarea rows="2" bind:value={reason} placeholder="e.g. this cast is interruptible — kicked it 6× in my run"></textarea></label>
    </div>

    {#if result && !result.ok}<p class="err">{result.error}</p>{/if}
    {#if !enabled}<p class="err">Submitting suggestions needs a backend connection (unavailable in this build).</p>{/if}

    <div class="actions">
      <button class="ghost" onclick={() => onClose?.()} disabled={busy}>Cancel</button>
      <span class="spacer"></span>
      <span class="changes" class:has={changeCount > 0}>{changeCount} change{changeCount === 1 ? '' : 's'}</span>
      <button class="primary" onclick={submit} disabled={busy || !enabled || changeCount === 0}>
        {busy ? 'Submitting…' : 'Submit for review'}
      </button>
    </div>
  {/if}
</div>

<style>
  .editor { color: var(--text); font-size: 13px; }
  .ehead { margin-bottom: 14px; }
  .ehead h3 { margin: 0 0 2px; font-size: 16px; font-weight: 750; }
  .sub { margin: 0; color: var(--text); }
  .ro { color: var(--muted); font-size: 12px; font-weight: 500; margin-left: 6px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; }
  .fld { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .fld.wide { grid-column: 1 / -1; }
  .fld > span { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 700; }
  .fld.chk { flex-direction: row; align-items: center; gap: 8px; }
  .fld.chk > span { text-transform: none; letter-spacing: 0; font-size: 12.5px; font-weight: 500; color: var(--text); }
  input[type='text'],
  textarea,
  select {
    width: 100%; box-sizing: border-box; padding: 7px 9px; border-radius: 7px; font-size: 13px;
    background: var(--surface-2, #1b1f29); border: 1px solid var(--border, #2a2f3a); color: var(--text);
    color-scheme: dark; font-family: inherit; resize: vertical;
  }
  input[type='text']:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent, #5b8cff); }
  input[type='checkbox'] { width: 15px; height: 15px; accent-color: var(--accent, #5b8cff); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px; padding: 2px 4px 2px 8px; border-radius: 8px; font-size: 12px;
    background: color-mix(in srgb, var(--accent, #5b8cff) 18%, transparent); color: var(--accent, #9bb6ff);
  }
  .chip.ro { background: var(--surface, #232834); color: var(--muted); padding: 2px 8px; }
  .x { background: none; border: 0; color: inherit; cursor: pointer; font-size: 11px; opacity: 0.75; padding: 0 2px; }
  .x:hover { opacity: 1; }
  .taginput { flex: 1 1 90px; min-width: 90px; width: auto; }
  .vrow { display: flex; gap: 6px; margin-bottom: 6px; align-items: center; }
  .vrow .vurl { flex: 2 1 0; }
  .vrow .vtitle { flex: 1 1 0; }
  .vrow .vat { flex: 0 0 66px; text-align: center; }
  .ro-block .chips { margin-top: 2px; }
  .credit .crow { display: flex; gap: 8px; }
  .credit .crow input { flex: 1 1 0; min-width: 0; }
  .credit .hint { margin-top: 4px; font-size: 10.5px; text-transform: none; letter-spacing: 0; color: var(--muted); font-weight: 500; }
  @media (max-width: 560px) { .credit .crow { flex-direction: column; } }
  .actions { display: flex; align-items: center; gap: 10px; margin-top: 16px; }
  .spacer { flex: 1; }
  .changes { font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .changes.has { color: var(--accent, #9bb6ff); font-weight: 650; }
  .err { color: var(--bad, #e06666); font-size: 12.5px; margin: 12px 0 0; }
  .done { text-align: center; padding: 12px 0; }
  .done .ok { color: var(--good, #5fd08a); font-size: 15px; font-weight: 650; margin: 0 0 6px; }
  .done .dim { color: var(--muted); margin: 0 0 16px; }
  @media (max-width: 560px) {
    .grid { grid-template-columns: 1fr; }
    .fld.wide { grid-column: auto; }
  }
</style>
