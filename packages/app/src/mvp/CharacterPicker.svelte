<!-- Character picker for the LFG pilot. Groups is character-first: a Looking Card (and an application)
     attaches to a specific CHARACTER, so this picks one of the player's characters — or adds another.
     Adding a character LOOKS IT UP ON THE ARMORY: the user enters region + realm (autocompleted) + name
     and we pull the real class/spec/ilvl/avatar from Battle.net (still UNVERIFIED ownership — a lookup
     isn't proof; OAuth "pull all my characters" is the next step). If the Armory isn't configured, or the
     character can't be found, it falls back to MANUAL entry (hand-typed class/spec/ilvl). The component
     owns the add/delete actions (via the lfg client) and calls onChanged so the parent reloads. -->
<script lang="ts">
  import { CLASS_COLOR } from './specVisuals.js';
  import {
    createCharacter, deleteCharacter, armoryRealms, armoryLookup, addCharacterFromArmory,
    REGIONS, syncFreshness,
    type Character, type CharacterInput, type Region, type ArmoryRealm, type ArmoryCharacter,
  } from './lfg.js';
  import { blizzardConfigured, blizzardStatus, unlinkBlizzard, type BlizzardStatus, type AccountCandidate } from './blizzard.js';
  import { blizzardLink } from './blizzardLink.svelte.js';

  let {
    characters,
    selectedId = $bindable(),
    onChanged,
  }: {
    characters: Character[];
    selectedId: string | null;
    onChanged: () => Promise<void> | void;
  } = $props();

  const CLASSES = Object.keys(CLASS_COLOR);
  const uid = Math.random().toString(36).slice(2, 8);

  // -- Battle.net account link (pull the whole roster, verified) --
  let linkRegion = $state<Region>('us');
  let link = $state<BlizzardStatus | null>(null);
  // The picker's tick selection while phase==='choosing' (keyed by realmSlug|name).
  let chosen = $state<Set<string>>(new Set());
  const candKey = (c: AccountCandidate) => `${c.realmSlug}|${c.name.toLowerCase()}`;

  async function loadLinkStatus() {
    if (!blizzardConfigured()) return;
    const r = await blizzardStatus();
    if (r.ok) {
      link = r.value;
      if (link.region) linkRegion = link.region;
    }
  }
  $effect(() => { void loadLinkStatus(); });

  async function startLink() {
    await blizzardLink.start(linkRegion, refreshAfterImport);
    void loadLinkStatus();
  }
  // Already linked → re-sync via the stored token (no re-authorization needed).
  async function resync() {
    await blizzardLink.resync(refreshAfterImport);
    void loadLinkStatus();
  }
  async function unlink() {
    if (!confirm('Unlink your Battle.net account? Imported characters stay; you can re-link any time.')) return;
    await unlinkBlizzard();
    await loadLinkStatus();
  }
  // After an import, reload the parent roster AND our link status.
  async function refreshAfterImport() {
    await onChanged();
    await loadLinkStatus();
  }

  // The candidates needing a choice (more than the free slots), capped selection at slotsLeft.
  const choosing = $derived(blizzardLink.phase === 'choosing' ? blizzardLink.roster : null);
  const slotsLeft = $derived(choosing?.slotsLeft ?? 0);
  function toggleChoice(c: AccountCandidate) {
    const k = candKey(c);
    const next = new Set(chosen);
    if (next.has(k)) next.delete(k);
    else if (next.size < slotsLeft) next.add(k);
    chosen = next;
  }
  async function importChosen() {
    const cands = (choosing?.candidates ?? []).filter((c) => chosen.has(candKey(c)));
    if (cands.length === 0) return;
    await blizzardLink.importSelected(cands, refreshAfterImport);
    chosen = new Set();
  }

  let adding = $state(false);
  let busy = $state(false);
  let err = $state<string | null>(null);

  // Armory state (loaded per region while the add form is open).
  let armoryOn = $state(true); // assume available until we learn otherwise
  let manualMode = $state(false);
  let realms = $state<ArmoryRealm[]>([]);
  let preview = $state<ArmoryCharacter | null>(null);

  // Shared add fields.
  let fRegion = $state<Region>('us');
  let fName = $state('');
  let fRealm = $state('');
  // Manual-only fields.
  let fClass = $state('Paladin');
  let fSpec = $state('');
  let fIlvl = $state<number | ''>('');

  function classColor(name: string): string {
    return CLASS_COLOR[name] ?? 'var(--muted)';
  }

  // Load the realm list for the chosen region (autocomplete) whenever the form opens / region changes.
  $effect(() => {
    if (!adding) return;
    const region = fRegion;
    void (async () => {
      const r = await armoryRealms(region);
      if (r.ok) {
        armoryOn = r.value.configured;
        realms = r.value.realms;
        if (!r.value.configured) manualMode = true;
      } else {
        armoryOn = false;
        manualMode = true;
      }
    })();
  });

  function reset() {
    fName = ''; fRealm = ''; fSpec = ''; fIlvl = ''; preview = null; err = null;
    manualMode = !armoryOn;
  }
  function openForm() {
    adding = !adding;
    if (adding) reset();
  }

  // Armory: find (preview) → add.
  async function find() {
    err = null; preview = null;
    if (!fName.trim() || !fRealm.trim()) { err = 'enter a character name and realm'; return; }
    busy = true;
    const r = await armoryLookup(fRegion, fRealm.trim(), fName.trim());
    busy = false;
    if (r.ok) preview = r.value.character;
    else { err = `${r.error} You can add it manually instead.`; manualMode = true; }
  }
  async function addArmory() {
    if (!preview) return;
    busy = true;
    const r = await addCharacterFromArmory(fRegion, preview.realm, preview.name);
    busy = false;
    if (r.ok) { selectedId = r.value.id; adding = false; reset(); await onChanged(); }
    else err = r.error;
  }

  // Manual fallback.
  async function addManual() {
    err = null;
    const input: CharacterInput = {
      region: fRegion,
      name: fName.trim(),
      realm: fRealm.trim(),
      class: fClass,
      spec: fSpec.trim(),
      ...(fIlvl === '' ? {} : { ilvl: Number(fIlvl) }),
    };
    if (!input.name || !input.realm || !input.spec) { err = 'name, realm, and spec are required'; return; }
    busy = true;
    const r = await createCharacter(input);
    busy = false;
    if (r.ok) { selectedId = r.value.id; adding = false; reset(); await onChanged(); }
    else err = r.error;
  }

  async function remove(c: Character) {
    if (!confirm(`Remove ${c.name}-${c.realm}?`)) return;
    busy = true;
    const r = await deleteCharacter(c.id);
    busy = false;
    if (r.ok) {
      if (selectedId === c.id) selectedId = null;
      await onChanged();
    } else err = r.error;
  }
</script>

<div class="cp">
  {#if blizzardConfigured() && link?.configured}
    <div class="linkrow">
      {#if !link.linked}
        <select class="in slim" bind:value={linkRegion} disabled={blizzardLink.busy}>{#each REGIONS as r (r)}<option value={r}>{r.toUpperCase()}</option>{/each}</select>
      {/if}
      <button class="linkbnet" onclick={link.linked ? resync : startLink} disabled={blizzardLink.busy}>
        {#if blizzardLink.busy}Working…{:else if link.linked}↻ Re-sync Battle.net{:else}🔗 Link Battle.net — import all my characters{/if}
      </button>
      {#if link.linked}<button class="linkbtn" onclick={unlink} disabled={blizzardLink.busy}>Unlink</button>{/if}
    </div>
    {#if blizzardLink.notice}<p class="ok">{blizzardLink.notice} <button class="linkbtn" onclick={() => blizzardLink.dismiss()}>dismiss</button></p>{/if}
    {#if blizzardLink.error}<p class="err">{blizzardLink.error} <button class="linkbtn" onclick={() => blizzardLink.dismiss()}>dismiss</button></p>{/if}

    {#if choosing}
      <div class="choose">
        <p class="choosehead">Your account has more max-level characters than open slots. Pick up to <strong>{slotsLeft}</strong> to import ({chosen.size}/{slotsLeft}):</p>
        <div class="candlist">
          {#each choosing.candidates ?? [] as c (candKey(c))}
            {@const sel = chosen.has(candKey(c))}
            <button class="cand" class:on={sel} class:done={c.alreadyImported} disabled={c.alreadyImported || (!sel && chosen.size >= slotsLeft)} onclick={() => toggleChoice(c)}>
              <span class="cdot" style={`background:${classColor(c.class)}`}></span>
              <span class="cname">{c.name}</span><span class="crealm">-{c.realm}</span>
              {#if c.alreadyImported}<span class="tag">imported</span>{:else if sel}<span class="tick">✓</span>{/if}
            </button>
          {/each}
        </div>
        <div class="arow">
          <button class="primary sm" onclick={importChosen} disabled={blizzardLink.busy || chosen.size === 0}>{blizzardLink.phase === 'importing' ? 'Importing…' : `Import ${chosen.size} selected`}</button>
          <button class="linkbtn" onclick={() => blizzardLink.cancel()}>Cancel</button>
        </div>
      </div>
    {/if}
  {/if}

  <div class="chips">
    {#each characters as c (c.id)}
      <div class="charchip" class:on={selectedId === c.id}>
        <button class="pick" onclick={() => (selectedId = c.id)} title={`${c.class} ${c.spec}${c.ilvl ? ` · ${c.ilvl} ilvl` : ''} · ${syncFreshness(c)}`}>
          {#if c.avatar}<img class="cav" src={c.avatar} alt="" />{:else}<span class="cdot" style={`background:${classColor(c.class)}`}></span>{/if}
          <span class="cname">{c.name}</span><span class="crealm">-{c.realm}</span>
          {#if c.ilvl}<span class="cilvl">{c.ilvl}</span>{/if}
          {#if !c.verified}<span class="unverified" title="Unverified — looked up / entered manually, not confirmed owned">●</span>{/if}
        </button>
        <button class="x" title="Remove character" onclick={() => remove(c)} disabled={busy}>✕</button>
      </div>
    {/each}
    <button class="addbtn" onclick={openForm}>{adding ? 'Cancel' : '+ Add character'}</button>
  </div>

  {#if characters.length === 0 && !adding}
    <p class="hint">Add a character to attach to your Looking Cards — we'll look it up on the Armory.</p>
  {/if}

  {#if adding}
    <div class="addform">
      <div class="arow">
        <select class="in slim" bind:value={fRegion}>{#each REGIONS as r (r)}<option value={r}>{r.toUpperCase()}</option>{/each}</select>
        <input class="in slim grow" bind:value={fName} placeholder="character name" maxlength="24" />
        <input class="in slim grow" list={`realms-${uid}`} bind:value={fRealm} placeholder="realm" maxlength="48" autocomplete="off" />
        <datalist id={`realms-${uid}`}>{#each realms as r (r.slug)}<option value={r.name}></option>{/each}</datalist>
      </div>

      {#if !manualMode}
        <!-- Armory search → preview → add. -->
        {#if !preview}
          <div class="arow">
            <button class="primary sm" onclick={find} disabled={busy || !fName.trim() || !fRealm.trim()}>{busy ? 'Searching…' : '🔍 Find character'}</button>
            {#if armoryOn}<button class="linkbtn" onclick={() => (manualMode = true)}>Enter manually instead</button>{/if}
          </div>
        {:else}
          <div class="preview">
            {#if preview.avatar}<img class="pav" src={preview.avatar} alt="" />{:else}<span class="cdot big" style={`background:${classColor(preview.class)}`}></span>{/if}
            <div class="pinfo">
              <span class="pname" style={`color:${classColor(preview.class)}`}>{preview.name}-{preview.realm}</span>
              <span class="pmeta">{preview.spec} {preview.class}{#if preview.ilvl} · {preview.ilvl} ilvl{/if} · {preview.region.toUpperCase()}</span>
            </div>
            <div class="pactions">
              <button class="primary sm" onclick={addArmory} disabled={busy}>{busy ? 'Adding…' : 'Add this character'}</button>
              <button class="linkbtn" onclick={() => (preview = null)}>Search again</button>
            </div>
          </div>
        {/if}
      {:else}
        <!-- Manual fallback. -->
        <div class="arow">
          <select class="in slim" bind:value={fClass}>{#each CLASSES as k (k)}<option value={k}>{k}</option>{/each}</select>
          <input class="in slim grow" bind:value={fSpec} placeholder="spec (e.g. Holy)" maxlength="28" />
          <input class="in slim num" type="number" bind:value={fIlvl} placeholder="ilvl" min="0" max="900" />
          <button class="primary sm" onclick={addManual} disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
        </div>
        {#if armoryOn}<button class="linkbtn" onclick={() => { manualMode = false; preview = null; err = null; }}>← Search the Armory instead</button>{/if}
      {/if}

      <p class="note">
        {#if armoryOn}Looked-up characters are unverified (a lookup isn't proof of ownership). Battle.net account verification — and pulling all your characters — comes next.
        {:else}Armory lookup isn't available in this build — add characters manually for now.{/if}
      </p>
    </div>
  {/if}
  {#if err}<p class="err">{err}</p>{/if}
</div>

<style>
  .cp { display: flex; flex-direction: column; gap: 8px; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .charchip { display: inline-flex; align-items: center; border: 1px solid var(--border); border-radius: 999px; overflow: hidden; background: var(--bg); }
  .charchip.on { border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .pick { display: inline-flex; align-items: center; gap: 6px; background: none; border: none; color: var(--text); cursor: pointer; padding: 5px 4px 5px 8px; font-size: 12.5px; }
  .cdot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .cdot.big { width: 28px; height: 28px; }
  .cav { width: 20px; height: 20px; border-radius: 4px; flex: none; }
  .cname { font-weight: 700; }
  .crealm { color: var(--muted); }
  .cilvl { font-size: 10.5px; font-weight: 700; color: var(--muted); border: 1px solid var(--border); border-radius: 4px; padding: 0 4px; margin-left: 2px; }
  .unverified { color: var(--warn, #e0a82e); font-size: 9px; margin-left: 2px; }
  .x { background: none; border: none; color: var(--muted); cursor: pointer; padding: 5px 8px 5px 4px; font-size: 11px; }
  .x:hover { color: #ffb4b4; }
  .addbtn { background: transparent; color: var(--muted); border: 1px dashed var(--border); border-radius: 999px; padding: 5px 12px; cursor: pointer; font-size: 12px; }
  .addbtn:hover { color: var(--text); border-color: var(--muted); }

  .addform { display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--border); border-radius: 8px; padding: 10px; background: var(--bg); }
  .arow { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .grow { flex: 1 1 120px; min-width: 100px; }
  .in { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; font-size: 13px; color-scheme: dark; }
  .in.slim { padding: 5px 8px; font-size: 12px; }
  .in.num { width: 72px; }

  .preview { display: flex; align-items: center; gap: 10px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 8px; padding: 8px 10px; background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .pav { width: 36px; height: 36px; border-radius: 6px; flex: none; }
  .pinfo { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .pname { font-weight: 800; font-size: 13.5px; }
  .pmeta { color: var(--muted); font-size: 11.5px; }
  .pactions { margin-left: auto; display: flex; align-items: center; gap: 8px; }

  .note { margin: 0; font-size: 11px; color: var(--muted); line-height: 1.45; }
  .hint { margin: 0; font-size: 12px; color: var(--muted); }
  .err { margin: 0; font-size: 12px; color: var(--warn, #e0a82e); }
  .ok { margin: 0; font-size: 12px; color: var(--ok, #4ade80); }

  .linkrow { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .linkbnet { display: inline-flex; align-items: center; gap: 6px; background: color-mix(in srgb, #1c8cff 16%, var(--bg)); color: var(--text); border: 1px solid color-mix(in srgb, #1c8cff 55%, var(--border)); border-radius: 999px; padding: 6px 14px; cursor: pointer; font-size: 12.5px; font-weight: 700; }
  .linkbnet:hover:not(:disabled) { background: color-mix(in srgb, #1c8cff 28%, var(--bg)); }
  .linkbnet:disabled { opacity: 0.6; cursor: default; }

  .choose { display: flex; flex-direction: column; gap: 8px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); border-radius: 8px; padding: 10px; background: color-mix(in srgb, var(--accent) 7%, transparent); }
  .choosehead { margin: 0; font-size: 12px; color: var(--text); }
  .candlist { display: flex; flex-wrap: wrap; gap: 6px; max-height: 220px; overflow-y: auto; }
  .cand { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--border); border-radius: 999px; background: var(--bg); color: var(--text); padding: 5px 10px; font-size: 12px; cursor: pointer; }
  .cand.on { border-color: color-mix(in srgb, var(--accent) 60%, var(--border)); background: color-mix(in srgb, var(--accent) 14%, transparent); }
  .cand.done { opacity: 0.5; cursor: default; }
  .cand:disabled:not(.done) { opacity: 0.45; cursor: default; }
  .cand .tick { color: var(--accent); font-weight: 800; }
  .cand .tag { font-size: 9.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .linkbtn { background: none; border: none; color: var(--accent); font-size: 12px; cursor: pointer; padding: 0; }
  .linkbtn:hover { text-decoration: underline; }
  .primary { background: var(--accent, #6ea8fe); color: #0a0c10; border: none; border-radius: 8px; padding: 7px 14px; font-weight: 700; cursor: pointer; font-size: 13px; }
  .primary.sm { padding: 5px 12px; font-size: 12px; }
  .primary:disabled { opacity: 0.5; cursor: default; }
</style>
