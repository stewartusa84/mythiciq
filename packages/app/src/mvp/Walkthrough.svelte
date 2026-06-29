<script lang="ts">
  // First-run guided tour. A full-screen scrim with a spotlight CUTOUT over the current target element
  // (located by a `[data-tour="…"]` selector) plus a tooltip card describing it. Steps advance via the
  // card's Back/Next buttons; the scrim blocks app interaction while the tour is up. Targets are always
  // -present chrome (rail buttons, the stage, the settings gear), so no scrolling/awaiting is needed.
  import { tick } from 'svelte';

  export interface TourStep {
    /** CSS selector for the element to spotlight (we add `[data-tour]` anchors in App.svelte). */
    target: string;
    title: string;
    body: string;
    /** Preferred card placement relative to the target; falls back/clamps to fit the viewport. */
    placement?: 'right' | 'left' | 'top' | 'bottom';
  }

  let { steps, onDone }: { steps: TourStep[]; onDone: () => void } = $props();

  let i = $state(0);
  let rect = $state<{ x: number; y: number; w: number; h: number } | null>(null);
  let pos = $state<{ top: number; left: number }>({ top: 0, left: 0 });
  let cardEl = $state<HTMLDivElement | null>(null);

  const PAD = 8; // spotlight breathing room around the target
  const GAP = 14; // distance from target to card
  const MARGIN = 10; // keep the card this far from the viewport edge

  const step = $derived(steps[i]);
  const isLast = $derived(i === steps.length - 1);

  async function measure() {
    const el = step ? (document.querySelector(step.target) as HTMLElement | null) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      rect = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 };
    } else {
      rect = null; // target missing → card centers with no spotlight
    }
    await tick(); // let the card render with this step's text so we can read its real size
    place();
  }

  function place() {
    const cw = cardEl?.offsetWidth ?? 320;
    const ch = cardEl?.offsetHeight ?? 170;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (!rect) {
      pos = { top: (vh - ch) / 2, left: (vw - cw) / 2 };
      return;
    }
    // Pick a placement that fits; honor the hint first, then fall back by available space.
    const fits = {
      right: rect.x + rect.w + GAP + cw + MARGIN <= vw,
      left: rect.x - GAP - cw - MARGIN >= 0,
      bottom: rect.y + rect.h + GAP + ch + MARGIN <= vh,
      top: rect.y - GAP - ch - MARGIN >= 0,
    };
    const order: Array<keyof typeof fits> = [
      step?.placement ?? 'right',
      'right',
      'left',
      'bottom',
      'top',
    ];
    const pick = order.find((p) => fits[p]) ?? 'bottom';
    let top: number, left: number;
    if (pick === 'right') {
      left = rect.x + rect.w + GAP;
      top = rect.y;
    } else if (pick === 'left') {
      left = rect.x - GAP - cw;
      top = rect.y;
    } else if (pick === 'bottom') {
      top = rect.y + rect.h + GAP;
      left = rect.x;
    } else {
      top = rect.y - GAP - ch;
      left = rect.x;
    }
    // Clamp inside the viewport.
    left = Math.max(MARGIN, Math.min(left, vw - cw - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - ch - MARGIN));
    pos = { top, left };
  }

  // Re-measure whenever the step changes, and on resize/scroll while the tour is up.
  $effect(() => {
    i; // track
    void measure();
  });
  $effect(() => {
    const onChange = () => void measure();
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    return () => {
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
    };
  });

  function next() {
    if (isLast) onDone();
    else i += 1;
  }
  function back() {
    if (i > 0) i -= 1;
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onDone();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
    else if (e.key === 'ArrowLeft') back();
  }
</script>

<svelte:window onkeydown={onKey} />

<!-- The scrim blocks app interaction (pointer-events on the root); the spotlight hole + card sit above. -->
<div class="tour" role="dialog" aria-modal="true" aria-label="Getting started">
  {#if rect}
    <div
      class="tour-hole"
      style="left:{rect.x}px; top:{rect.y}px; width:{rect.w}px; height:{rect.h}px"
    ></div>
  {:else}
    <div class="tour-dim"></div>
  {/if}

  <div class="tour-card" bind:this={cardEl} style="top:{pos.top}px; left:{pos.left}px">
    <div class="tc-step">Step {i + 1} of {steps.length}</div>
    <div class="tc-title">{step?.title}</div>
    <div class="tc-body">{step?.body}</div>
    <div class="tc-actions">
      <button class="tc-skip" onclick={onDone}>Skip</button>
      <div class="tc-nav">
        {#if i > 0}<button class="tc-btn" onclick={back}>Back</button>{/if}
        <button class="tc-btn primary" onclick={next}>{isLast ? 'Got it' : 'Next'}</button>
      </div>
    </div>
  </div>
</div>

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 1000; /* above modals (≤100) and the drawer */
    pointer-events: auto; /* swallow app clicks during the tour */
  }
  /* The spotlight: a transparent box whose massive box-shadow darkens everything else. */
  .tour-hole {
    position: absolute;
    border-radius: 10px;
    box-shadow: 0 0 0 9999px rgba(8, 11, 16, 0.74);
    outline: 2px solid var(--accent, #4ea1ff);
    outline-offset: 0;
    pointer-events: none;
    transition: left 0.25s ease, top 0.25s ease, width 0.25s ease, height 0.25s ease;
  }
  .tour-dim {
    position: absolute;
    inset: 0;
    background: rgba(8, 11, 16, 0.74);
  }
  .tour-card {
    position: absolute;
    width: 320px;
    max-width: calc(100vw - 20px);
    background: var(--surface-2, #1a1f27);
    border: 1px solid var(--accent, #4ea1ff);
    border-radius: 12px;
    padding: 16px 16px 12px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.6);
    color: var(--text, #e8edf4);
    transition: top 0.25s ease, left 0.25s ease;
  }
  .tc-step {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--muted, #8b97a8);
    margin-bottom: 4px;
  }
  .tc-title {
    font-size: 16px;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .tc-body {
    font-size: 13px;
    line-height: 1.5;
    color: var(--muted, #b8c2d0);
    margin-bottom: 14px;
  }
  .tc-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tc-nav {
    display: flex;
    gap: 8px;
  }
  .tc-skip {
    background: transparent;
    border: none;
    color: var(--muted, #8b97a8);
    cursor: pointer;
    font-size: 12px;
    padding: 6px 4px;
  }
  .tc-skip:hover {
    color: var(--text, #e8edf4);
  }
  .tc-btn {
    cursor: pointer;
    border-radius: 7px;
    padding: 7px 14px;
    font-size: 13px;
    font-weight: 600;
    border: 1px solid var(--border, #2a313c);
    background: transparent;
    color: var(--text, #e8edf4);
  }
  .tc-btn:hover {
    border-color: var(--muted, #8b97a8);
  }
  .tc-btn.primary {
    background: var(--accent, #4ea1ff);
    border-color: transparent;
    color: #061018;
  }
  .tc-btn.primary:hover {
    filter: brightness(1.08);
  }
</style>
