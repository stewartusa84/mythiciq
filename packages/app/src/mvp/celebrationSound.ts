// A short, pleasant "you did it" chime for the timed-run celebration. Synthesized with the Web Audio
// API (a quick ascending arpeggio with a soft bell-like envelope) so there's no audio asset to ship or
// license, and nothing to load. Best-effort: if the AudioContext can't start (e.g. autoplay is blocked
// because there was no user gesture — a desktop auto-watch load), it silently no-ops.

/** Play the celebration chime once. Safe to call anywhere; never throws. */
export function playCelebration(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    // Autoplay policy: if the context is suspended (no gesture), try to resume; if it stays suspended
    // the notes just won't sound — that's fine, the visual celebration still plays.
    void ctx.resume?.();

    const now = ctx.currentTime;
    // A bright major arpeggio, C5 → E5 → G5 → C6, plus a sparkle a third above to finish.
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
    const step = 0.085; // seconds between note onsets — quick, celebratory
    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    // Gentle overall envelope so the whole flourish swells in and fades out.
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.32, now + 0.04);
    master.gain.exponentialRampToValueAtTime(0.0001, now + step * notes.length + 0.9);

    notes.forEach((freq, i) => {
      const t = now + i * step;
      const osc = ctx.createOscillator();
      osc.type = 'triangle'; // soft, bell-ish — not a harsh saw/square
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.6, t + 0.012); // fast pluck attack
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7); // ring-out decay
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + 0.75);
    });

    // Close the context after the sound finishes so we don't leak audio resources.
    const total = step * notes.length + 1.1;
    setTimeout(() => void ctx.close?.(), Math.ceil(total * 1000));
  } catch {
    /* audio is a nicety — never let it break the celebration */
  }
}
