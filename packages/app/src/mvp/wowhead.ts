// Wowhead tooltip integration. tooltips.js (loaded in index.html) decorates any
// <a href="https://www.wowhead.com/…"> with an icon, canonical name, quality color, and a hover
// tooltip. It scans the document once on load, but links added later by our SPA must be re-scanned
// via $WowheadPower.refreshLinks(). We debounce that into a single call per frame; if the script is
// still loading we retry a few times (its own initial pass covers links already in the DOM).

declare global {
  interface Window {
    $WowheadPower?: { refreshLinks?: () => void };
  }
}

let scheduled = false;
let attempts = 0;

/** Request a (coalesced) re-scan of Wowhead links after the DOM has been updated. */
export function refreshWowhead(): void {
  if (scheduled || typeof window === 'undefined') return;
  scheduled = true;
  requestAnimationFrame(run);
}

function run(): void {
  const wh = window.$WowheadPower;
  if (!wh?.refreshLinks) {
    // Script not ready yet — retry briefly (bounded), then defer to its on-load scan.
    scheduled = false;
    if (attempts++ < 40) setTimeout(refreshWowhead, 150);
    return;
  }
  // Don't re-scan while the user is hovering a Wowhead link: refreshLinks() re-decorates every link
  // and tears down the OPEN tooltip, so it flashes off/on during replay playback (the journal / cast
  // lanes mount new links every frame, each requesting a refresh). Defer until the hover ends — keep
  // `scheduled` true so further requests coalesce into this pending run; the new links get decorated a
  // moment later, once the pointer leaves.
  if (typeof document !== 'undefined' && document.querySelector('a[href*="wowhead.com"]:hover')) {
    setTimeout(run, 250);
    return;
  }
  scheduled = false;
  attempts = 0;
  wh.refreshLinks();
}

export {};
