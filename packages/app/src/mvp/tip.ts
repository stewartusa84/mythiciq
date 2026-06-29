// A hover/focus tooltip that renders into <body> so it is NEVER clipped by an `overflow:hidden` /
// scrolling ancestor. This replaces the old `data-tip` + `::after` CSS tooltips: a pseudo-element is
// part of the element's own box, so inside the analysis sidebar (`.sidebar{overflow:hidden}` +
// `.side-body{overflow-y:auto}`) those tooltips got cut off where they overflowed toward the replay.
// A body-portaled element has no such clip and sits above everything.
//
// Usage (Svelte action): <span use:tip={'explanatory text'}>…</span>. A falsy value disables it.
// Styling lives in app.css as the global `.app-tip` (the bubble is outside any component's scoped CSS).

export function tip(node: HTMLElement | SVGElement, text: string | null | undefined) {
  let current: string | null = text || null;
  let bubble: HTMLDivElement | null = null;

  function position(): void {
    if (!bubble) return;
    const r = node.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const margin = 6;
    // Prefer above the target; flip below when there isn't room near the top of the viewport.
    let top = r.top - b.height - margin;
    if (top < 4) top = r.bottom + margin;
    // Center over the target, clamped into the viewport so a near-edge tooltip stays fully visible.
    let left = r.left + r.width / 2 - b.width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - b.width - 4));
    bubble.style.top = `${Math.round(top)}px`;
    bubble.style.left = `${Math.round(left)}px`;
  }

  function show(): void {
    if (bubble || !current || typeof document === 'undefined') return;
    bubble = document.createElement('div');
    bubble.className = 'app-tip';
    bubble.textContent = current;
    document.body.appendChild(bubble);
    position(); // synchronous layout read — positioned before the browser paints, so no flicker
    // Keep it pinned to the target while the page scrolls/resizes underneath it (capture catches the
    // sidebar's own scroll container too).
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
  }

  function hide(): void {
    if (!bubble) return;
    window.removeEventListener('scroll', position, true);
    window.removeEventListener('resize', position);
    bubble.remove();
    bubble = null;
  }

  node.addEventListener('mouseenter', show);
  node.addEventListener('mouseleave', hide);
  node.addEventListener('focusin', show);
  node.addEventListener('focusout', hide);

  return {
    update(next: string | null | undefined): void {
      current = next || null;
      if (!bubble) return;
      if (!current) hide();
      else {
        bubble.textContent = current;
        position();
      }
    },
    destroy(): void {
      hide();
      node.removeEventListener('mouseenter', show);
      node.removeEventListener('mouseleave', hide);
      node.removeEventListener('focusin', show);
      node.removeEventListener('focusout', hide);
    },
  };
}
