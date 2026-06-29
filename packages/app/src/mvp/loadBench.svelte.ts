// Lightweight load / tray-restore benchmarking. DEV-only signal surfaced in the Dev panel (DevPanel),
// so it never reaches production users. Measures two things relevant to startup + the desktop companion's
// hide-to-tray behavior:
//   • initialLoadMs — ms from page navigation start to the app becoming interactive (cold UI load).
//   • restore samples — for each hide→show (tray) cycle: how long the window sat in the tray and how long
//     from the show request to the first PAINTED frame (the "load the UI back from the tray" cost). This
//     is the baseline to compare against if we later tear down / rebuild the UI when hiding to the tray.
// Self-consistent perf clock (`performance.now`), bracketed by the native window-hidden/window-shown
// events (see src-tauri main.rs + tray.rs) so it's reliable regardless of WebView2 visibility quirks.

export type RestoreSample = {
  /** Wall-clock (Date.now) when the window was restored — for ordering / display only. */
  at: number;
  /** How long the window was hidden in the tray (ms). */
  hiddenMs: number;
  /** Show request → first painted frame (ms) — the perceived "UI is back" latency. */
  paintMs: number;
};

const MAX_SAMPLES = 12;

class LoadBench {
  /** Cold UI load: ms from navigation start to the app's first effect (interactive). */
  initialLoadMs = $state<number | null>(null);
  /** Recent tray restores, newest first, capped at MAX_SAMPLES. */
  restores = $state<RestoreSample[]>([]);
  /** DEV-tunable override for the unload-replay-on-tray delay (ms). App reads this live, so the Dev
   *  panel can drop it near 0 to test the unload without waiting the real minute. In-memory only. */
  trayUnloadDelayMs = $state(60_000);
  /** DEV diagnostics for the tray-unload path: a human-readable trail of the last few tray actions
   *  (hidden / unloaded-worker / restored) so it's obvious whether the path is actually firing. */
  trayLog = $state<string[]>([]);

  /** Record a tray-path event (newest first, capped). DEV-only signal for the Dev panel. */
  trayEvent(label: string): void {
    const stamp = new Date().toLocaleTimeString();
    this.trayLog = [`${stamp} · ${label}`, ...this.trayLog].slice(0, 8);
  }

  // perf.now() captured when the most recent window-hidden arrived (null = currently shown).
  #hiddenAt: number | null = null;

  /** Called once when the app becomes interactive (App's first $effect). Idempotent. */
  markInteractive(): void {
    if (this.initialLoadMs == null) this.initialLoadMs = Math.round(performance.now());
  }

  /** Window hidden to the tray. */
  markHidden(): void {
    this.#hiddenAt = performance.now();
  }

  /** Window shown from the tray — time to the first painted frame via a double-rAF (the 2nd callback
   *  fires after the restored frame is committed, so it approximates real paint, not just rAF dispatch). */
  markShown(): void {
    const shownAt = performance.now();
    const hiddenMs = this.#hiddenAt == null ? 0 : Math.round(shownAt - this.#hiddenAt);
    this.#hiddenAt = null;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const paintMs = Math.round(performance.now() - shownAt);
        this.restores = [{ at: Date.now(), hiddenMs, paintMs }, ...this.restores].slice(0, MAX_SAMPLES);
      }),
    );
  }

  /** Mean paint latency across the recorded restores (null until we have one). */
  get avgPaintMs(): number | null {
    if (this.restores.length === 0) return null;
    return Math.round(this.restores.reduce((s, r) => s + r.paintMs, 0) / this.restores.length);
  }

  reset(): void {
    this.restores = [];
  }
}

export const loadBench = new LoadBench();
