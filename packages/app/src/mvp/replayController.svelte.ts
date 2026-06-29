// Shared state for the persistent replay drawer — the "evidence layer" beneath every tab. A single
// instance lives in App and is passed to both the drawer (which renders the replay) and the analysis
// panels (which call `seekTo` when a finding is clicked). Because it lives above the tab switch, the
// replay's loaded model + clock survive tab changes; only a RUN change resets it (ReplayViewer's own
// runIndex effect). Svelte 5 runes in a `.svelte.ts` module → the fields are reactive across files.

export interface SeekHighlight {
  /** event window to spotlight on the replay timeline */
  startMs: number;
  endMs: number;
  label?: string;
}

export interface SeekOptions {
  label?: string;
  /** Explicit spotlight window. When omitted it's derived as [event − leadIn, event] so the band
   *  shows the run-up you'll play through. */
  window?: { startMs: number; endMs: number };
}

export class ReplayController {
  /** drawer expanded (true) or collapsed to just its handle (false) */
  open = $state(false);
  /** drawer body height in px while open */
  height = $state(380);
  /** Seconds of run-up before a seeked moment — clicking "review a death" should land you a bit
   *  BEFORE it so you can watch it unfold, not freeze on the killing blow. User-adjustable. */
  leadInSeconds = $state(10);
  /** where the clock should land (epoch ms) = event − leadIn; null = none yet */
  seekMs = $state<number | null>(null);
  /** event window to spotlight, set alongside a seek */
  highlight = $state<SeekHighlight | null>(null);
  /** bumped on every seek so the viewer re-reacts even to the same target */
  seq = $state(0);

  /** A panel asks the replay to jump to (just before) `eventMs`, opening the drawer + spotlighting. */
  seekTo(eventMs: number, opts: SeekOptions = {}): void {
    const leadMs = Math.max(0, this.leadInSeconds) * 1000;
    this.seekMs = eventMs - leadMs;
    const w = opts.window ?? { startMs: eventMs - leadMs, endMs: eventMs };
    this.highlight = { startMs: w.startMs, endMs: w.endMs, label: opts.label };
    this.seq += 1;
    this.open = true;
    if (this.height < 220) this.height = 380; // nudge open if it was dragged tiny
  }

  toggle(): void {
    this.open = !this.open;
  }
}
