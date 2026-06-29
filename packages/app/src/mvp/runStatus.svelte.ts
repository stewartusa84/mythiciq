// User override for a run's status: mark an "in progress" run as abandoned. The game emits no
// CHALLENGE_MODE_END for a key that's dropped and re-rolled, so the last such run reads "in progress"
// even though it was abandoned — a very common case. The user can confirm it from the Overview header.
//
// Keyed by the run HASH (runHash.ts — stable across reloads of the same log) and PERSISTED to
// localStorage, so the choice survives tab switches, run reselection, AND reloading the same log.
// Held in a runes singleton (mirrors the `anon` privacy singleton).

const KEY = 'wow.runStatus.abandoned.v1';

function loadSet(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

class RunStatusOverride {
  // Reassigned (not mutated) on change so $state tracks it — a plain Set mutation isn't reactive.
  private abandoned = $state<Set<string>>(loadSet());

  isAbandoned(runHash: string): boolean {
    return this.abandoned.has(runHash);
  }

  markAbandoned(runHash: string): void {
    if (this.abandoned.has(runHash)) return;
    const next = new Set(this.abandoned);
    next.add(runHash);
    this.abandoned = next;
    try {
      localStorage.setItem(KEY, JSON.stringify([...next]));
    } catch {
      /* quota / unavailable — keep the in-memory override anyway */
    }
  }
}

export const runStatus = new RunStatusOverride();
