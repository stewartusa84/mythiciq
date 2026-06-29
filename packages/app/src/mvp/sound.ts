// Notification sound hook. A clean seam so call sites (e.g. an LFG broadcast match arriving) can request
// a sound. If a real audio asset is registered for the cue it plays that; otherwise it falls back to a
// short, pleasant WebAudio chime so users are AUDIBLY alerted now (important: a player may be in-game and
// needs to hear that a match/invite appeared), with real assets a drop-in later. Respects a persisted mute.

const STORE_KEY = 'mythiciq.sound.v1';

/** name → asset URL. Empty for now (assets TBD) → the synthesized chime is used. Drop a URL in to override. */
const SOUNDS: Record<string, string | undefined> = {
  // 'lfg-match': new URL('../assets/sound/lfg-match.mp3', import.meta.url).href,
  'lfg-match': undefined,
};

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) !== 'off';
  } catch {
    return true;
  }
}

let enabled = readEnabled();

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORE_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode — fine, just not remembered */
  }
}

let audioCtx: AudioContext | null = null;
function ctx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    audioCtx ??= new AC();
    // Autoplay policy: the context may start suspended until a gesture; a signed-in session has had one.
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

/** A short two-note "ding-dong" chime via WebAudio — no asset needed. */
function chime(): void {
  const ac = ctx();
  if (!ac) return;
  const now = ac.currentTime;
  const notes = [
    { f: 880, t: 0 },
    { f: 1318.5, t: 0.13 },
  ];
  for (const { f, t } of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = f;
    const start = now + t;
    // Quick attack, gentle decay — a soft notification blip, not a klaxon.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);
    osc.connect(gain).connect(ac.destination);
    osc.start(start);
    osc.stop(start + 0.34);
  }
}

/** Play a named notification cue. No-op if muted. Plays a registered asset if present, else a chime. */
export function playSound(name: keyof typeof SOUNDS | string): void {
  if (!enabled) return;
  const url = SOUNDS[name];
  if (url) {
    try {
      const a = new Audio(url);
      a.volume = 0.5;
      void a.play().catch(() => chime()); // asset blocked → fall back to the synth chime
    } catch {
      chime();
    }
    return;
  }
  chime();
}
