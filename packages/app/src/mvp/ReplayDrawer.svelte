<!-- Persistent bottom "Deep Dive" drawer — the evidence layer beneath every tab. Always-present handle;
     click to open/collapse, drag the handle to resize, drag near the bottom to minimize. Mounted ONCE
     in App (outside the tab switch) so its replay state survives tab changes; only a RUN change resets
     it (ReplayViewer's own runIndex effect). -->
<script lang="ts">
  import type { ParserClient } from '@wow/engine';
  import type { ReplayController } from './replayController.svelte.js';
  import ReplayViewer from '../panels/ReplayViewer.svelte';
  import imgReplay from '../../../assets/img/replay.png';

  type MetricWindowLite = { label: string; startMs: number; endMs: number; unitName?: string; detail?: string; color?: string; spellId?: number; id?: string };
  let {
    controller,
    client,
    runIndex,
    windows = [],
  }: { controller: ReplayController; client: ParserClient | null; runIndex: number; windows?: MetricWindowLite[] } = $props();

  const MIN_H = 110; // drag below this → minimize
  const collapsedHint = $derived(!controller.open);

  let dragging = $state(false);
  let moved = false;
  let startY = 0;
  let startH = 0;

  function maxH(): number {
    return Math.max(MIN_H, window.innerHeight - 140);
  }
  function onPointerDown(e: PointerEvent) {
    // Let buttons inside the handle act normally (they stopPropagation), not start a drag.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    moved = false;
    startY = e.clientY;
    startH = controller.open ? controller.height : 0;
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dy = startY - e.clientY; // drag up = grow
    if (Math.abs(dy) > 3) moved = true;
    const h = startH + dy;
    if (h < MIN_H) {
      controller.open = false; // dragged nearly to the bottom → minimize
    } else {
      controller.open = true;
      controller.height = Math.min(h, maxH());
    }
  }
  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    dragging = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    if (!moved) controller.toggle(); // a plain click toggles
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      controller.open = true;
      controller.height = Math.min(controller.height + 40, maxH());
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const h = controller.height - 40;
      if (h < MIN_H) controller.open = false;
      else controller.height = h;
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      controller.toggle();
    }
  }
  function maximize(e: MouseEvent) {
    e.stopPropagation();
    controller.open = true;
    controller.height = maxH();
  }
  function collapse(e: MouseEvent) {
    e.stopPropagation();
    controller.open = false;
  }
</script>

<div class="drawer" class:open={controller.open}>
  <!-- Single full-drawer background: one background-size:cover reference spans both handle (38px,
       28% opacity) and body (rest, 7% opacity) via a CSS mask gradient — so the two areas look like
       one continuous image rather than two independently-scaled copies. -->
  <div class="drawer-bg" aria-hidden="true" style="background-image: url({imgReplay})"></div>
  <!-- Handle: drag to resize, click to toggle. -->
  <div
    class="handle"
    role="slider"
    aria-label="Resize replay drawer (arrow keys), toggle with Enter"
    aria-valuemin={0}
    aria-valuemax={typeof window !== 'undefined' ? window.innerHeight : 1000}
    aria-valuenow={controller.open ? controller.height : 0}
    tabindex="0"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onkeydown={onKeydown}
  >
    <span class="grip" aria-hidden="true"></span>
    <span class="label">Replay</span>
    <span class="spacer"></span>
    {#if collapsedHint}
      <span class="hint">click or drag up to open</span>
    {:else}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <label class="leadin" title="Seconds before a moment to start playback" onpointerdown={(e) => e.stopPropagation()}>
        lead-in
        <input type="number" min="0" max="60" step="1" bind:value={controller.leadInSeconds} />s
      </label>
      <button class="hbtn" title="Maximize" onpointerdown={(e) => e.stopPropagation()} onclick={maximize}>⤢</button>
      <button class="hbtn" title="Collapse" onpointerdown={(e) => e.stopPropagation()} onclick={collapse}>▾</button>
    {/if}
  </div>

  <div class="body" class:dragging style="height:{controller.open ? controller.height : 0}px">
    <ReplayViewer {client} {runIndex} {windows} {controller} embedded title="Replay" />
  </div>
</div>

<style>
  .drawer {
    flex: none;
    border-top: 1px solid var(--border);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.28);
    position: relative; /* contains .drawer-bg */
    isolation: isolate;  /* own stacking context so z-index: 1 on .drawer-bg is self-contained */
  }
  /* One full-drawer background element: background-size:cover over the entire drawer height means
     handle (top 38px, 28% via mask) and body (rest, 7% via mask) show the same spatial slice of the
     image — aligned as one continuous picture, not two independently-scaled copies. */
  .drawer-bg {
    position: absolute;
    inset: 0;
    z-index: 1;          /* above handle/body backgrounds, pointer-events:none so interaction passes through */
    pointer-events: none;
    background-size: cover;
    background-position: center 15%;
    -webkit-mask-image: linear-gradient(to bottom,
      rgba(0,0,0,0.28) 0, rgba(0,0,0,0.28) 38px,
      rgba(0,0,0,0.07) 38px, rgba(0,0,0,0.07) 100%);
    mask-image: linear-gradient(to bottom,
      rgba(0,0,0,0.28) 0, rgba(0,0,0,0.28) 38px,
      rgba(0,0,0,0.07) 38px, rgba(0,0,0,0.07) 100%);
  }
  .handle {
    height: 38px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    cursor: row-resize;
    user-select: none;
    background: var(--surface-2);
    touch-action: none;
    position: relative;
    overflow: hidden;
  }
  .grip { width: 34px; height: 4px; border-radius: 2px; background: var(--border); }
  .grip::after { content: ''; }
  .label { font-weight: 700; font-size: 20px; text-transform: lowercase; letter-spacing: 0.02em; }
  .spacer { flex: 1; }
  .hint { color: var(--muted); font-size: 12px; }
  .leadin { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 12px; cursor: default; }
  .leadin input {
    width: 42px; background: var(--surface); color: var(--text); border: 1px solid var(--border);
    border-radius: 5px; padding: 1px 4px; font-size: 12px; text-align: right;
  }
  .hbtn {
    background: transparent; color: var(--muted); border: 1px solid var(--border);
    border-radius: 5px; padding: 1px 7px; cursor: pointer; font-size: 12px;
  }
  .hbtn:hover { color: var(--text); border-color: var(--muted); }
  .body {
    overflow: auto; transition: height 0.16s ease;
  }
  .body.dragging { transition: none; } /* no lag while resizing */
  .body :global(.section) { padding: 12px 16px; }
  /* The replay's player mini-cards reuse the generic `.card` class; stop the global `.mvp .card`
     panel chrome (chunky padding/radius) from bleeding into them. (0,3,0) > (0,2,0). */
  .body :global(.cards .card) {
    padding: 6px 8px; border-radius: 6px; background: var(--surface-2); border: 1px solid var(--border);
  }
</style>
