<!-- Root-level overlay that shows the full MechanicCard for the currently-focused mechanic. Mounted ONCE
     in App so it floats over everything (sidebar, replay drawer, library). Large panel — cards will grow
     to hold videos. Driven by the mechanicDetail singleton; Escape / backdrop / ✕ close. -->
<script lang="ts">
  import MechanicCard from './MechanicCard.svelte';
  import MechanicEditor from './MechanicEditor.svelte';
  import { mechanicDetail } from './mechanicDetail.svelte.js';
  import { cardFor } from './avoidableAdvice.js';
  import { mechanicEditsEnabled } from './mechanicEdit.js';
  import mBookIcon from '../../../assets/img/m-book.svg';

  let editing = $state(false);
  // The full card backing the editor (identity/advice/videos). Undefined ⇒ nothing curated yet.
  let card = $derived(mechanicDetail.spellId != null ? cardFor(mechanicDetail.spellId) : undefined);
  const canEdit = mechanicEditsEnabled();

  // Reset to the read view whenever the focused mechanic changes.
  $effect(() => {
    mechanicDetail.spellId;
    editing = false;
  });

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (editing) editing = false;
      else mechanicDetail.close();
    }
  }
</script>

<svelte:window on:keydown={onKey} />

{#if mechanicDetail.spellId != null}
  <div class="overlay" role="dialog" aria-modal="true" aria-label="Mechanic details">
    <button class="backdrop" aria-label="Close" onclick={() => mechanicDetail.close()}></button>
    <div class="panel" style="--mbook: url({mBookIcon})">
      {#if canEdit && card && !editing}
        <button class="editbtn" onclick={() => (editing = true)}>✎ Suggest edit</button>
      {/if}
      <button class="closebtn" onclick={() => mechanicDetail.close()} aria-label="Close">✕</button>
      <div class="panel-body">
        {#if editing && card}
          <MechanicEditor {card} onClose={() => (editing = false)} onSubmitted={() => {}} />
        {:else}
          <MechanicCard spellId={mechanicDetail.spellId} />
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay { position: fixed; inset: 0; z-index: 1100; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.6); border: 0; cursor: pointer; }
  .panel {
    position: relative; width: min(720px, 96vw); max-height: 90vh; display: flex; flex-direction: column;
    background:
      linear-gradient(180deg, rgba(12, 22, 43, 0.9), rgba(5, 10, 22, 0.96)),
      var(--bg, #12151c);
    border: 1px solid rgba(143, 171, 222, 0.26); border-radius: 8px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55); overflow: hidden;
  }
  .panel::before {
    content: '';
    position: absolute;
    right: 24px;
    bottom: 20px;
    width: min(45%, 340px);
    aspect-ratio: 1197 / 767;
    pointer-events: none;
    background: linear-gradient(135deg, #8a5cff, #2788ff 58%, #54dfe0);
    opacity: 0.055;
    -webkit-mask: var(--mbook) center / contain no-repeat;
    mask: var(--mbook) center / contain no-repeat;
  }
  .closebtn {
    position: absolute; top: 8px; right: 8px; z-index: 2;
    width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
    background: rgba(3, 8, 18, 0.42); border: 1px solid rgba(143, 171, 222, 0.22); border-radius: 8px;
    color: var(--muted); font-size: 15px; cursor: pointer; padding: 0;
  }
  .closebtn:hover { color: var(--text); border-color: var(--accent, #5b8cff); }
  .editbtn {
    position: absolute; top: 8px; right: 48px; z-index: 2; height: 32px; padding: 0 12px;
    display: inline-flex; align-items: center; gap: 4px;
    background: rgba(3, 8, 18, 0.42); border: 1px solid rgba(143, 171, 222, 0.22); border-radius: 8px;
    color: var(--muted); font-size: 12px; font-weight: 600; cursor: pointer;
  }
  .editbtn:hover { color: var(--accent, #9bb6ff); border-color: var(--accent, #5b8cff); }
  .panel-body { position: relative; z-index: 1; overflow-y: auto; padding: 22px 56px 22px 22px; }
  /* The card fills the panel (no rounded inner border doubling). */
  .panel-body :global(.mcard) { border: 0; background: transparent; padding: 0; }
</style>
